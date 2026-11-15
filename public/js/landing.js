/* The landing page. The HTML already holds the Uzbek text (filled in at build time from the app's dictionary), so this only:
 * switches language (shared with the app), opens a lesson by the number shown in a video, shows the Telegram links when a
 * bot is set up, and remembers which link brought the visitor (saved to their account once they sign in). */
import { t, lang, setLang } from "./app/i18n.js";
import { applyTheme } from "./app/theme.js";

applyTheme();

function apply() {
  document.documentElement.lang = lang();
  document.querySelectorAll("[data-k]").forEach((el) => { el.textContent = t(el.dataset.k); });
  for (const attr of ["placeholder", "content", "aria-label"]) {
    document.querySelectorAll(`[data-k-${attr}]`).forEach((el) => el.setAttribute(attr, t(el.getAttribute(`data-k-${attr}`))));
  }
  document.querySelectorAll("#langsw [data-lang]").forEach((b) => {
    const on = b.dataset.lang === lang();
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

document.getElementById("langsw").addEventListener("click", (e) => {
  const b = e.target.closest("[data-lang]");
  if (b) { setLang(b.dataset.lang); apply(); }
});
if (lang() !== "uz") apply();

// "Saw a lesson number in a video? Type it here"
const form = document.getElementById("jumpForm");
const input = document.getElementById("jumpN");
const err = document.getElementById("jumpErr");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const n = parseInt(String(input.value).trim(), 10);
  if (!(n >= 1 && n <= 50)) { err.hidden = false; input.focus(); return; }
  err.hidden = true;
  location.href = "/v/" + n;
});
input.addEventListener("input", () => { err.hidden = true; });

// where this visitor came from (?src=yt, ?src=ig ...): kept until they sign in, then saved to their account by the app
try {
  const src = new URLSearchParams(location.search).get("src");
  if (src && /^[a-z0-9_-]{1,40}$/i.test(src) && !localStorage.getItem("tt2:src")) localStorage.setItem("tt2:src", src.toLowerCase());
} catch { /* storage blocked */ }

// Telegram links appear only when a bot is configured
fetch("/api/config")
  .then((r) => (r.ok ? r.json() : null))
  .then((cfg) => {
    if (!cfg || !cfg.telegramBot) return;
    document.querySelectorAll("[data-tg]").forEach((a) => {
      a.href = `https://t.me/${encodeURIComponent(cfg.telegramBot)}?start=${encodeURIComponent(a.dataset.tg)}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.hidden = false;
    });
  })
  .catch(() => {});
