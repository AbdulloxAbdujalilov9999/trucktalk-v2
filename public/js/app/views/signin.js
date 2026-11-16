/* Sign in: Google, a link by email, or Telegram (our bot sends a one-time sign-in link). No passwords anywhere.
 * Demo mode: pick a role. After signing in you go back to where you came from (?next=/app/...). */
import { t } from "../i18n.js";
import { esc, icon, onAct, toast } from "../ui.js";
import { api, config } from "../api.js";
import { signInGoogle, sendEmailLink, isEmailLink, savedEmail, finishEmailLink, signInWithToken, firebaseReady, signOut } from "../auth.js";
import { go } from "../main.js";
import { state } from "../store.js";

const AFTER = "tt2:after-signin";
const DEMO_ID = "tt2:demo-id";
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

/** Only our own pages: never an open redirect to another site. */
function safeNext(n) {
  return typeof n === "string" && /^\/(app|v|admin)(\/|$|\?)/.test(n) && !n.startsWith("//") && !/[\\\s]/.test(n) ? n : "/app";
}
function rememberNext(n) { try { sessionStorage.setItem(AFTER, n); } catch { /* ignore */ } }
function takeNext() { try { const n = sessionStorage.getItem(AFTER); sessionStorage.removeItem(AFTER); return n; } catch { return null; } }
function forgetNext() { try { sessionStorage.removeItem(AFTER); } catch { /* ignore */ } }

