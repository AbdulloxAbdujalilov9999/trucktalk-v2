/* The grammar book: list by topic, and each unit (rule, explanation, examples, common mistake, quiz graded by the server). */
import { t, pick, trLang, lang } from "../i18n.js";
import { esc, icon, onAct, spinner, errorBox, sayBtn, toast } from "../ui.js";
import { api, cachedGet } from "../api.js";
import { state, update, addXp, setting } from "../store.js";
import { catalog, showLock } from "../main.js";
import { lockedView, pageHead, titleParts } from "./common.js";
import { currentUser } from "../auth.js";

export default async function grammar(root, [id]) {
  const cat = await catalog();
  const a = state.me.access;
  const isRead = (gid) => !!(state.progress.grammar[gid] && state.progress.grammar[gid].read);
  if (!id) {
    const cats = [...new Map(cat.grammar.map((g) => [g.cat.en, g.cat])).values()];
    const readN = cat.grammar.filter((g) => isRead(g.id)).length;
    const pct = cat.grammar.length ? Math.round((readN / cat.grammar.length) * 100) : 0;
    const item = (g) => {
      const locked = !g.free && !a.full, read = isRead(g.id), tp = titleParts(g.title);
      return `<a class="item ${read ? "done" : ""}" href="/app/grammar/${g.id}" ${locked ? 'data-act="locked"' : "data-link"}>
        <span class="n">${read ? icon("check") : icon("grammar")}</span>
        <span class="grow"><span class="t" style="display:block">${esc(tp.main)}</span>${tp.sub ? `<span class="s">${esc(tp.sub)}</span>` : ""}</span>
        ${locked ? icon("lock") : g.free && !a.full ? `<span class="badge-free">${esc(t("free"))}</span>` : icon("chevron")}
      </a>`;
    };
    root.innerHTML = `
      ${pageHead({ back: "/app/course", backLabel: t("nav.lessons"), eyebrow: t("nav.lessons"), title: t("grammar.title"), sub: esc(t("grammar.sub")),
        body: `<div class="head-extra"><p class="panel-sub" style="margin-bottom:8px">${esc(t("progress.unitsDone", { a: readN, b: cat.grammar.length }))}</p>
          <div class="progressbar"><div class="progressbar-fill" style="width:${pct}%"></div></div></div>` })}
      ${cats.map((c) => {
        const units = cat.grammar.filter((g) => g.cat.en === c.en), done = units.filter((g) => isRead(g.id)).length;
        return `<section class="panel">
          <div class="panel-head panel-head-row"><h2>${esc(pick(c, lang()))}</h2><span class="week-count">${done}/${units.length}</span></div>
          <div class="list">${units.map(item).join("")}</div>
        </section>`;
      }).join("")}`;
    return onAct(root, { locked: () => showLock() });
  }

  const row = cat.grammar.find((g) => g.id === id);
  if (!row) { root.innerHTML = errorBox(t("error.generic")); return; }
  if (!row.free && !a.full) return lockedView(root, pick(row.title), "/app/grammar");
  root.innerHTML = spinner();
  let data;
  try { data = await cachedGet(`content?kind=grammar&id=${encodeURIComponent(id)}`, "grammar:" + id, { uid: currentUser() ? currentUser().uid : "anon" }); }
  catch (e) {
    if (e.status === 401 || e.status === 402) return lockedView(root, pick(row.title), "/app/grammar");
    root.innerHTML = errorBox(t("error.generic")); return onAct(root, { retry: () => grammar(root, [id]) });
  }
  const g = data.item, L = trLang();
  // the explanation: in English on the English screen, otherwise in the student's language; one tap shows the other
  const mainL = lang() === "en" ? "en" : L, otherL = mainL === "en" ? L : "en";
  const otherLabel = otherL === "en" ? t("grammar.showEn") : otherL === "ru" ? "Русский" : "Oʻzbekcha";
  let picks = g.quiz.map(() => null), result = null, other = false, busy = false;
  if (!isRead(id)) { update((p) => { p.grammar[id] = { read: Date.now() }; }); addXp(5); }
  // the units in book order, for the pager
  const at = cat.grammar.findIndex((x) => x.id === id);
  const prev = cat.grammar[at - 1] || null, next = cat.grammar[at + 1] || null;
  const pager = (x, dir) => {
    if (!x) return "";
    const locked = !x.free && !a.full, label = titleParts(x.title).main;
    return `<a class="btn ghost sm" href="/app/grammar/${x.id}" ${locked ? 'data-act="locked"' : "data-link"} aria-label="${esc(label)}">${dir < 0 ? icon("arrowL") : ""}${esc(dir < 0 ? t("prev") : t("next"))}${dir > 0 ? icon("arrowR") : ""}</a>`;
  };

  function quizHtml() {
    const r = result;
    const best = state.progress.quiz["grammar:" + id];
    return `<section class="panel" id="gQuiz">
      <div class="panel-head panel-head-row"><div><h2>${esc(t("step.quiz"))}</h2><p class="panel-sub">${esc(t("grammar.quizSub", { n: g.quiz.length }))}</p></div>
        ${best ? `<span class="badge ${best.best === best.total ? "ok" : ""}">${esc(t("quiz.score", { score: best.best, total: best.total }))}</span>` : ""}</div>
      <form id="gForm" class="quiz-form" novalidate>
        ${g.quiz.map((q, i) => {
          const tr = setting("showUz", true) !== false && q.q[L] && q.q[L] !== q.q.en ? q.q[L] : "";
          return `<fieldset class="quiz-q" id="gq-${i}">
            <legend>${i + 1}. ${esc(q.q.en)}${tr ? `<span class="q-tr">${esc(tr)}</span>` : ""}</legend>
            <div class="quiz-opts">${q.opts.map((o, j) => {
              const cls = r ? (j === r.results[i].answer ? " right" : j === picks[i] ? " wrong" : "") : "";
              return `<label class="quiz-opt${cls}"><input type="radio" name="g${i}" value="${j}" ${picks[i] === j ? "checked" : ""} ${r || busy ? "disabled" : ""}><span>${esc(o)}</span></label>`;
            }).join("")}</div>
            ${r ? `<p class="quiz-feedback ${r.results[i].correct ? "correct" : "incorrect"}">${esc(r.results[i].correct ? t("quiz.correct") : t("quiz.correctWas", { a: q.opts[r.results[i].answer] }))}</p>` : ""}
          </fieldset>`;
        }).join("")}
        ${r ? `<div class="quiz-result" id="gResult">
            <div><strong>${esc(t("quiz.score", { score: r.score, total: r.total }))}</strong> — ${esc(r.score / r.total >= 0.8 ? t("quiz.great") : r.score / r.total >= 0.5 ? t("quiz.ok") : t("quiz.low"))}</div>
            <div class="progressbar"><div class="progressbar-fill" style="width:${Math.round((r.score / r.total) * 100)}%"></div></div>
            <div class="quiz-actions">
              <button type="button" class="btn ghost" data-act="again">${icon("refresh")} ${esc(t("quiz.again"))}</button>
              ${next ? `<a class="btn primary" href="/app/grammar/${next.id}" ${!next.free && !a.full ? 'data-act="locked"' : "data-link"}>${esc(t("next"))} ${icon("arrowR")}</a>` : ""}
            </div>
          </div>`
          : `<button type="submit" class="btn primary block" ${busy ? "disabled" : ""}>${esc(busy ? t("quiz.checking") : t("quiz.submit"))}</button>`}
      </form>
    </section>`;
  }

  function paint() {
    const showL = other ? otherL : mainL;
    const explain = g.explain[showL] && g.explain[showL].length ? g.explain[showL] : g.explain.en;
    const rule = (g.rule && g.rule[showL]) || "";
    const hasOther = !!((g.explain[otherL] && g.explain[otherL].length) || (g.rule && g.rule[otherL]));
    const tp = titleParts(g.title);
    root.innerHTML = `
      ${pageHead({ back: "/app/grammar", backLabel: t("grammar.title"), right: `<div class="lesson-pager">${pager(prev, -1)}${pager(next, 1)}</div>`,
        eyebrow: `${t("grammar.unit", { n: at + 1, total: cat.grammar.length })} · ${pick(g.cat, lang())}`, title: tp.main, tr: tp.sub })}
      <section class="panel">
        ${rule ? `<div class="tip-box"><span class="tip-label">${esc(t("grammar.rule"))}</span><p>${esc(rule)}</p></div>` : ""}
        <div class="grammar-body">${explain.map((x) => `<p>${esc(x)}</p>`).join("")}</div>
        ${hasOther ? `<label class="switch-row small"><input type="checkbox" data-act="other" ${other ? "checked" : ""}><span>${esc(otherLabel)}</span></label>` : ""}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>${esc(t("grammar.examples"))}</h2></div>
        <div class="transcript">${g.examples.map((e) => `<div class="transcript-line"><div class="line-text"><p class="line-en">${esc(e.en)}</p><p class="line-uz">${esc(e[L] || e.uz)}</p></div>${sayBtn(e.en)}</div>`).join("")}</div>
      </section>
      ${g.mistake.wrong ? `<section class="panel">
        <div class="panel-head"><h2>${esc(t("grammar.mistake"))}</h2></div>
        <div class="mistake">
          <div class="mistake-row bad">${icon("x")}<s>${esc(g.mistake.wrong)}</s></div>
          <div class="mistake-row ok">${icon("check")}<b>${esc(g.mistake.right)}</b>${sayBtn(g.mistake.right)}</div>
          <p class="panel-sub">${esc(pick(g.mistake.why, showL))}</p>
        </div>
      </section>` : ""}
      ${data.teach && data.teach.length ? `<details class="panel"><summary><b>${esc(t("grammar.teacherNotes"))}</b></summary><ul>${data.teach.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}
      ${quizHtml()}`;
    const f = root.querySelector("#gForm");
    if (f) {
      f.addEventListener("change", (e) => {
        const m = /^g(\d+)$/.exec(e.target.name || "");
        if (m && !result) picks[Number(m[1])] = Number(e.target.value);
      });
      f.addEventListener("submit", (e) => { e.preventDefault(); check(); });
    }
  }

  async function check() {
    if (result || busy) return;
    const missing = picks.findIndex((x) => x === null);
    if (missing >= 0) {
      toast(t("quiz.answerAll"));
      const el = root.querySelector("#gq-" + missing);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    busy = true; paint();
    try {
      result = await api("quiz", { method: "POST", body: { kind: "grammar", id, answers: picks } });
      const key = "grammar:" + id, before = (state.progress.quiz[key] && state.progress.quiz[key].best) || 0;
      if (result.score > before) { update((p) => { p.quiz[key] = { best: result.score, total: result.total, at: Date.now() }; }); addXp(Math.round(((result.score - before) / result.total) * 15)); }
    } catch (e) { toast(e.code === "network" ? t("error.network") : t("error.generic"), "bad"); }
    busy = false; paint();
    if (result) { const el = root.querySelector("#gResult"); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }

  paint();
  return onAct(root, {
    other: () => { other = !other; paint(); },
    again: () => { picks = g.quiz.map(() => null); result = null; paint(); const el = root.querySelector("#gQuiz"); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); },
    locked: () => showLock(),
  });
}
