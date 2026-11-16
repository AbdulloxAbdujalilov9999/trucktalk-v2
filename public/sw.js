/* Offline support for the app.
 * - The app shell (pages, styles, scripts, lesson lists) is saved on install, so the app opens without internet.
 * - Pages and files are fetched fresh when online (with a short timeout) and the saved copy is refreshed; offline, the saved
 *   copy is used. So an update reaches everyone on their next online visit, without mixing old and new files.
 * - /api is never touched here: lessons a student opened are kept by the app itself, and played audio lives in its own cache
 *   ("tt2-voice-v1", managed by audio.js), which this worker never deletes.
 * scripts/check.mjs fails the build if a file the app needs is missing from SHELL. */
const CACHE = "tt2-shell-v5";
const SHELL = [
  "/", "/app.html", "/404.html", "/manifest.webmanifest",
  "/css/app.css",
  "/fonts/inter-latin-wght-normal.woff2", "/fonts/inter-cyrillic-wght-normal.woff2", "/fonts/oswald-latin-wght-normal.woff2", "/fonts/oswald-cyrillic-wght-normal.woff2",
  "/fonts/plexmono-latin-400-normal.woff2", "/fonts/plexmono-cyrillic-400-normal.woff2", "/fonts/plexmono-latin-500-normal.woff2",
  "/fonts/plexmono-cyrillic-500-normal.woff2", "/fonts/plexmono-latin-600-normal.woff2", "/fonts/plexmono-cyrillic-600-normal.woff2",
  "/data/catalog.json", "/data/videos.json",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/favicon-32.png", "/icons/apple-touch-icon.png",
  "/js/landing.js",
  "/js/app/api.js", "/js/app/audio.js", "/js/app/auth.js", "/js/app/i18n.js", "/js/app/items.js", "/js/app/main.js", "/js/app/store.js",
  "/js/app/theme.js", "/js/app/ui.js",
  "/js/app/views/certificate.js", "/js/app/views/common.js", "/js/app/views/course.js", "/js/app/views/day.js", "/js/app/views/grammar.js",
  "/js/app/views/home.js", "/js/app/views/homework.js", "/js/app/views/listen.js", "/js/app/views/practice.js", "/js/app/views/pricing.js",
  "/js/app/views/progress.js", "/js/app/views/review.js", "/js/app/views/settings.js", "/js/app/views/signin.js", "/js/app/views/talk.js",
  "/js/app/views/teacher.js", "/js/app/views/video.js", "/js/app/views/videos.js",
  "/js/shared/drills.js", "/js/shared/lesson.js", "/js/shared/plans.js", "/js/shared/progress.js", "/js/shared/scenes.js", "/js/shared/text.js", "/js/shared/videos.js",
];
const TIMEOUT_MS = 3500;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // one by one, so a single failed file doesn't stop the rest from being saved
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("tt2-shell-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** Network first (fresh when online), saved copy when offline or when the network is too slow. */
async function fresh(req, fallbackUrl) {
  const c = await caches.open(CACHE);
  const net = fetch(req).then((res) => {
    if (res.ok && res.type === "basic") c.put(fallbackUrl || req, res.clone()).catch(() => {});
    return res;
  });
  const timeout = new Promise((r) => setTimeout(() => r(null), TIMEOUT_MS));
  try {
    const first = await Promise.race([net, timeout]);
    if (first) return first;
  } catch { /* offline: fall through to the saved copy */ }
  const saved = await c.match(fallbackUrl || req, { ignoreSearch: !!fallbackUrl });
  if (saved) return saved;
  return net.catch(() => new Response("Offline", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
  if (req.mode === "navigate") {
    if (url.pathname.startsWith("/admin")) return;
    const isApp = url.pathname === "/app" || url.pathname.startsWith("/app/") || /^\/v\/\d+/.test(url.pathname);
    // the app's pages are all one page (app.html); the landing page is "/"
    e.respondWith(fresh(req, isApp ? "/app.html" : url.pathname === "/" || url.pathname === "/index.html" ? "/" : undefined));
    return;
  }
  if (/^\/(js|css|data|icons|fonts)\//.test(url.pathname) || url.pathname === "/manifest.webmanifest") e.respondWith(fresh(req));
});
