/* Bits several screens share. */
import { t } from "../i18n.js";
import { esc, icon, onAct } from "../ui.js";
import { state } from "../store.js";
import { startTrial } from "../main.js";

/** Full-page "locked" screen for a lesson the person can't open yet. */
export function lockedView(root, title, backHref = "/app/course") {
  const a = state.me.access;
  root.innerHTML = `
    <a class="back" href="${backHref}" data-link>${icon("left", "ico")} ${esc(t("back"))}</a>
    <div class="card stack center" style="padding:28px 18px">
      <div style="margin:0 auto;width:56px;height:56px;border-radius:16px;background:var(--accent-soft);display:grid;place-items:center">${icon("lock")}</div>
      <h1>${esc(title)}</h1>
      <p class="muted">${esc(t("lock.body"))}</p>
      ${!a.signedIn ? `<a class="btn primary block" href="/app/signin" data-link>${esc(t("signin"))}</a>` : ""}
      ${a.canStartTrial ? `<button class="btn primary block" data-act="trial">${icon("gift")} ${esc(t("trial.start"))}</button><p class="small muted">${esc(t("trial.sub"))}</p>` : ""}
      <a class="btn ghost block" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a>
    </div>`;
  return onAct(root, { trial: startTrial });
}

export function trialDaysLeft(a, now = Date.now()) {
  if (!a || !a.trialEndsAt || a.trialEndsAt < now) return 0;
  return (a.trialEndsAt - now) / 86400000;
}

export function trialLine(a) {
  const d = trialDaysLeft(a);
  if (!d) return "";
  return d >= 1 ? t("trial.left", { n: Math.ceil(d) }) : t("trial.leftHours", { n: Math.max(1, Math.round(d * 24)) });
}

/** Speech recognition (Chrome/Android, Safari): returns a controller or null if not available. */
export function recognizer({ onText, onEnd }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "en-US"; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
  r.onresult = (e) => { let s = ""; for (const res of e.results) s += res[0].transcript; onText(s.trim(), e.results[e.results.length - 1].isFinal); };
  r.onend = () => onEnd && onEnd();
  r.onerror = () => onEnd && onEnd();
  return r;
}

/** The certificate opens after the final road test, with at least 90% of the course days done (days aren't locked in
 *  order, so the final test alone isn't enough). Returns { ready, final, done, need, next }. */
export function certificateStatus(cat, p) {
  const days = cat.days, isDone = (d) => !!(p.days[d.n] && p.days[d.n].done);
  const final = days.find((d) => d.final) || days[days.length - 1];
  const done = days.filter(isDone).length, need = Math.ceil(days.length * 0.9);
  return { ready: isDone(final) && done >= need, final, done, need, total: days.length, next: days.find((d) => !isDone(d)) || final };
}
