/* App entry: shell (navigation, language, plan badge), router, sign-in plumbing and global handlers. */
import { t, lang, setLang } from "./i18n.js";
import { icon, esc, onAct, toast, modal } from "./ui.js";
import { api, config } from "./api.js";
import { initAuth, onUser, ready, signInWithToken, currentUser } from "./auth.js";
import { state, subscribe, loadProgress, refreshMe } from "./store.js";
import { play, stop } from "./audio.js";
import { applyTheme } from "./theme.js";

applyTheme();

const root = document.getElementById("app");
const views = {
  home: () => import("./views/home.js"),
  course: () => import("./views/course.js"),
  day: () => import("./views/day.js"),
  grammar: () => import("./views/grammar.js"),
  videos: () => import("./views/videos.js"),
  video: () => import("./views/video.js"),
  review: () => import("./views/review.js"),
  practice: () => import("./views/practice.js"),
  listen: () => import("./views/listen.js"),
  talk: () => import("./views/talk.js"),
  words: () => import("./views/words.js"),
  teacher: () => import("./views/teacher.js"),
  profile: () => import("./views/profile.js"),
  pricing: () => import("./views/pricing.js"),
  signin: () => import("./views/signin.js"),
  certificate: () => import("./views/certificate.js"),
};
const ROUTES = [
  [/^\/app\/?$/, "home"],
  [/^\/app\/course\/?$/, "course"],
  [/^\/app\/day\/(-?\d{1,2})\/?$/, "day"],
  [/^\/app\/grammar\/?$/, "grammar"],
  [/^\/app\/grammar\/([a-z0-9-]+)\/?$/, "grammar"],
  [/^\/app\/videos\/?$/, "videos"],
  [/^\/(?:app\/videos|v)\/(\d{1,2})\/?$/, "video"],
  [/^\/app\/review\/?$/, "review"],
  [/^\/app\/practice\/?$/, "practice"],
  [/^\/app\/practice\/(numbers|listen|match|build|say)\/?$/, "practice"],
  [/^\/app\/listen\/?$/, "listen"],
  [/^\/app\/talk\/?$/, "talk"],
  [/^\/app\/talk\/([a-z]{2,20})\/?$/, "talk"],
  [/^\/app\/words\/?$/, "words"],
  [/^\/app\/teacher\/?$/, "teacher"],
  [/^\/app\/profile\/?$/, "profile"],
  [/^\/app\/pricing\/?$/, "pricing"],
  [/^\/app\/signin\/?$/, "signin"],
  [/^\/app\/certificate\/?$/, "certificate"],
];
const TABS = [["home", "/app", "home"], ["course", "/app/course", "book"], ["videos", "/app/videos", "video"], ["practice", "/app/practice", "target"], ["profile", "/app/profile", "user"]];
const TOP = [["home", "/app"], ["course", "/app/course"], ["videos", "/app/videos"], ["practice", "/app/practice"], ["grammar", "/app/grammar"], ["review", "/app/review"], ["words", "/app/words"], ["teacher", "/app/teacher"], ["profile", "/app/profile"]];
// which tab lights up for a screen that has no tab of its own
const TAB_OF = { video: "videos", day: "course", review: "practice", listen: "practice", talk: "practice" };

// ---------------------------------------------------------------- shared helpers for views
let catalogP = null, videosP = null;
export const catalog = () => (catalogP ||= fetch("/data/catalog.json").then((r) => r.json()));
export const videos = () => (videosP ||= fetch("/data/videos.json").then((r) => r.json()));

export function go(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, "", path); else history.pushState({}, "", path);
  render();
}

export async function startTrial() {
  try {
    state.me = await api("me", { method: "POST", body: { action: "start-trial" } });
    toast(t("trial.started"), "ok");
    render();
  } catch (e) {
    toast(e.code === "trial-used" ? t("trial.used") : e.code === "verify-first" ? t("trial.verify") : t("error.generic"), "bad");
  }
}

/** The "this is locked" sheet: sign in, start the trial, or see the plans. */
export function showLock() {
  const a = state.me.access;
  const m = modal(`
    <h2>${icon("lock")} ${esc(t("lock.title"))}</h2>
    <p class="muted">${esc(t("lock.body"))}</p>
    <div class="stack">
      ${!a.signedIn ? `<p>${esc(t("lock.signin"))}</p><a class="btn primary block" href="/app/signin" data-link data-close>${esc(t("signin"))}</a>` : ""}
      ${a.canStartTrial ? `<button class="btn primary block" data-act="trial">${icon("gift")} ${esc(t("trial.start"))}</button><p class="small muted center">${esc(t("trial.sub"))}</p>` : ""}
      <a class="btn ghost block" href="/app/pricing" data-link data-close>${esc(t("lock.seePlans"))}</a>
      <button class="btn block" data-close>${esc(t("close"))}</button>
    </div>`);
  onAct(m.el, { trial: async () => { m.close(); await startTrial(); } });
}

// "Install the app": Chrome/Android offer it through this event; we keep it for the button on the profile screen.
let installEvt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
addEventListener("appinstalled", () => { installEvt = null; });
export const canInstall = () => !!installEvt;
export async function promptInstall() {
  if (!installEvt) return false;
  const e = installEvt; installEvt = null;
  try { e.prompt(); const r = await e.userChoice; return r && r.outcome === "accepted"; } catch { return false; }
}
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

export function planLabel(access) {
  const tier = access && access.tier;
  return tier && tier !== "anon" ? t("plan." + tier) : "";
}

