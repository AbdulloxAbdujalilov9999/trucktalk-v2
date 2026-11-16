/* Bits several screens share: course titles and day labels, the progress ring, week cards, the "locked" screen,
 * speech recognition, the certificate rule. */
import { t, pick, lang } from "../i18n.js";
import { esc, icon, onAct } from "../ui.js";
import { state } from "../store.js";
import { startTrial } from "../main.js";

// ---------------------------------------------------------------- the course
/** A course title as the main app shows it: in the Uzbek and Russian interface the translation leads and the English
 *  goes underneath; in the English interface the English leads and the Uzbek goes underneath. */
export function titleParts(o) {
  const en = (o && o.en) || "", tr = pick(o);
  if (lang() === "en") return { main: en || tr, sub: tr && tr !== en ? tr : "" };
  return { main: tr || en, sub: en && en !== tr ? en : "" };
}
/** The English title (it is an English course) and its translation, for places that show both the same way always. */
export const enTitle = (o) => (o && (o.en || pick(o))) || "";
export function trTitle(o) { const tr = pick(o); return tr && tr !== enTitle(o) ? tr : ""; }

export const allDays = (cat) => [...cat.orientation.days, ...cat.days];
export const dayRow = (cat, n) => allDays(cat).find((d) => d.n === n) || null;
/** Orientation days are numbered -4..0 so they sort before day 1; students see them as O1..O5. */
export function dayLabel(cat, n) {
  if (n > 0) return String(n);
  const i = cat.orientation.days.findIndex((d) => d.n === n);
  return "O" + (i + 1);
}
/** The days of a week: week 0 is the orientation. */
export function weekDays(cat, w) {
  if (w === 0) return cat.orientation.days;
  const wk = cat.weeks.find((x) => x.week === w);
  return wk ? wk.days.map((n) => cat.days.find((d) => d.n === n)).filter(Boolean) : [];
}
export const weekTitle = (cat, w) => (w === 0 ? { en: "Orientation — Start Here", uz: "Boshlangʻich darslar", ru: "Вводные уроки" } : (cat.weeks.find((x) => x.week === w) || {}).title);
export const isDone = (p, n) => !!(p.days[n] && p.days[n].done);
export const isLocked = (d, a) => !!d && !d.free && !(a && a.full);

/** The parts of a day, one per lesson tab, by the step each one marks: Words, Conversation, Grammar, Quiz; a review day has
 *  Practice (with the week's words), Conversation and the review quiz. Speaking sits inside Conversation as an extra. */
export const dayParts = (d) => (d.review ? ["words", "dialogue", "quiz"] : ["words", "dialogue", "grammar", "quiz"]);
export function partsDone(p, d) { const s = (p.days[d.n] && p.days[d.n].s) || {}; return dayParts(d).filter((k) => s[k]).length; }
/** A quiz result as a percentage, or null. */
export const pctOf = (q) => (q && q.total ? Math.round((q.best / q.total) * 100) : null);

/** Homework: one session per day that teaches words (the orientation's and the lesson days'), quizzed on those words. */
export const homeworkDays = (cat) => allDays(cat).filter((d) => d.words > 0);
export function homeworkStats(cat, p) {
  const days = homeworkDays(cat);
  const done = days.map((d) => p.quiz["hw:" + d.n]).filter(Boolean);
  const avg = done.length ? Math.round(done.reduce((s, q) => s + pctOf(q), 0) / done.length) : 0;
  return { total: days.length, done: done.length, avg };
}

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

/** A week (an "exit") as a card: badge, done/total, title and a thin progress bar. */
export function weekCard({ week, badge, title, sub = "", done, total, current = false, locked = false }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const full = total && done >= total;
  return `<a class="week-card${full ? " done" : ""}${current ? " current" : ""}" href="/app/course/${week}" data-link>
    <span class="week-top"><span class="week-badge">${badge}</span><span class="week-count">${locked && !done ? icon("lock") : ""}${done}/${total}</span></span>
    <span class="week-title">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    <span class="week-bar"><span style="width:${pct}%"></span></span>
  </a>`;
}

