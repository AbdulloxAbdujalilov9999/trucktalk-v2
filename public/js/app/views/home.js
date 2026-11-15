/* Home: where you left off, today's goal, review, the next video lesson, and the trial/plan offer. */
import { t, pick, fmtDate } from "../i18n.js";
import { esc, icon, bar, onAct } from "../ui.js";
import { state, xpToday, goal } from "../store.js";
import { catalog, videos, startTrial, planLabel } from "../main.js";
import { streak, daysDone, dueCards } from "../../shared/progress.js";
import { trialLine } from "./common.js";

export default async function home(root) {
  const [cat, vids] = await Promise.all([catalog(), videos()]);
  const p = state.progress, a = state.me.access, user = state.me.user;
  const first = user && user.name ? user.name.split(" ")[0] : null;
  const days = cat.days;
  const next = days.find((d) => !(p.days[d.n] && p.days[d.n].done)) || days[days.length - 1];
  const started = days.some((d) => p.days[d.n]);
  const orientDone = cat.orientation.days.filter((d) => p.days[d.n] && p.days[d.n].done).length;
  const due = dueCards(p).length;
  const xp = xpToday(), g = goal();
  const nextVideo = vids.find((v) => !(p.videos[v.n] && p.videos[v.n].seen)) || vids[0];
  const nextLocked = !next.free && !a.full;

  let banner = "";
  if (!a.signedIn) {
    banner = `<div class="card accent row wrap-row"><div class="grow"><b>${esc(t("home.saveProgress"))}</b></div><a class="btn dark" href="/app/signin" data-link>${esc(t("signin"))}</a></div>`;
  } else if (a.canStartTrial) {
    banner = `<div class="card accent stack"><div class="row">${icon("gift")}<b class="grow">${esc(t("trial.cta"))}</b></div><p class="small muted" style="margin:0">${esc(t("trial.sub"))}</p><button class="btn primary" data-act="trial">${esc(t("trial.start"))}</button></div>`;
  } else if (a.tier === "trial") {
    banner = `<div class="card accent row wrap-row"><div class="grow"><b>${esc(trialLine(a))}</b></div><a class="btn dark" href="/app/pricing" data-link>${esc(t("nav.pricing"))}</a></div>`;
  } else if (a.tier === "free" && a.trialUsed) {
    banner = `<div class="card accent row wrap-row"><div class="grow"><b>${esc(t("lock.body"))}</b></div><a class="btn dark" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a></div>`;
  }

  root.innerHTML = `
  <div class="stack-lg">
    <section class="card hero stack">
      <div class="eyebrow" style="color:#ffd36b">${esc(t("home.tagline"))}</div>
      <h1 style="margin:0">${esc(first ? t("home.hi", { name: first }) : t("home.hiAnon"))}</h1>
      ${a.paidUntil ? `<div class="muted">${esc(t("paid.until", { plan: planLabel(a), date: fmtDate(a.paidUntil) }))}</div>` : ""}
      <a class="btn primary" style="align-self:flex-start" href="/app/day/${next.n}" data-link>
        ${icon("play")} ${esc(started ? t("home.continue") : t("home.startCourse"))}: ${esc(t("day", { n: next.n }))} · ${esc(pick(next.title))}
        ${nextLocked ? icon("lock") : ""}
      </a>
    </section>
    ${banner}
    <section class="stats">
      <div class="stat"><b>${icon("flame", "ico")} ${streak(p)}</b><span>${esc(t("home.streak"))}</span></div>
      <div class="stat"><b>${xp}<small class="muted" style="font-size:.8rem"> / ${g}</small></b><span>${esc(t("home.xpToday"))}</span>${bar((xp / g) * 100, xp >= g ? "ok" : "")}</div>
      <div class="stat"><b>${daysDone({ days: Object.fromEntries(Object.entries(p.days).filter(([k]) => +k >= 1)) })}<small class="muted" style="font-size:.8rem"> / 60</small></b><span>${esc(t("home.daysDone"))}</span></div>
      <div class="stat"><b>${due}</b><span>${esc(t("home.toReview"))}</span></div>
    </section>
    ${xp >= g ? `<div class="card flat center"><b>${esc(t("home.goalDone"))}</b></div>` : ""}
    <section class="grid grid-2">
      <a class="card link stack" href="/app/review" data-link>
        <div class="row">${icon("repeat")}<h3 style="margin:0">${esc(t("nav.review"))}</h3></div>
        <p class="muted" style="margin:0">${esc(due ? t("home.reviewReady", { n: due }) : t("home.reviewNone"))}</p>
      </a>
      <a class="card link stack" href="/v/${nextVideo.n}" data-link>
        <div class="row">${icon("video")}<h3 style="margin:0">${esc(t("home.nextVideo"))}</h3></div>
        <p style="margin:0"><b>${esc(t("lesson", { n: nextVideo.n }))}:</b> ${esc(nextVideo.title.uz)} <span class="muted">· ${esc(nextVideo.title.en)}</span></p>
      </a>
      ${orientDone < cat.orientation.days.length && !started ? `
      <a class="card link stack" href="/app/day/${cat.orientation.days[orientDone].n}" data-link>
        <div class="row">${icon("sign")}<h3 style="margin:0">${esc(t("orientation"))}</h3></div>
        <p class="muted" style="margin:0">${esc(t("orientation.sub"))}</p>
      </a>` : ""}
      <a class="card link stack" href="/app/teacher" data-link>
        <div class="row">${icon("chat")}<h3 style="margin:0">${esc(t("nav.teacher"))}</h3></div>
        <p class="muted" style="margin:0">${esc(t("home.askTeacher"))}</p>
      </a>
      <a class="card link stack" href="/app/grammar" data-link>
        <div class="row">${icon("book")}<h3 style="margin:0">${esc(t("grammar.title"))}</h3></div>
        <p class="muted" style="margin:0">${esc(t("grammar.sub"))}</p>
      </a>
      <a class="card link stack" href="/app/words" data-link>
        <div class="row">${icon("search")}<h3 style="margin:0">${esc(t("words.title"))}</h3></div>
        <p class="muted" style="margin:0">${esc(t("words.sub"))}</p>
      </a>
    </section>
  </div>`;
  return onAct(root, { trial: startTrial });
}
