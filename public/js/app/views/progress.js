/* Progress, as in the main TruckTalk app: the four big numbers and the certificate, the grammar book, and every day you
 * have completed with its date and score. Added: the last seven days of XP against the daily goal, homework, review,
 * videos and conversations at a glance, the quizzes worth taking again, and badges. */
import { t, fmtDate } from "../i18n.js";
import { esc, icon } from "../ui.js";
import { state, goal } from "../store.js";
import { catalog } from "../main.js";
import { streak, bestStreak, totalXp, xpByDay, dayKey, dueCards } from "../../shared/progress.js";
import { courseState, certificateStatus, homeworkStats, allDays, dayLabel, titleParts, isDone, pctOf } from "./common.js";

const REDO_BELOW = 70;

/** Badges: earned once, kept for good (they are worked out from progress that never goes down). */
function badgeList(p, cat) {
  const done = (n) => isDone(p, n);
  const courseDone = cat.days.filter((d) => done(d.n)).length;
  const week1 = cat.days.filter((d) => d.week === 1);
  const seen = Object.values(p.videos).filter((v) => v && v.seen).length;
  const hw = Object.keys(p.quiz).filter((k) => k.startsWith("hw:")).length;
  const talks = Object.keys(p.quiz).filter((k) => k.startsWith("rp:")).length;
  return [
    { k: "badge.firstDay", on: courseDone >= 1, ic: "star" },
    { k: "badge.week", on: week1.length > 0 && week1.every((d) => done(d.n)), ic: "check" },
    { k: "badge.streak7", on: bestStreak(p) >= 7, ic: "flame" },
    { k: "badge.hw10", on: hw >= 10, ic: "homework" },
    { k: "badge.talk5", on: talks >= 5, ic: "talk" },
    { k: "badge.videos10", on: seen >= 10, ic: "video" },
    { k: "badge.half", on: courseDone >= Math.ceil(cat.days.length / 2), ic: "bolt" },
    { k: "badge.all", on: courseDone >= cat.days.length, ic: "trophy" },
  ];
}

/** The last seven days of XP as bars, with the daily goal as a dashed line. */
function weekChart(p) {
  const by = xpByDay(p), g = goal(), names = t("weekdays").split(",");
  const now = Date.now();
  const days = Array.from({ length: 7 }, (_, i) => {
    const at = new Date(now - (6 - i) * 86400000);
    return { xp: by[dayKey(at.getTime())] || 0, name: names[at.getDay()] || "", today: i === 6 };
  });
  const top = Math.max(g, ...days.map((x) => x.xp)) * 1.2 || 1;   // room above the tallest bar for its number
  const hit = days.filter((x) => x.xp >= g).length;
  const label = days.map((x) => `${x.name}: ${x.xp} XP`).join(", ");
  return { hit, html: `<div class="xpchart" role="img" aria-label="${esc(label)}">
    <div class="xpplot">
      <span class="xpgoal" style="bottom:${((g / top) * 100).toFixed(1)}%"><i>${g}</i></span>
      ${days.map((x) => `<div class="xpcol${x.xp >= g ? " hit" : ""}${x.today ? " today" : ""}">${x.xp ? `<i style="height:${((x.xp / top) * 100).toFixed(1)}%"><b>${x.xp}</b></i>` : ""}</div>`).join("")}
    </div>
    <div class="xpdays">${days.map((x) => `<span${x.today ? ' class="today"' : ""}>${esc(x.name)}</span>`).join("")}</div>
  </div>` };
}