/** A progress ring (pct 0-100) with the number in the middle. light: drawn on a white panel instead of the navy hero. */
export function ring(pct, { light = false, label = "" } = {}) {
  const p = Math.max(0, Math.min(100, pct)), c = 2 * Math.PI * 34;
  return `<div class="ring${light ? " on-light" : ""}" role="img" aria-label="${esc(label || Math.round(p) + "%")}">
    <svg viewBox="0 0 80 80" aria-hidden="true"><circle class="ring-bg" cx="40" cy="40" r="34"/>${p > 0 ? `<circle class="ring-fg" cx="40" cy="40" r="34" stroke-dasharray="${((p / 100) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 40 40)"/>` : ""}</svg>
    <span class="ring-num">${Math.round(p)}<small>%</small></span></div>`;
}

/** The head of a page, drawn like the main app's lesson page: a back button (and anything that sits right of it), a
 * small eyebrow, the title, its translation, a line about the page, and anything else (a picker, badges) under it.
 * `game` is for a screen you play on: a smaller title, so the room goes to the game. sub and body are HTML. */
export function pageHead({ back = "", backLabel = "", right = "", eyebrow = "", title, tr = "", sub = "", body = "", game = false }) {
  const top = back || right
    ? `<div class="lesson-head-top">${back ? `<a class="btn ghost sm" href="${esc(back)}" data-link>${icon("arrowL")} ${esc(backLabel || t("back"))}</a>` : "<span></span>"}${right}</div>` : "";
  return `<section class="lesson-head${game ? " game-head" : ""}">
    ${top}
    ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ""}
    <h1 class="hwy-title">${esc(title)}</h1>
    ${tr ? `<p class="lesson-title-uz">${esc(tr)}</p>` : ""}
    ${sub ? `<p class="hero-sub head-sub">${sub}</p>` : ""}
    ${body}
  </section>`;
}

// ---------------------------------------------------------------- access
/** Full-page "locked" screen for a lesson the person can't open yet. */
export function lockedView(root, title, backHref = "/app/course") {
  const a = state.me.access;
  root.innerHTML = `
    <a class="btn ghost sm" style="align-self:flex-start" href="${backHref}" data-link>${icon("arrowL")} ${esc(t("back"))}</a>
    <section class="panel lockcard stack">
      <div class="lock-ic">${icon("lock")}</div>
      <p class="eyebrow">${esc(t("lock.title"))}</p>
      <h1 class="hwy-title" style="font-size:1.6rem">${esc(title)}</h1>
      <p class="panel-sub">${esc(t("lock.body"))}</p>
      <ul class="perks">
        <li>${icon("check")}<span>${esc(t("lock.perk1"))}</span></li>
        <li>${icon("check")}<span>${esc(t("lock.perk2"))}</span></li>
        <li>${icon("check")}<span>${esc(t("lock.perk3"))}</span></li>
      </ul>
      ${!a.signedIn ? `<a class="btn primary block" href="/app/signin?next=${encodeURIComponent(location.pathname)}" data-link>${esc(t("signin"))}</a>` : ""}
      ${a.canStartTrial ? `<button class="btn primary block" data-act="trial">${icon("gift")} ${esc(t("trial.start"))}</button><p class="hint">${esc(t("trial.sub"))}</p>` : ""}
      <a class="btn ghost block" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a>
    </section>`;
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

// ---------------------------------------------------------------- speech, certificate
/** Speech recognition (Chrome/Android, Safari): returns a controller or null if not available. */
export function recognizer({ onText, onEnd, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "en-US"; r.interimResults = true; r.maxAlternatives = 3; r.continuous = false;
  r.onresult = (e) => {
    let s = "";
    for (const res of e.results) s += res[0].transcript;
    const last = e.results[e.results.length - 1];
    const alts = last && last.isFinal ? [...last].map((x) => x.transcript.trim()).filter(Boolean) : [];
    onText(s.trim(), !!(last && last.isFinal), alts);
  };
  r.onend = () => onEnd && onEnd();
  r.onerror = (e) => { if (onError) onError(e && e.error); };
  return r;
}
export const hasSpeech = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

/** The certificate opens after the final road test, with at least 90% of the course days done (days aren't locked in
 *  order, so the final test alone isn't enough). Returns { ready, final, done, need, next }. */
export function certificateStatus(cat, p) {
  const days = cat.days, done1 = (d) => isDone(p, d.n);
  const final = days.find((d) => d.final) || days[days.length - 1];
  const done = days.filter(done1).length, need = Math.ceil(days.length * 0.9);
  return { ready: done1(final) && done >= need, final, done, need, total: days.length, next: days.find((d) => !done1(d)) || final };
}
