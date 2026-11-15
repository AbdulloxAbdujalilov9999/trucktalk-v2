/* The course map: orientation lessons, then 12 weeks of 5 days. Locked days open the trial/plans sheet. */
import { t, pick } from "../i18n.js";
import { esc, icon, bar, onAct } from "../ui.js";
import { state } from "../store.js";
import { catalog, showLock } from "../main.js";

function tile(d, p, a, current, label) {
  const prog = p.days[d.n];
  const done = prog && prog.done;
  const locked = !d.free && !a.full;
  const cls = ["day", done ? "done" : "", locked ? "locked" : "", d.review ? "review" : "", current ? "current" : ""].join(" ");
  const st = done ? `<span class="badge ok">${icon("check", "ico")}</span>` : locked ? `<span class="badge">${icon("lock", "ico")}</span>` : d.free && !a.full ? `<span class="badge info">${esc(t("free"))}</span>` : "";
  const attrs = locked ? `href="/app/day/${d.n}" data-act="locked"` : `href="/app/day/${d.n}" data-link`;
  return `<a class="${cls}" ${attrs}>
    <span class="num">${esc(label)}</span>
    <span class="t">${esc(pick(d.title))}</span>
    <span class="tiny muted">${esc(d.title.en)}</span>
    ${d.review ? `<span class="tiny muted">${esc(t("reviewDay"))}</span>` : ""}
    <span class="st">${st}</span>
  </a>`;
}

export default async function course(root) {
  const cat = await catalog();
  const p = state.progress, a = state.me.access;
  const done = cat.days.filter((d) => p.days[d.n] && p.days[d.n].done).length;
  const next = cat.days.find((d) => !(p.days[d.n] && p.days[d.n].done));
  root.innerHTML = `
    <div class="pagehead"><h1>${esc(t("course.title"))}</h1></div>
    <p class="muted">${esc(t("course.sub"))}</p>
    <div class="card flat tight stack" style="margin-bottom:18px">
      <div class="row between small"><b>${esc(t("course.progress", { done, total: cat.days.length }))}</b><span class="muted">${Math.round((done / cat.days.length) * 100)}%</span></div>
      ${bar((done / cat.days.length) * 100, "ok")}
    </div>
    <section class="week">
      <h3>${icon("sign", "ico")} ${esc(t("orientation"))}</h3>
      <p class="small muted">${esc(t("orientation.sub"))}</p>
      <div class="days">${cat.orientation.days.map((d, i) => tile(d, p, a, false, "O" + (i + 1))).join("")}</div>
    </section>
    ${cat.weeks.map((w) => `
      <section class="week">
        <h3>${esc(t("week", { n: w.week }))} <span class="muted small">· ${esc(pick(w.title))}</span></h3>
        <div class="days">${w.days.map((n) => { const d = cat.days.find((x) => x.n === n); return tile(d, p, a, next && next.n === n, t("day", { n })); }).join("")}</div>
      </section>`).join("")}
  `;
  return onAct(root, { locked: () => showLock() });
}
