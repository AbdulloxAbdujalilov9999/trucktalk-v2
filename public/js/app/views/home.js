/* Home: a greeting with how far along the course the driver is, the next lesson, today's numbers, the course drawn as a
 * highway (12 weeks = 12 exits), practice for the road, and the rest of the app one tap away. */
import { t, fmtDate } from "../i18n.js";
import { esc, icon, onAct } from "../ui.js";
import { state, xpToday, goal } from "../store.js";
import { catalog, videos, startTrial, planLabel } from "../main.js";
import { streak, dueCards } from "../../shared/progress.js";
import { trialLine, courseState, weekStats, ring, road, enTitle, trTitle } from "./common.js";

function greeting(h = new Date().getHours()) {
  return t(h < 12 ? "greet.morning" : h < 18 ? "greet.afternoon" : "greet.evening");
}

function exitSign(w, i) {
  const n = w.days.length, cls = w.done >= n ? "done" : w.started ? "started" : "";
  const mark = w.done >= n ? icon("check") : w.current ? icon("truck") : "";
  return `<a class="exit ${cls} ${w.current ? "current" : ""}" href="/app/course?w=${w.week}" data-link aria-label="EXIT ${w.week}: ${esc(enTitle(w.title))}, ${w.done}/${n}">
    <span class="exit-tag">EXIT <b>${w.week}</b></span>
    <span class="exit-t">${esc(enTitle(w.title))}</span>
    <span class="exit-dots" aria-hidden="true">${w.days.map((d, j) => `<i class="${j < w.done ? "on" : ""}"></i>`).join("")}</span>
    ${mark ? `<span class="exit-mark" aria-hidden="true">${mark}</span>` : ""}
  </a>`;
}

const mitem = (href, ic, title, sub, extra = "", cls = "") => `
  <a class="mitem" href="${href}" data-link>
    <span class="mi ${cls}">${icon(ic)}</span>
    <span class="grow"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    ${extra}${icon("chevron")}
  </a>`;