export default async function progress(root) {
  const cat = await catalog();
  const p = state.progress;
  const cs = courseState(cat, p);
  const cert = certificateStatus(cat, p);
  const hw = homeworkStats(cat, p);
  const days = allDays(cat);
  const scored = cat.days.map((d) => pctOf(p.quiz["day:" + d.n])).filter((x) => x != null);
  const avg = scored.length ? Math.round(scored.reduce((s, x) => s + x, 0) / scored.length) : 0;
  const grammarRead = cat.grammar.filter((g) => p.grammar[g.id] && p.grammar[g.id].read).length;
  const seen = Object.values(p.videos).filter((v) => v && v.seen).length;
  const talks = Object.keys(p.quiz).filter((k) => k.startsWith("rp:")).length;
  const cards = Object.keys(p.srs).length, due = dueCards(p).length;
  const active = Object.values(xpByDay(p)).filter((n) => n > 0).length;
  const chart = weekChart(p);
  const badges = badgeList(p, cat);

  // days done, in course order, with when and how well
  const log = days.filter((d) => isDone(p, d.n)).map((d) => ({ d, at: p.days[d.n].done, score: pctOf(p.quiz["day:" + d.n]) }));
  // quizzes worth another go: a day's quiz or a homework session under 70%
  const redo = [
    ...days.map((d) => ({ d, kind: "day", score: pctOf(p.quiz["day:" + d.n]) })),
    ...days.map((d) => ({ d, kind: "hw", score: pctOf(p.quiz["hw:" + d.n]) })),
  ].filter((x) => x.score != null && x.score < REDO_BELOW).sort((x, y) => x.score - y.score).slice(0, 8);

  const certBox = cert.ready
    ? `<div class="cert-callout">${icon("trophy")}<p>${esc(t("progress.certReady"))}</p><a class="btn primary" href="/app/certificate" data-link>${esc(t("progress.certOpen"))}</a></div>`
    : `<div class="cert-callout"><span class="tip-ic">${icon("award")}</span><p>${esc(t("progress.certHow", { need: cert.need, total: cert.total }))}<span class="cert-sub">${esc(t("progress.certSoFar", { n: cert.done }))}${isDone(p, cert.final.n) ? "" : " · " + esc(t("progress.certFinal"))}</span></p></div>`;

  root.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>${esc(t("progress.title"))}</h2></div>
      <div class="pstats">
        <div class="pstat"><b>${cs.done}<small>/${cs.total}</small></b><span>${esc(t("progress.daysDone"))}</span></div>
        <div class="pstat"><b>${streak(p)}</b><span>${esc(t("stat.streak"))}</span></div>
        <div class="pstat"><b>${scored.length ? avg + "%" : "—"}</b><span>${esc(t("progress.avgQuiz"))}</span></div>
        <div class="pstat"><b>${totalXp(p)}</b><span>${esc(t("profile.xp"))}</span></div>
      </div>
      <div style="margin-top:18px">${certBox}</div>
    </section>

    <section class="panel">
      <div class="panel-head panel-head-row">
        <div><h2>${esc(t("progress.week"))}</h2><p class="panel-sub">${esc(t("progress.weekSub", { n: goal() }))}</p></div>
        <span class="badge ${chart.hit ? "ok" : ""}">${esc(t("progress.goalDays", { n: chart.hit }))}</span>
      </div>
      ${chart.html}
      <a class="hero-link" style="color:var(--accent-mid)" href="/app/settings" data-link>${esc(t("progress.changeGoal"))}</a>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>${esc(t("progress.more"))}</h2></div>
      <div class="pstats">
        <a class="pstat" href="/app/homework" data-link><b>${hw.done}<small>/${hw.total}</small></b><span>${esc(t("nav.homework"))}</span></a>
        <a class="pstat" href="/app/grammar" data-link><b>${grammarRead}<small>/${cat.grammar.length}</small></b><span>${esc(t("progress.grammarRead"))}</span></a>
        <a class="pstat" href="/app/videos" data-link><b>${seen}<small>/${cat.videos.length}</small></b><span>${esc(t("profile.videosSeen"))}</span></a>
        <div class="pstat"><b>${talks}</b><span>${esc(t("progress.talks"))}</span></div>
        <a class="pstat" href="/app/review" data-link><b>${cards}</b><span>${esc(t("profile.cards"))}</span></a>
        <a class="pstat" href="/app/review" data-link><b>${due}</b><span>${esc(t("progress.dueNow"))}</span></a>
        <div class="pstat"><b>${bestStreak(p)}</b><span>${esc(t("profile.bestStreak"))}</span></div>
        <div class="pstat"><b>${active}</b><span>${esc(t("progress.activeDays"))}</span></div>
      </div>
    </section>

    ${redo.length ? `<section class="panel">
      <div class="panel-head"><h2>${esc(t("progress.redo"))}</h2><p class="panel-sub">${esc(t("progress.redoSub", { n: REDO_BELOW }))}</p></div>
      <div class="list">${redo.map((x) => `<a class="item" href="${x.kind === "day" ? `/app/day/${x.d.n}?tab=quiz` : `/app/homework/${x.d.n}`}" data-link>
        <span class="n">${esc(dayLabel(cat, x.d.n))}</span>
        <span class="grow"><span class="t" style="display:block">${esc(titleParts(x.d.title).main)}</span><span class="s">${esc(x.kind === "day" ? t("tab.quiz") : t("nav.homework"))} · ${x.score}%</span></span>
        ${icon("refresh")}
      </a>`).join("")}</div>
    </section>` : ""}

    <section class="panel">
      <div class="panel-head"><h2>${esc(t("profile.badges"))}</h2><p class="panel-sub">${esc(t("progress.badgesSub", { a: badges.filter((b) => b.on).length, b: badges.length }))}</p></div>
      <div class="badge-grid">${badges.map((b) => `<div class="bdg${b.on ? "" : " off"}"><span class="bi">${icon(b.ic)}</span><b>${esc(t(b.k))}</b></div>`).join("")}</div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>${esc(t("grammar.book"))}</h2>
        <p class="panel-sub">${esc(t("progress.unitsDone", { a: grammarRead, b: cat.grammar.length }))}</p>
      </div>
      <div class="progressbar"><div class="progressbar-fill" style="width:${cat.grammar.length ? Math.round((grammarRead / cat.grammar.length) * 100) : 0}%"></div></div>
      <a class="btn ghost sm" style="margin-top:14px" href="/app/grammar" data-link>${icon("grammar")} ${esc(t("progress.openGrammar"))}</a>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>${esc(t("progress.completed"))}</h2></div>
      ${log.length ? `<div class="log-table">
        <div class="log-row log-head"><span>${esc(t("progress.colDay"))}</span><span>${esc(t("progress.colDate"))}</span><span>${esc(t("progress.colScore"))}</span></div>
        ${log.map((x) => `<a class="log-row" href="/app/day/${x.d.n}" data-link><span>${esc(t("day", { n: dayLabel(cat, x.d.n) }))}</span><span>${esc(fmtDate(x.at))}</span><span>${x.score != null ? x.score + "%" : "—"}</span></a>`).join("")}
      </div>` : `<p class="panel-sub">${esc(t("progress.none"))}</p><a class="btn primary" style="margin-top:14px" href="/app/course" data-link>${esc(t("nav.lessons"))} ${icon("arrowR")}</a>`}
    </section>`;
}
