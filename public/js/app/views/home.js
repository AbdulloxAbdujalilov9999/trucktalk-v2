/* Home, laid out like the main TruckTalk app's dashboard: a greeting with the progress ring, the next lesson and today's
 * numbers; the course as a highway of 60 days; the 12 weeks. Added on top: a line about the plan or signing in, and three
 * kinds of practice for the road one tap away. */
import { t, fmtDate } from "../i18n.js";
import { esc, icon, onAct } from "../ui.js";
import { state, xpToday, goal } from "../store.js";
import { catalog, startTrial, planLabel, showLock } from "../main.js";
import { streak, dueCards } from "../../shared/progress.js";
import { trialLine, courseState, weekStats, ring, titleParts, weekCard, isDone, isLocked, homeworkStats, dayParts } from "./common.js";

function greeting(h = new Date().getHours()) {
  return t(h < 12 ? "greet.morning" : h < 18 ? "greet.afternoon" : "greet.evening");
}

/** The note above the hero: sign in to keep progress, start the free trial, days left, or what a free account gets. */
function banner(a) {
  const box = (ic, title, sub, action) => `<section class="trial-banner">
    <span class="trial-banner-ico">${icon(ic)}</span>
    <div class="trial-banner-text"><p class="trial-banner-days">${esc(title)}</p>${sub ? `<p class="trial-banner-sub">${esc(sub)}</p>` : ""}</div>
    ${action}</section>`;
  if (!a.signedIn) return box("shield", t("home.saveProgress"), t("home.saveProgressSub"), `<a class="btn primary sm" href="/app/signin" data-link>${esc(t("signin"))}</a>`);
  if (a.canStartTrial) return box("gift", t("trial.cta"), t("trial.sub"), `<button class="btn primary sm" data-act="trial">${esc(t("trial.start"))}</button>`);
  if (a.tier === "trial") return box("clock", trialLine(a), t("home.trialSub"), `<a class="btn primary sm" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a>`);
  if (a.tier === "free" && a.trialUsed) return box("lock", t("home.freeTitle"), t("lock.body"), `<a class="btn primary sm" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a>`);
  return "";
}