export default async function home(root) {
  const [cat, vids] = await Promise.all([catalog(), videos()]);
  const p = state.progress, a = state.me.access, user = state.me.user;
  const first = user && user.name ? user.name.trim().split(/\s+/)[0] : null;
  const cs = courseState(cat, p), next = cs.next;
  const weeks = weekStats(cat, p, next);
  const orientLeft = cat.orientation.days.filter((d) => !(p.days[d.n] && p.days[d.n].done));
  const due = dueCards(p).length;
  const xp = xpToday(), g = goal(), st = streak(p);
  const nextVideo = vids.find((v) => !(p.videos[v.n] && p.videos[v.n].seen)) || vids[0];
  const nextLocked = !next.free && !a.full;
  const pct = Math.round(cs.pct);

  let banner = "";
  if (!a.signedIn) {
    banner = `<div class="card accent row wrap-row"><span class="mi">${icon("shield")}</span><b class="grow">${esc(t("home.saveProgress"))}</b><a class="btn primary" href="/app/signin" data-link>${esc(t("signin"))}</a></div>`;
  } else if (a.canStartTrial) {
    banner = `<div class="card accent stack"><div class="row"><span class="mi amber">${icon("gift")}</span><div class="grow"><b>${esc(t("trial.cta"))}</b><div class="small muted">${esc(t("trial.sub"))}</div></div></div><button class="btn primary block" data-act="trial">${esc(t("trial.start"))}</button></div>`;
  } else if (a.tier === "trial") {
    banner = `<div class="card accent row wrap-row"><span class="mi">${icon("clock")}</span><b class="grow">${esc(trialLine(a))}</b><a class="btn primary sm" href="/app/pricing" data-link>${esc(t("nav.pricing"))}</a></div>`;
  } else if (a.tier === "free" && a.trialUsed) {
    banner = `<div class="card accent row wrap-row"><span class="mi">${icon("lock")}</span><b class="grow">${esc(t("lock.body"))}</b><a class="btn primary sm" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a></div>`;
  }

  root.innerHTML = `
  <div class="stack-lg">
    <section class="card hero">
      <div class="hero-top">
        <div class="grow">
          <div class="eyebrow">${esc(greeting())}</div>
          <h1 class="hero-name">${esc(first || t("home.hiAnon"))}</h1>
          <p class="hero-sub">${esc(cs.done ? t("home.driven", { done: cs.done, total: cs.total }) : t("home.firstTrip"))}</p>
        </div>
        ${ring(pct, { label: t("course.progress", { done: cs.done, total: cs.total }) })}
      </div>
      ${a.paidUntil ? `<p class="hero-paid">${esc(t("paid.until", { plan: planLabel(a), date: fmtDate(a.paidUntil) }))}</p>` : ""}
      <div class="upnext">
        <div class="un-row">
          <span class="daybadge"><small>${esc(t("day.badge"))}</small><b>${next.n}</b></span>
          <span class="grow">
            <span class="eyebrow" style="margin:0">${esc(t("home.upNext"))}</span>
            <span class="un-title">${esc(enTitle(next.title))}</span>
            ${trTitle(next.title) ? `<span class="un-tr">${esc(trTitle(next.title))}</span>` : ""}
            <span class="un-meta"><span>${icon("clock")}${esc(t("lesson.minutes"))}</span>${next.review ? `<span>${icon("repeat")}${esc(t("reviewDay"))}</span>` : ""}${nextLocked ? `<span>${icon("lock")}${esc(t("locked"))}</span>` : next.free && !a.full ? `<span>${icon("gift")}${esc(t("free"))}</span>` : ""}</span>
          </span>
        </div>
        <a class="btn light block" href="/app/day/${next.n}" data-link>${icon("play")} ${esc(cs.started ? t("home.continue") : t("home.startCourse"))}</a>
      </div>
      <div class="hero-stats">
        <a href="/app/profile" data-link>${icon("flame")}<b>${st}</b><span>${esc(t("home.streak")).replace(/-/g, "\u2011")}</span></a>
        <div class="${xp >= g ? "goal-hit" : ""}" title="${esc(t("home.goal", { n: g }))}">${icon(xp >= g ? "check" : "bolt")}<b>${xp}<small> / ${g}</small></b><span>${esc(t("home.xpToday"))}</span></div>
        <a href="/app/review" data-link>${icon("repeat")}<b>${due}</b><span>${esc(t("home.toReview"))}</span></a>
      </div>
    </section>
    ${banner}
    <section class="card">
      <div class="sec-head"><h2 class="sec-title">${esc(t("home.highway"))} <span class="muted">(${pct}%)</span></h2><a href="/app/course" data-link>${esc(t("home.courseMap"))}</a></div>
      ${road(cs.pct, t("course.progress", { done: cs.done, total: cs.total }))}
      <div class="exits">${weeks.map(exitSign).join("")}</div>
    </section>
    <section>
      <div class="sec-head"><h2 class="sec-title">${esc(t("home.practice"))}</h2><a href="/app/practice" data-link>${esc(t("home.allPractice"))}</a></div>
      <div class="quick">
        <a class="qtile q-blue" href="/app/listen" data-link><span class="qi">${icon("headphones")}</span><b>${esc(t("listen.title"))}</b><small>${esc(t("home.listenSub"))}</small></a>
        <a class="qtile q-green" href="/app/talk" data-link><span class="badge">AI</span><span class="qi">${icon("chat")}</span><b>${esc(t("talk.title"))}</b><small>${esc(t("home.talkSub"))}</small></a>
        <a class="qtile q-amber" href="/app/practice/numbers" data-link><span class="qi">${icon("hash")}</span><b>${esc(t("game.numbers"))}</b><small>${esc(t("home.numbersSub"))}</small></a>
      </div>
    </section>
    <section>
      <div class="sec-head"><h2 class="sec-title">${esc(t("home.more"))}</h2></div>
      <div class="card menu">
        ${mitem("/app/review", "repeat", t("nav.review"), due ? t("home.reviewReady", { n: due }) : t("home.reviewNone"), due ? `<span class="badge warn">${due}</span>` : "", "amber")}
        ${!cs.started && orientLeft.length ? mitem(`/app/day/${orientLeft[0].n}`, "sign", t("orientation"), t("orientation.sub"), "", "green") : ""}
        ${mitem(`/v/${nextVideo.n}`, "video", t("home.nextVideo"), `${t("lesson", { n: nextVideo.n })}: ${nextVideo.title.uz} · ${nextVideo.title.en}`)}
        ${mitem("/app/teacher", "chat", t("nav.teacher"), t("home.askTeacher"))}
        ${mitem("/app/grammar", "book", t("grammar.title"), t("grammar.sub"))}
        ${mitem("/app/words", "search", t("words.title"), t("words.sub"))}
      </div>
    </section>
  </div>`;
  return onAct(root, { trial: startTrial });
}
