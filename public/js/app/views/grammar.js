/* The grammar book: list by topic, and each unit (rule, explanation, examples, common mistake, quiz graded by the server). */
import { t, pick, trLang } from "../i18n.js";
import { esc, icon, onAct, spinner, errorBox, sayBtn, toast, bar } from "../ui.js";
import { api, cachedGet } from "../api.js";
import { state, update, addXp } from "../store.js";
import { catalog, showLock } from "../main.js";
import { lockedView } from "./common.js";
import { currentUser } from "../auth.js";

export default async function grammar(root, [id]) {
  const cat = await catalog();
  const a = state.me.access;
  if (!id) {
    const cats = [...new Map(cat.grammar.map((g) => [g.cat.en, g.cat])).values()];
    root.innerHTML = `
      <div class="pagehead"><h1>${esc(t("grammar.title"))}</h1></div>
      <p class="muted">${esc(t("grammar.sub"))}</p>
      ${cats.map((c) => `<section style="margin-bottom:18px"><h3>${esc(pick(c))}</h3><div class="card list" style="padding:4px 12px">
        ${cat.grammar.filter((g) => g.cat.en === c.en).map((g) => {
          const locked = !g.free && !a.full;
          const read = state.progress.grammar[g.id] && state.progress.grammar[g.id].read;
          return `<a class="item ${read ? "done" : ""}" href="/app/grammar/${g.id}" ${locked ? 'data-act="locked"' : "data-link"}>
            <span class="n">${read ? icon("check", "ico") : icon("book", "ico")}</span>
            <span class="grow"><span class="t">${esc(pick(g.title))}</span><br><span class="s">${esc(g.title.en)}</span></span>
            ${locked ? icon("lock", "ico") : g.free && !a.full ? `<span class="badge info">${esc(t("free"))}</span>` : icon("chevron", "ico")}
          </a>`;
        }).join("")}</div></section>`).join("")}`;
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
  let picks = g.quiz.map(() => null), result = null, showEn = false;
  if (!(state.progress.grammar[id] && state.progress.grammar[id].read)) { update((p) => { p.grammar[id] = { read: Date.now() }; }); addXp(5); }

  function paint() {
    const explain = showEn ? g.explain.en : (g.explain[L] && g.explain[L].length ? g.explain[L] : g.explain.en);
    root.innerHTML = `
      <a class="back" href="/app/grammar" data-link>${icon("left", "ico")} ${esc(t("grammar.title"))}</a>
      <div class="eyebrow">${esc(pick(g.cat))}</div>
      <h1 style="margin-bottom:2px">${esc(pick(g.title))}</h1>
      <p class="muted" style="margin-top:0">${esc(g.title.en)}</p>
      <div class="stack-lg">
        ${g.rule[L] ? `<div class="card accent"><b>${esc(g.rule[L])}</b></div>` : ""}
        <div class="card stack">
          ${explain.map((x) => `<p style="margin:0">${esc(x)}</p>`).join("")}
          ${L !== "en" ? `<label class="row small" style="gap:6px"><input type="checkbox" data-act="en" ${showEn ? "checked" : ""}> ${esc(t("grammar.showEn"))}</label>` : ""}
        </div>
        <section><h2>${esc(t("grammar.examples"))}</h2><div class="card">${g.examples.map((e) => `
          <div class="word">${sayBtn(e.en)}<div class="grow"><div class="en">${esc(e.en)}</div><div class="tr">${esc(e[L] || e.uz)}</div></div></div>`).join("")}</div></section>
        ${g.mistake.wrong ? `<section><h2>${esc(t("grammar.mistake"))}</h2><div class="card stack">
          <div class="row"><span class="badge bad">${icon("x", "ico")}</span><s>${esc(g.mistake.wrong)}</s></div>
          <div class="row"><span class="badge ok">${icon("check", "ico")}</span><b>${esc(g.mistake.right)}</b>${sayBtn(g.mistake.right)}</div>
          <p class="muted" style="margin:0">${esc(pick(g.mistake.why))}</p></div></section>` : ""}
        ${data.teach && data.teach.length ? `<details class="card"><summary><b>Teacher notes</b></summary><ul>${data.teach.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}
        <section><h2>${esc(t("step.quiz"))}</h2>
          ${result ? `<div class="card accent stack" style="margin-bottom:12px"><div class="result">${esc(t("quiz.score", { score: result.score, total: result.total }))}</div>${bar((result.score / result.total) * 100, "ok")}</div>` : ""}
          ${g.quiz.map((q, i) => `<div class="quiz-q card"><div class="q">${i + 1}. ${esc(q.q.en)}</div>${q.q[L] ? `<div class="qtr">${esc(q.q[L])}</div>` : ""}
            <div class="opts">${q.opts.map((o, j) => {
              let cls = "";
              if (result) cls = result.results[i].answer === j ? "right" : picks[i] === j ? "wrong" : "";
              else if (picks[i] === j) cls = "sel";
              return `<button class="opt ${cls}" data-act="pick" data-q="${i}" data-o="${j}" ${result ? "disabled" : ""}>${esc(o)}</button>`;
            }).join("")}</div></div>`).join("")}
          ${result ? `<button class="btn block" data-act="again">${esc(t("quiz.again"))}</button>` : `<button class="btn primary block" data-act="check">${esc(t("quiz.check"))}</button>`}
        </section>
      </div>`;
  }
  paint();
  return onAct(root, {
    en: () => { showEn = !showEn; paint(); },
    pick: (el) => { if (!result) { picks[+el.dataset.q] = +el.dataset.o; paint(); } },
    again: () => { picks = g.quiz.map(() => null); result = null; paint(); },
    check: async () => {
      if (picks.some((x) => x === null)) { toast(t("quiz.answerAll")); return; }
      try {
        result = await api("quiz", { method: "POST", body: { kind: "grammar", id, answers: picks } });
        const key = "grammar:" + id, prev = (state.progress.quiz[key] && state.progress.quiz[key].best) || 0;
        if (result.score > prev) { update((p) => { p.quiz[key] = { best: result.score, total: result.total, at: Date.now() }; }); addXp(Math.round(((result.score - prev) / result.total) * 15)); }
      } catch (e) { toast(e.code === "network" ? t("error.network") : t("error.generic"), "bad"); }
      paint();
    },
  });
}