export default async function home(root) {
  const cat = await catalog();
  const p = state.progress, a = state.me.access, user = state.me.user;
  const first = user && user.name ? user.name.trim().split(/\s+/)[0] : "";
  const cs = courseState(cat, p), next = cs.next, pct = Math.round(cs.pct);
  const weeks = weekStats(cat, p, next);
  const hw = homeworkStats(cat, p);
  const due = dueCards(p).length;
  const xp = xpToday(), g = goal(), st = streak(p);
  const nt = titleParts(next.title);
  const nextLocked = isLocked(next, a);
  const orientLeft = cat.orientation.days.filter((d) => !isDone(p, d.n));

  const dots = cat.days.map((d) => {
    const done = isDone(p, d.n), locked = isLocked(d, a);
    const cls = ["dot", done ? "done" : locked ? "locked" : "unlocked", d.review ? "rev" : "", d.n === next.n && !done ? "next" : ""].filter(Boolean).join(" ");
    return `<a class="${cls}" href="/app/day/${d.n}" ${locked ? `data-act="locked"` : "data-link"} title="${esc(t("lesson.title", { n: d.n, title: titleParts(d.title).main }))}">${d.n}</a>`;
  }).join("");

  root.innerHTML = `
    ${banner(a)}
    <section class="hero-strip">
      <div class="hero-top">
        <div class="hero-left">
          <p class="eyebrow">${esc(first ? greeting() : t("home.eyebrow"))}</p>
          <h1 class="hwy-title">${esc(first || t("home.route"))}</h1>
          <p class="hero-sub">${esc(cs.done ? t("home.driven", { n: cs.done, total: cs.total }) : t("home.letsStart"))}</p>
        </div>
        ${ring(pct, { label: t("course.progress", { done: cs.done, total: cs.total }) })}
      </div>
      ${a.paidUntil ? `<p class="hero-paid">${esc(t("paid.until", { plan: planLabel(a), date: fmtDate(a.paidUntil) }))}</p>` : ""}
      <div class="upnext">
        <div class="upnext-badge"><small>${esc(t("day.badge"))}</small><b>${next.n}</b></div>
        <div class="upnext-text">
          <p class="upnext-label">${esc(!cs.started ? t("home.startHere") : next.review ? t("home.upNextReview") : t("home.upNext"))}</p>
          <h2>${esc(nt.main)}</h2>
          ${nt.sub ? `<p class="upnext-tu">${esc(nt.sub)}</p>` : ""}
          <p class="upnext-meta"><span>${icon("clock")} ${esc(t("lesson.partsMin", { n: dayParts(next).length, min: t(next.review ? "lesson.minReview" : "lesson.min") }))}</span>${nextLocked ? `<span>${icon("lock")} ${esc(t("locked"))}</span>` : next.free && !a.full ? `<span>${icon("gift")} ${esc(t("free"))}</span>` : ""}</p>
        </div>
        <a class="btn primary lg" href="/app/day/${next.n}" ${nextLocked ? `data-act="locked"` : "data-link"}>${esc(cs.started ? t("continue") : t("start"))} ${icon("arrowR")}</a>
      </div>
      <div class="hero-stats">
        <a class="stat-tile" href="/app/progress" data-link><span class="stat-ico">${icon("flame")}</span><span class="stat-num">${st}</span><span class="stat-label">${esc(t("stat.streak"))}</span></a>
        <div class="stat-tile${xp >= g ? " goal-hit" : ""}" title="${esc(t("home.goal", { n: g }))}"><span class="stat-ico">${icon(xp >= g ? "checkCircle" : "bolt")}</span><span class="stat-num">${xp}<span class="stat-den">/${g}</span></span><span class="stat-label">${esc(t("stat.xpToday"))}</span></div>
        <a class="stat-tile" href="/app/homework" data-link><span class="stat-ico">${icon("homework")}</span><span class="stat-num">${hw.done}<span class="stat-den">/${hw.total}</span></span><span class="stat-label">${esc(t("nav.homework"))}</span></a>
      </div>
      ${a.signedIn && !first ? `<a class="hero-link" href="/app/settings" data-link>${esc(t("home.setName"))}</a>` : ""}
    </section>

    <section class="quick">
      <a class="quick-tile" href="/app/listen" data-link><span class="quick-ico">${icon("headphones")}</span><span class="quick-t">${esc(t("listen.title"))}</span><span class="quick-s">${esc(t("home.listenSub"))}</span></a>
      <a class="quick-tile" href="/app/talk" data-link><span class="badge info">AI</span><span class="quick-ico">${icon("talk")}</span><span class="quick-t">${esc(t("talk.title"))}</span><span class="quick-s">${esc(t("home.talkSub"))}</span></a>
      <a class="quick-tile" href="/app/review" data-link>${due ? `<span class="badge warn">${due}</span>` : ""}<span class="quick-ico">${icon("cards")}</span><span class="quick-t">${esc(t("nav.review"))}</span><span class="quick-s">${esc(due ? t("home.reviewDue", { n: due }) : t("home.reviewSub"))}</span></a>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>${esc(t("home.highway"))} <span class="mono">(${pct}%)</span></h2>
        <p class="panel-sub">${esc(t("home.highwaySub"))}</p>
      </div>
      <div class="route"><div class="route-fill" style="width:${pct}%"></div><span class="route-truck" style="left:${Math.min(96, Math.max(4, pct))}%">${icon("truck")}</span></div>
      <div class="road">${dots}</div>
      <div class="legend">
        <span><i class="sw done"></i>${esc(t("legend.done"))}</span>
        <span><i class="sw unlocked"></i>${esc(t("legend.open"))}</span>
        <span><i class="sw locked"></i>${esc(t("legend.locked"))}</span>
        <span><i class="sw rev"></i>${esc(t("reviewDay"))}</span>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head panel-head-row"><h2>${esc(t("home.weeks"))}</h2><a class="btn ghost sm" href="/app/course" data-link>${esc(t("lessons.all"))}</a></div>
      <div class="week-grid">
        ${orientLeft.length && !cs.started ? weekCard({ week: 0, badge: icon("bulb"), title: t("lessons.orientation"), sub: t("lessons.orientationSub"), done: cat.orientation.days.length - orientLeft.length, total: cat.orientation.days.length }) : ""}
        ${weeks.map((w) => weekCard({ week: w.week, badge: String(w.week), title: titleParts(w.title).main, done: w.done, total: w.days.length, current: w.current, locked: w.days.some((d) => isLocked(d, a)) })).join("")}
      </div>
    </section>`;
  return onAct(root, { trial: startTrial, locked: () => showLock() });
}