export default async function signin(root, _p, { query }) {
  const cfg = await config();
  const next = safeNext(query.get("next") || "/app");
  const a = state.me.access;

  // just signed in (this screen re-renders once the app knows who you are): go on to where you were headed
  if (a.signedIn) {
    const n = takeNext();
    if (n) { const to = safeNext(n); if (to.startsWith("/admin")) location.replace(to); else go(to, { replace: true }); return; }
  }

  let emailSent = false, busy = false, err = "";
  const finishing = !a.signedIn && query.get("finish") === "1" && isEmailLink();

  function alreadyIn() {
    const u = state.me.user || {};
    return `<div class="card stack center" style="padding:24px 16px">
      <div style="margin:0 auto;width:56px;height:56px;border-radius:16px;background:var(--ok-soft);color:var(--ok);display:grid;place-items:center">${icon("check")}</div>
      <p style="margin:0"><b>${esc(t("signin.as", { name: u.name || u.email || u.uid || "" }))}</b></p>
      <a class="btn primary block" href="${esc(next)}" ${next.startsWith("/admin") ? "" : "data-link"}>${esc(t("continue"))}</a>
      <button class="btn ghost block" data-act="signout">${esc(t("signout"))}</button>
    </div>`;
  }

  function finishForm() {
    return `<form class="card stack" id="finishForm">
      <h2 style="margin:0">${esc(t("signin.finish"))}</h2>
      <label class="field"><span>${esc(t("signin.emailConfirm"))}</span>
        <input class="input" type="email" id="finishEmail" required autocomplete="email" inputmode="email" placeholder="${esc(t("signin.emailPh"))}" value="${esc(savedEmail())}"></label>
      <button class="btn primary block" ${busy ? "disabled" : ""}>${esc(busy ? t("signin.working") : t("signin.finish"))}</button>
      ${err ? `<p class="small" style="color:var(--bad);margin:0">${esc(err)}</p>` : ""}
    </form>`;
  }

  function options() {
    if (cfg.demo) {
      return `<div class="card stack">
        <div class="note small">${esc(t("signin.demo"))}</div>
        <button class="btn primary block" data-act="demo" data-as="student" ${busy ? "disabled" : ""}>${icon("user", "ico")} ${esc(t("signin.demoStudent"))}</button>
        <button class="btn block" data-act="demo" data-as="teacher" ${busy ? "disabled" : ""}>${esc(t("signin.demoTeacher"))}</button>
        <button class="btn block" data-act="demo" data-as="admin" ${busy ? "disabled" : ""}>${icon("shield", "ico")} ${esc(t("signin.demoAdmin"))}</button>
      </div>`;
    }
    if (!firebaseReady()) return `<div class="card empty">${esc(t("signin.unavailable"))}</div>`;
    return `<div class="card stack">
      <button class="btn block" data-act="google" ${busy ? "disabled" : ""} style="background:#fff;color:#1f1f1f;border:1px solid #dadce0">
        <svg class="ico" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
        ${esc(t("signin.google"))}</button>
      ${cfg.telegramBot ? `<button class="btn block" data-act="telegram" style="background:#229ED9;color:#fff;border-color:#229ED9">${icon("telegram", "ico")} ${esc(t("signin.telegram"))}</button>
        <p class="tiny muted center" style="margin:-4px 0 0">${esc(t("signin.telegramHint"))}</p>` : ""}
      <div class="row" style="gap:10px;color:var(--faint)"><hr class="grow" style="border:0;border-top:1px solid var(--line)"><span class="small">${esc(t("signin.or"))}</span><hr class="grow" style="border:0;border-top:1px solid var(--line)"></div>
      ${emailSent ? `<div class="note stack"><b>${esc(t("signin.emailSent"))}</b><span class="small muted">${esc(t("signin.spam"))}</span></div>`
        : `<form class="stack" id="emailForm">
          <label class="field"><span>${esc(t("signin.email"))}</span>
            <input class="input" type="email" id="email" required autocomplete="email" inputmode="email" placeholder="${esc(t("signin.emailPh"))}" value="${esc(savedEmail())}"></label>
          <button class="btn dark block" ${busy ? "disabled" : ""}>${esc(t("signin.emailSend"))}</button>
        </form>`}
      ${err ? `<p class="small" style="color:var(--bad);margin:0">${esc(err)}</p>` : ""}
    </div>`;
  }

  function paint() {
    root.innerHTML = `
      <div style="max-width:440px;margin:0 auto" class="stack-lg">
        <div class="center stack">
          <div style="margin:8px auto 0;width:60px;height:60px;border-radius:18px;background:var(--navy);display:grid;place-items:center;color:var(--navy-200)">${icon("truck")}</div>
          <h1 style="margin:0">${esc(t("signin.title"))}</h1>
          ${a.signedIn ? "" : `<p class="muted" style="margin:0">${esc(t("signin.why"))}</p>`}
        </div>
        ${a.signedIn ? alreadyIn() : finishing ? finishForm() : options()}
        <p class="tiny muted center">${icon("shield", "ico")} ${esc(t("signin.privacy"))}</p>
      </div>`;
    const ef = root.querySelector("#emailForm");
    if (ef) ef.addEventListener("submit", onEmail);
    const ff = root.querySelector("#finishForm");
    if (ff) ff.addEventListener("submit", onFinish);
  }

  function failed(e) {
    forgetNext();
    busy = false;
    const code = (e && (e.code || e.message)) || "";
    if (/popup-closed-by-user|cancelled-popup-request/.test(code)) { paint(); return; }
    err = /network/.test(code) ? t("error.network") : /invalid-action-code|expired-action-code/.test(code) ? t("signin.linkExpired") : /invalid-email/.test(code) ? t("signin.emailBad") : /too-many-requests|slow-down/.test(code) ? t("error.slow") : t("signin.failed");
    if (code && !/network/.test(code)) err += " (" + String(code).replace(/^auth\//, "").slice(0, 40) + ")";
    paint();
  }

  async function onEmail(e) {
    e.preventDefault();
    const email = root.querySelector("#email").value.trim();
    if (!EMAIL_RE.test(email)) { err = t("signin.emailBad"); paint(); return; }
    busy = true; err = ""; paint();
    try { await sendEmailLink(email); emailSent = true; busy = false; rememberNext(next); paint(); }
    catch (x) { failed(x); }
  }

  async function onFinish(e) {
    e.preventDefault();
    const email = root.querySelector("#finishEmail").value.trim();
    if (!EMAIL_RE.test(email)) { err = t("signin.emailBad"); paint(); return; }
    busy = true; err = ""; paint();
    rememberNext(next);
    try { await finishEmailLink(email); toast(t("signin.ok"), "ok"); }
    catch (x) { failed(x); }
  }

  paint();
  // the email link was opened on the same phone: finish without asking again
  if (finishing && savedEmail()) root.querySelector("#finishForm").requestSubmit();

  const off = onAct(root, {
    google: async () => {
      busy = true; err = ""; paint();
      rememberNext(next);
      try { await signInGoogle(); toast(t("signin.ok"), "ok"); }
      catch (x) { failed(x); }
    },
    telegram: () => {
      rememberNext(next);
      toast(t("signin.tgOpen"));
      window.open(`https://t.me/${encodeURIComponent(cfg.telegramBot)}?start=login`, "_blank", "noopener");
    },
    demo: async (el) => {
      busy = true; err = ""; paint();
      let id = null;
      try { id = localStorage.getItem(DEMO_ID); if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem(DEMO_ID, id); } } catch { /* ignore */ }
      rememberNext(next);
      try {
        const r = await api("dev", { method: "POST", auth: false, body: { action: "login", as: el.dataset.as, id } });
        await signInWithToken(r.token);
        toast(t("signin.ok"), "ok");
      } catch (x) { failed(x); }
    },
    signout: async () => { await signOut(); go("/app/signin" + (next !== "/app" ? "?next=" + encodeURIComponent(next) : ""), { replace: true }); },
  });
  return off;
}
