/* The course map: how far down the road the driver is, the next lesson, the orientation lessons, then 12 weeks
 * (12 exits) of 5 days. A week opens to its days; the current one is open. Locked days open the trial/plans sheet. */
import { t } from "../i18n.js";
import { esc, icon, bar, onAct } from "../ui.js";
import { state } from "../store.js";
import { catalog, showLock } from "../main.js";
import { courseState, weekStats, ring, road, enTitle, trTitle, isDone } from "./common.js";

function drow(d, p, a, current, label) {
  const done = isDone(p, d.n), locked = !d.free && !a.full;
  const q = p.quiz["day:" + d.n];
  const cls = ["drow", done ? "done" : "", locked ? "locked" : "", d.review ? "review" : "", current ? "current" : ""].join(" ");
  const st = done ? `<span class="badge ok">${q ? `${q.best}/${q.total}` : icon("check")}</span>`
    : locked ? icon("lock")
    : current ? `<span class="badge info">${esc(t("home.upNext"))}</span>`
    : d.free && !a.full ? `<span class="badge info">${esc(t("free"))}</span>` : "";
  const tr = [trTitle(d.title), d.review ? t("reviewDay") : ""].filter(Boolean).join(" · ");
  return `<a class="${cls}" href="/app/day/${d.n}" ${locked ? `data-act="locked"` : "data-link"}>
    <span class="dnum">${esc(label)}</span>
    <span class="grow"><span class="dt">${esc(enTitle(d.title))}</span>${tr ? `<span class="dtr">${esc(tr)}</span>` : ""}</span>
    <span class="dst">${st}</span>
  </a>`;
}

function weekBox({ id, badge, title, sub, done, total, open, cls, rows }) {
  return `<section class="wk ${cls} ${open ? "open" : ""}" id="wk-${id}">
    <button class="wk-head" data-act="wk" aria-expanded="${open}" aria-controls="wkd-${id}">
      <span class="exitb">${badge}</span>
      <span class="grow"><span class="wk-t">${esc(title)}</span>${sub ? `<span class="wk-tr">${esc(sub)}</span>` : ""}${bar(total ? (done / total) * 100 : 0, "ok")}</span>
      <span class="wk-n">${done}/${total}</span>
      ${icon("chevron", "ico chev")}
    </button>
    <div class="wk-days" id="wkd-${id}">${rows}</div>
  </section>`;
}

export default async function course(root, params, { query }) {
  const cat = await catalog();
  const p = state.progress, a = state.me.access;
  const cs = courseState(cat, p), next = cs.next;
  const weeks = weekStats(cat, p, next);
  const orient = cat.orientation.days, orientDone = orient.filter((d) => isDone(p, d.n)).length;
  const wq = Number(query.get("w"));
  const openId = wq >= 1 && wq <= weeks.length ? wq : !cs.started && orientDone < orient.length ? 0 : (weeks.find((w) => w.current) || weeks[0]).week;
  const pct = Math.round(cs.pct);

  root.innerHTML = `
    <div class="pagehead"><h1>${esc(t("course.title"))}</h1></div>
    <p class="muted" style="margin-top:0">${esc(t("course.sub"))}</p>
    <section class="card cs-sum" style="margin-bottom:22px">
      <div class="cs-top">
        ${ring(pct, { light: true, label: t("course.progress", { done: cs.done, total: cs.total }) })}
        <div class="grow"><span class="num">${cs.done} / ${cs.total}</span><span class="small muted">${esc(t("home.daysDone"))}</span></div>
      </div>
      ${road(cs.pct, t("course.progress", { done: cs.done, total: cs.total }))}
      <a class="mitem" href="/app/day/${next.n}" ${!next.free && !a.full ? `data-act="locked"` : "data-link"} style="margin:0 -6px -6px">
        <span class="mi"><b class="num" style="font-size:1.15rem">${next.n}</b></span>
        <span class="grow"><b>${esc(enTitle(next.title))}</b><small>${esc(t("home.upNext"))}${trTitle(next.title) ? " · " + esc(trTitle(next.title)) : ""}</small></span>
        ${icon("chevron")}
      </a>
    </section>
    <div class="sec-head"><h2 class="sec-title">${esc(t("course.weeks"))}</h2></div>
    ${weekBox({
      id: 0, badge: icon("sign"), title: t("orientation"), sub: t("orientation.sub"), done: orientDone, total: orient.length,
      open: openId === 0, cls: orientDone >= orient.length ? "done" : orientDone ? "started" : "",
      rows: orient.map((d, i) => drow(d, p, a, false, "O" + (i + 1))).join(""),
    })}
    ${weeks.map((w) => weekBox({
      id: w.week, badge: `<small>EXIT</small><b>${w.week}</b>`, title: enTitle(w.title), sub: trTitle(w.title), done: w.done, total: w.days.length,
      open: openId === w.week, cls: w.done >= w.days.length ? "done" : w.started ? "started" : "",
      rows: w.days.map((d) => drow(d, p, a, next.n === d.n && !isDone(p, d.n), String(d.n))).join(""),
    })).join("")}
  `;
  if (wq) requestAnimationFrame(() => { const el = root.querySelector("#wk-" + openId); if (el) el.scrollIntoView({ block: "start" }); });
  return onAct(root, {
    locked: () => showLock(),
    wk: (el) => {
      const box = el.closest(".wk");
      const open = !box.classList.contains("open");
      box.classList.toggle("open", open);
      el.setAttribute("aria-expanded", String(open));
    },
  });
}
