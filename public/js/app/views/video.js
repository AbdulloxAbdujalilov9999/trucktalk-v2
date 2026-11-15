/* One video lesson (/v/12): the intro, every line or card with audio and translation, the "repeat after me" recap,
 * a short self-test, related course days, and the way into the full course. This is where video viewers land. */
import { t, pick, trLang } from "../i18n.js";
import { esc, icon, onAct, sayBtn, toast, bar } from "../ui.js";
import { state, update, addXp, addCards } from "../store.js";
import { videos, catalog, go, startTrial } from "../main.js";
import { playAll, stop } from "../audio.js";
import { videoItems, practiceQuestions } from "../../shared/videos.js";
import { config } from "../api.js";

export default async function video(root, [nStr]) {
  const n = Number(nStr);
  const [vids, cat, cfg] = await Promise.all([videos(), catalog(), config()]);
  const v = vids.find((x) => x.n === n);
  if (!v) { go("/app/videos", { replace: true }); return; }
  const items = videoItems(v);
  const a = state.me.access;
  let showTr = true, practice = null, picks = [], checked = false;
  document.title = `${n}. ${v.title.uz} — TruckTalk`;

  // seen as soon as it's opened
  if (!(state.progress.videos[n] && state.progress.videos[n].seen)) update((p) => { p.videos[n] = { ...(p.videos[n] || {}), seen: Date.now() }; });

  const narratorBtn = (text) => (cfg.features && cfg.features.naturalVoice ? sayBtn(text, { lang: "uz" }) : "");
  const related = (v.relatedDays || []).map((dn) => cat.days.find((d) => d.n === dn)).filter(Boolean);
  const added = () => items.every((_, i) => state.progress.srs["v:" + n + ":" + i]);

  function linesHtml() {
    if (v.format === "conversation") {
      return `<div class="chat">${v.lines.filter((l) => l.who !== "narrator").map((l, i) => `
        <div class="bubble ${l.who === "en1" ? "me" : ""}" data-line="${i}">
          <div class="who">${esc(l.who === "en1" ? t("videos.driver") : t("videos.other"))}</div>
          <div class="en" style="padding-right:40px">${esc(l.en)}</div>
          ${showTr ? `<div class="tr">${esc(l.uz)}</div>` : ""}
          <span class="play">${sayBtn(l.en, { gender: l.who === "en1" ? "male" : "female" })}</span>
        </div>`).join("")}</div>`;
    }
    return `<div class="grid grid-2">${v.cards.map((c) => `
      <div class="card tight stack">
        <div class="row">${sayBtn(c.en)}<b class="grow" style="font-size:1.1rem">${esc(c.en)}</b></div>
        ${showTr ? `<div>${esc(c.uz)}</div>` : ""}
        ${c.note ? `<div class="note small">${esc(c.note)}</div>` : ""}
      </div>`).join("")}</div>`;
  }

  function practiceHtml() {
    if (!practice) return `<button class="btn dark" data-act="practice">${icon("bolt", "ico")} ${esc(t("start"))}</button>`;
    const score = checked ? practice.filter((q, i) => picks[i] === q.a).length : 0;
    return `${practice.map((q, i) => `
      <div class="quiz-q">
        <div class="row q">${sayBtn(q.en)}<span>${i + 1}. ${esc(q.en)}</span></div>
        <div class="opts">${q.opts.map((o, j) => {
          let cls = "";
          if (checked) cls = j === q.a ? "right" : picks[i] === j ? "wrong" : "";
          else if (picks[i] === j) cls = "sel";
          return `<button class="opt ${cls}" data-act="vpick" data-q="${i}" data-o="${j}" ${checked ? "disabled" : ""}>${esc(o)}</button>`;
        }).join("")}</div>
      </div>`).join("")}
      ${checked ? `<div class="card accent stack"><div class="result">${esc(t("videos.score", { score, total: practice.length }))}</div>${bar((score / practice.length) * 100, "ok")}<button class="btn" data-act="practice">${esc(t("quiz.again"))}</button></div>`
        : `<button class="btn primary block" data-act="vcheck">${esc(t("quiz.check"))}</button>`}`;
  }

  function cta() {
    if (a.full) return "";
    return `<section class="card hero stack">
      <h2 style="margin:0">${esc(t("course.title"))}</h2>
      <p class="muted" style="margin:0">${esc(t("videos.cta"))}</p>
      ${!a.signedIn ? `<a class="btn primary" style="align-self:flex-start" href="/app/signin" data-link>${esc(t("home.startCourse"))}</a>`
        : a.canStartTrial ? `<button class="btn primary" style="align-self:flex-start" data-act="trial">${icon("gift", "ico")} ${esc(t("trial.start"))}</button>`
        : `<a class="btn primary" style="align-self:flex-start" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a>`}
    </section>`;
  }

  function paint() {
    const yt = v.youtube ? `<div class="card" style="padding:0;overflow:hidden;aspect-ratio:9/16;max-width:360px;margin:0 auto 14px"><iframe title="${esc(v.title.en)}" src="https://www.youtube-nocookie.com/embed/${esc(v.youtube)}" style="border:0;width:100%;height:100%" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>` : "";
    root.innerHTML = `
      <a class="back" href="/app/videos" data-link>${icon("left", "ico")} ${esc(t("nav.videos"))}</a>
      <div class="eyebrow">${esc(t("lesson", { n }))} · ${esc(t("videos.bundle", { n: v.bundle }))} · ${esc(v.bundleTitle)}</div>
      <h1 style="margin-bottom:2px">${esc(v.title.uz)}</h1>
      <p class="muted" style="margin-top:0">${esc(v.title.en)}</p>
      ${yt}
      <div class="stack-lg">
        <div class="note row" style="align-items:flex-start">${narratorBtn(v.intro)}<div class="grow"><b>${esc(t("videos.intro"))}:</b> ${esc(v.intro)}</div></div>
        <section>
          <div class="row between wrap-row" style="margin-bottom:10px">
            <h2 style="margin:0">${esc(v.format === "cards" ? t("videos.cards") : t("videos.dialogue"))}</h2>
            <div class="row">
              ${v.format === "conversation" ? `<button class="btn sm dark" data-act="playall">${icon("play", "ico")} ${esc(t("dialogue.playAll"))}</button>` : ""}
              <label class="row small" style="gap:6px"><input type="checkbox" data-act="tr" ${showTr ? "checked" : ""}> ${esc(t("dialogue.showTr"))}</label>
            </div>
          </div>
          ${linesHtml()}
        </section>
        ${v.recap.length ? `<section>
          <h2>${esc(t("videos.recap"))}</h2>
          <div class="card list" style="padding:4px 12px">${v.recap.map((r) => `
            <div class="word">${sayBtn(r.en)}<div class="grow"><div class="en">${esc(r.en)}</div><div class="tr">${esc(r.uz)}</div>${r.note ? `<div class="small" style="margin-top:4px">💡 ${esc(r.note)}</div>` : ""}</div></div>`).join("")}
          </div>
        </section>` : ""}
        ${v.outro ? `<div class="note row" style="align-items:flex-start">${narratorBtn(v.outro)}<div class="grow"><b>${esc(t("videos.tip"))}:</b> ${esc(v.outro)}</div></div>` : ""}
        <section class="card stack">
          <h2 style="margin:0">${esc(t("videos.practice"))}</h2>
          <p class="muted small" style="margin:0">${esc(t("videos.practiceSub"))}</p>
          <div id="practice">${practiceHtml()}</div>
        </section>
        <button class="btn ${added() ? "ok" : "ghost"} block" data-act="addreview" ${added() ? "disabled" : ""}>${icon(added() ? "check" : "repeat", "ico")} ${esc(added() ? t("videos.added") : t("videos.addReview"))}</button>
        ${related.length ? `<section><h3>${esc(t("videos.related"))}</h3><div class="card list" style="padding:4px 12px">${related.map((d) => `
          <a class="item" href="/app/day/${d.n}" data-link><span class="n">${d.n}</span><span class="grow"><span class="t">${esc(pick(d.title))}</span><br><span class="s">${esc(d.title.en)}</span></span>${!d.free && !a.full ? icon("lock", "ico") : icon("chevron", "ico")}</a>`).join("")}</div></section>` : ""}
        ${cta()}
        <div class="row between">
          ${n > 1 ? `<a class="btn ghost sm" href="/v/${n - 1}" data-link>${icon("left", "ico")} ${n - 1}</a>` : "<span></span>"}
          ${n < 50 ? `<a class="btn ghost sm" href="/v/${n + 1}" data-link>${n + 1} ${icon("chevron", "ico")}</a>` : ""}
        </div>
      </div>`;
  }

  paint();
  const off = onAct(root, {
    tr: () => { showTr = !showTr; paint(); },
    playall: () => {
      const lines = v.lines.filter((l) => l.who !== "narrator");
      playAll(lines.map((l) => ({ text: l.en, gender: l.who === "en1" ? "male" : "female" })), (i) => {
        root.querySelectorAll(".bubble").forEach((b, j) => b.classList.toggle("playing", j === i));
      });
    },
    practice: () => { practice = practiceQuestions(v, 8); picks = practice.map(() => null); checked = false; root.querySelector("#practice").innerHTML = practiceHtml(); },
    vpick: (el) => { picks[+el.dataset.q] = +el.dataset.o; root.querySelector("#practice").innerHTML = practiceHtml(); },
    vcheck: () => {
      if (picks.some((x) => x === null)) { toast(t("quiz.answerAll")); return; }
      checked = true;
      const score = practice.filter((q, i) => picks[i] === q.a).length;
      const pct = Math.round((score / practice.length) * 100);
      const prev = (state.progress.videos[n] && state.progress.videos[n].best) || 0;
      if (pct > prev) { update((p) => { p.videos[n] = { ...(p.videos[n] || {}), best: pct }; }); addXp(Math.round(((pct - prev) / 100) * 15)); }
      root.querySelector("#practice").innerHTML = practiceHtml();
    },
    addreview: () => { addCards(items.map((_, i) => "v:" + n + ":" + i)); toast(t("videos.added"), "ok"); paint(); },
    trial: startTrial,
  });
  return () => { off(); stop(); document.title = "TruckTalk"; };
}
