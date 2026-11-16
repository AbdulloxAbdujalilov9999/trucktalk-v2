/* Lessons, as in the main TruckTalk app: the list of weeks (the orientation first, then 12 "exits"), and a week's page with
 * its days. Grammar and the 50 free video lessons are one tap away. Locked days open the trial/plans sheet. */
import { t } from "../i18n.js";
import { esc, icon, onAct } from "../ui.js";
import { state } from "../store.js";
import { catalog, showLock, go } from "../main.js";
import { courseState, weekStats, titleParts, weekCard, weekDays, weekTitle, dayLabel, isDone, isLocked, partsDone, dayParts, pctOf } from "./common.js";

export default async function course(root, params, { query }) {
  const cat = await catalog();
  // old links: /app/course?w=3
  const wq = query.get("w");
  if (!params[0] && wq && /^\d{1,2}$/.test(wq)) { go("/app/course/" + wq, { replace: true }); return; }
  if (params[0] != null) return week(root, cat, Number(params[0]));
  return list(root, cat);
}

function list(root, cat) {
  const p = state.progress, a = state.me.access;
  const cs = courseState(cat, p);
  const weeks = weekStats(cat, p, cs.next);
  const orient = cat.orientation.days, orientDone = orient.filter((d) => isDone(p, d.n)).length;
  root.innerHTML = `
    <section class="quick quick-two">
      <a class="quick-tile" href="/app/grammar" data-link><span class="quick-ico">${icon("grammar")}</span><span><span class="quick-t">${esc(t("grammar.title"))}</span><span class="quick-s">${esc(t("lessons.grammarSub", { n: cat.grammar.length }))}</span></span></a>
      <a class="quick-tile" href="/app/videos" data-link><span class="quick-ico">${icon("video")}</span><span><span class="quick-t">${esc(t("videos.title"))}</span><span class="quick-s">${esc(t("lessons.videosSub"))}</span></span></a>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>${esc(t("lessons.all"))}</h2>
        <p class="panel-sub">${esc(t("lessons.allSub"))}</p>
      </div>
      <div class="week-grid">
        ${weekCard({ week: 0, badge: icon("bulb"), title: t("lessons.orientation"), sub: t("lessons.orientationSub"), done: orientDone, total: orient.length })}
        ${weeks.map((w) => {
          const tp = titleParts(w.title);
          return weekCard({ week: w.week, badge: String(w.week), title: tp.main, sub: tp.sub, done: w.done, total: w.days.length, current: w.current, locked: w.days.some((d) => isLocked(d, a)) });
        }).join("")}
      </div>
    </section>`;
}

function dayCard(cat, d, p, a, next) {
  const label = dayLabel(cat, d.n), tp = titleParts(d.title);
  const done = isDone(p, d.n), locked = isLocked(d, a);
  const parts = dayParts(d), got = partsDone(p, d), score = pctOf(p.quiz["day:" + d.n]);
  const current = !done && !locked && next && next.n === d.n;
  const cls = ["day-card", done ? "done" : "", locked ? "locked" : "", d.review ? "rev" : "", current ? "current" : ""].filter(Boolean).join(" ");
  return `<a class="${cls}" href="/app/day/${d.n}" ${locked ? `data-act="locked"` : "data-link"}>
    <span class="day-badge">${esc(label)}</span>
    <span class="day-info">
      <span class="day-num">${esc(d.review ? t("lessons.dayReview", { n: label }) : t("lessons.dayCaps", { n: label }))}${d.free && !a.full ? `<span class="badge-free">${esc(t("free"))}</span>` : ""}${current ? `<span class="badge-free">${esc(t("home.upNext"))}</span>` : ""}</span>
      <span class="day-title">${esc(tp.main)}</span>
      ${tp.sub ? `<span class="day-tu">${esc(tp.sub)}</span>` : ""}
      ${done ? `<span class="day-status">${esc(score != null ? t("lessons.score", { n: score }) : t("done"))}</span>`
        : got && !locked ? `<span class="day-status inprog">${esc(t("lesson.partsDone", { a: got, b: parts.length }))}</span>` : ""}
    </span>
    <span class="day-go">${locked ? icon("lock") : done ? icon("checkCircle") : icon("chevron")}</span>
  </a>`;
}

function week(root, cat, w) {
  const days = weekDays(cat, w);
  if (!days.length) { go("/app/course", { replace: true }); return; }
  const p = state.progress, a = state.me.access;
  const next = courseState(cat, p).next;
  const done = days.filter((d) => isDone(p, d.n)).length, pct = Math.round((done / days.length) * 100);
  const tp = titleParts(weekTitle(cat, w));
  const last = cat.weeks.length;
  const wordsIn = days.reduce((s, d) => s + (d.words || 0), 0);
  root.innerHTML = `
    <section class="lesson-head">
      <div class="lesson-head-top">
        <a class="btn ghost sm" href="/app/course" data-link>${icon("arrowL")} ${esc(t("lessons.all"))}</a>
        <div class="lesson-pager">
          ${w > 0 ? `<a class="btn ghost sm" href="/app/course/${w - 1}" data-link aria-label="${esc(w - 1 === 0 ? t("lessons.orientation") : t("week", { n: w - 1 }))}">${icon("arrowL")} ${esc(w - 1 === 0 ? "O" : String(w - 1))}</a>` : ""}
          ${w < last ? `<a class="btn ghost sm" href="/app/course/${w + 1}" data-link aria-label="${esc(t("week", { n: w + 1 }))}">${esc(String(w + 1))} ${icon("arrowR")}</a>` : ""}
        </div>
      </div>
      <p class="eyebrow">${esc(w === 0 ? t("lessons.orientationCaps") : t("lessons.weekOf", { n: w, total: last }))}</p>
      <h1 class="hwy-title">${esc(tp.main)}</h1>
      ${tp.sub ? `<p class="lesson-title-uz">${esc(tp.sub)}</p>` : ""}
      <p class="hero-sub" style="margin-top:10px">${esc(t("lessons.daysDone", { a: done, b: days.length }))}${wordsIn ? " · " + esc(t("lessons.wordsIn", { n: wordsIn })) : ""}</p>
      <div class="progressbar" style="margin-top:12px"><div class="progressbar-fill" style="width:${pct}%"></div></div>
    </section>
    <section class="panel">
      <div class="day-grid">${days.map((d) => dayCard(cat, d, p, a, next)).join("")}</div>
    </section>
    ${wordsIn ? `<a class="quick-tile wide-tile" href="/app/homework#w${w}" data-link><span class="quick-ico">${icon("homework")}</span><span><span class="quick-t">${esc(t("lessons.weekHomework"))}</span><span class="quick-s">${esc(t("lessons.weekHomeworkSub"))}</span></span>${icon("chevron")}</a>` : ""}`;
  return onAct(root, { locked: () => showLock() });
}