// ---------------------------------------------------------------- shell
function renderShell(name) {
  const tab = TAB_OF[name] || name;
  document.getElementById("tabbar").innerHTML = TABS.map(([k, href, ic]) =>
    `<a href="${href}" data-link class="${k === tab ? "on" : ""}">${icon(ic)}<span>${esc(t("nav." + k))}</span></a>`).join("");
  const staff = state.me.access && state.me.access.staff;
  const top = TOP.some(([k]) => k === name) ? name : tab;
  document.getElementById("topnav").innerHTML = TOP.map(([k, href]) =>
    `<a href="${href}" data-link class="${k === top ? "on" : ""}">${esc(t("nav." + k))}</a>`).join("") +
    (staff ? `<a href="/admin">${esc(t("nav.admin"))}</a>` : "");
  const tier = state.me.access && state.me.access.tier;
  document.getElementById("planchip").innerHTML = tier && tier !== "anon" && tier !== "free" ? `<span class="chip-plan ${esc(tier)}">${esc(planLabel(state.me.access))}</span>` : "";
  const sub = document.getElementById("brandsub");
  if (sub) sub.textContent = t("brand.sub");
  document.getElementById("langsw").innerHTML = ["uz", "ru", "en"].map((l) => `<button data-lang="${l}" class="${l === lang() ? "on" : ""}" aria-pressed="${l === lang()}">${l.toUpperCase()}</button>`).join("");
}

let cleanup = null, renderSeq = 0;
export async function render() {
  const my = ++renderSeq;
  stop();
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const path = location.pathname;
  let name = null, params = [];
  for (const [re, n] of ROUTES) { const m = re.exec(path); if (m) { name = n; params = m.slice(1); break; } }
  if (!name) { name = "home"; history.replaceState({}, "", "/app"); }
  renderShell(name);
  try {
    const mod = await views[name]();
    if (my !== renderSeq) return;
    root.innerHTML = "";
    const c = await mod.default(root, params, { query: new URLSearchParams(location.search) });
    if (my !== renderSeq) { if (typeof c === "function") c(); return; }
    cleanup = typeof c === "function" ? c : null;
  } catch (e) {
    console.error(e);
    if (my === renderSeq) {
      root.innerHTML = `<div class="card empty"><p>${esc(t("error.generic"))}</p><button class="btn" id="reloadBtn">${esc(t("retry"))}</button></div>`;
      document.getElementById("reloadBtn").addEventListener("click", () => location.reload());
    }
  }
  if (my === renderSeq && !history.state?.keepScroll) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- global handlers
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.origin === location.origin) {
    e.preventDefault();
    if (a.pathname + a.search !== location.pathname + location.search) go(a.pathname + a.search);
    return;
  }
  const s = e.target.closest('[data-act="say"]');
  if (s) { e.preventDefault(); play(s.dataset.t, { lang: s.dataset.lang || "en", gender: s.dataset.g || undefined, device: s.dataset.device === "1" }); return; }
  const l = e.target.closest("#langsw [data-lang]");
  if (l) { setLang(l.dataset.lang); render(); if (currentUser()) api("me", { method: "POST", body: { action: "update", lang: l.dataset.lang } }).catch(() => {}); }
});
addEventListener("popstate", () => render());

function offlineBanner() {
  const el = document.getElementById("offline");
  el.textContent = t("offline");
  el.classList.toggle("hidden", navigator.onLine);
}
addEventListener("online", offlineBanner);
addEventListener("offline", offlineBanner);

// where a visitor came from (a video, the bot, an ad): remembered once and saved to the account after sign-in
function rememberSource() {
  const q = new URLSearchParams(location.search);
  let src = q.get("src");
  const v = /^\/v\/(\d{1,2})/.exec(location.pathname);
  if (!src && v) src = "v" + v[1];
  if (src && /^[a-z0-9_-]{1,40}$/i.test(src)) { try { if (!localStorage.getItem("tt2:src")) localStorage.setItem("tt2:src", src.toLowerCase()); } catch { /* ignore */ } }
}
async function sendSource() {
  let src = null;
  try { src = localStorage.getItem("tt2:src"); } catch { /* ignore */ }
  if (src && currentUser()) { try { await api("me", { method: "POST", body: { action: "source", source: src } }); localStorage.removeItem("tt2:src"); } catch { /* later */ } }
}

// a one-time sign-in link from the Telegram bot: /app#tg=<token>
async function telegramLogin() {
  const m = /^#tg=([A-Za-z0-9_.-]{20,2000})$/.exec(location.hash);
  if (!m) return;
  history.replaceState({}, "", location.pathname + location.search);
  toast(t("signin.working"));
  try {
    const r = await api("me", { method: "POST", auth: false, body: { action: "telegram-login", token: m[1] } });
    await signInWithToken(r.customToken);
    toast(t("signin.ok"), "ok");
  } catch (e) {
    toast(e.code === "link-expired" ? t("signin.linkExpired") : t("error.generic"), "bad");
  }
}

// ---------------------------------------------------------------- start
let lastUid;
async function boot() {
  rememberSource();
  offlineBanner();
  const cfgP = config();
  initAuth();
  await ready;
  await telegramLogin();
  lastUid = currentUser() ? currentUser().uid : null;
  await Promise.all([refreshMe(), loadProgress(), cfgP]);
  sendSource();
  render();
  onUser(async (u) => {
    const uid = u ? u.uid : null;
    if (uid === lastUid) return;
    lastUid = uid;
    await Promise.all([refreshMe(), loadProgress()]);
    sendSource();
    render();
  });
  let lastTier = state.me.access && state.me.access.tier;
  subscribe((s) => {
    const tier = s.me.access && s.me.access.tier;
    if (tier !== lastTier) { lastTier = tier; renderShell(currentRouteName()); }
  });
  if ("serviceWorker" in navigator && !localStorage.getItem("tt2:nosw")) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
function currentRouteName() { for (const [re, n] of ROUTES) if (re.test(location.pathname)) return n; return "home"; }

boot();
