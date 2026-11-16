/* Bits several screens share. */
import { t, pick } from "../i18n.js";
import { esc, icon, onAct } from "../ui.js";
import { state } from "../store.js";
import { startTrial } from "../main.js";

/** Full-page "locked" screen for a lesson the person can't open yet. */
export function lockedView(root, title, backHref = "/app/course") {
  const a = state.me.access;
  root.innerHTML = `
    <a class="back" href="${backHref}" data-link>${icon("left", "ico")} ${esc(t("back"))}</a>
    <div class="card lockcard stack">
      <div class="lock-ic">${icon("lock")}</div>
      <div class="eyebrow">${esc(t("lock.title"))}</div>
      <h1 style="margin:0">${esc(title)}</h1>
      <p class="muted" style="margin:0">${esc(t("lock.body"))}</p>
      ${!a.signedIn ? `<a class="btn primary block" href="/app/signin" data-link>${esc(t("signin"))}</a>` : ""}
      ${a.canStartTrial ? `<button class="btn primary block" data-act="trial">${icon("gift")} ${esc(t("trial.start"))}</button><p class="small muted" style="margin:6px 0 0">${esc(t("trial.sub"))}</p>` : ""}
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

// ---------------------------------------------------------------- the course as a highway: shared by home and the course map
/** A course day's title: the English one leads (it's an English course), the translation goes underneath. */
export const enTitle = (o) => (o && (o.en || pick(o))) || "";
export function trTitle(o) { const tr = pick(o); return tr && tr !== enTitle(o) ? tr : ""; }

export const isDone = (p, n) => !!(p.days[n] && p.days[n].done);

/** The day to do next (the first course day not done), and how far along the course is. */
export function courseState(cat, p) {
  const days = cat.days;
  const done = days.filter((d) => isDone(p, d.n)).length;
  const next = days.find((d) => !isDone(p, d.n)) || days[days.length - 1];
  return { done, total: days.length, pct: days.length ? (done / days.length) * 100 : 0, next, started: days.some((d) => p.days[d.n]) };
}

/** Each week of the course with its days and how many are done; the week holding the next day is "current". */
export function weekStats(cat, p, next) {
  return cat.weeks.map((w) => {
    const days = w.days.map((n) => cat.days.find((d) => d.n === n)).filter(Boolean);
    const done = days.filter((d) => isDone(p, d.n)).length;
    return { ...w, days, done, started: days.some((d) => p.days[d.n]), current: !!next && w.days.includes(next.n) && done < days.length };
  });
}

/** A progress ring: pct 0-100, the number in the middle. light: drawn for a white card instead of the navy hero. */
export function ring(pct, { light = false, label = "" } = {}) {
  const p = Math.max(0, Math.min(100, pct)), r = 32, c = 2 * Math.PI * r;
  return `<div class="ring${light ? " on-light" : ""}" role="img" aria-label="${esc(label || Math.round(p) + "%")}">
    <svg viewBox="0 0 78 78" aria-hidden="true"><circle class="ring-bg" cx="39" cy="39" r="${r}"/>${p > 0 ? `<circle class="ring-fg" cx="39" cy="39" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p / 100)).toFixed(2)}"/>` : ""}</svg>
    <b><span>${Math.round(p)}<small>%</small></span></b></div>`;
}

/** The road with the truck at pct (0-100) of the way to the certificate. */
export function road(pct, label = "") {
  const at = 3 + (Math.max(0, Math.min(100, pct)) * 0.94);
  return `<div class="road" role="img" aria-label="${esc(label)}"><i class="road-fill" style="width:${at.toFixed(1)}%"></i><span class="road-truck" style="left:${at.toFixed(1)}%">${icon("truck")}</span></div>
    <div class="road-ends" aria-hidden="true"><span>${esc(t("road.start"))}</span><span>${esc(t("road.finish"))}</span></div>`;
}
