/* One course day: Words -> Dialogue -> Grammar -> Quiz (graded by the server) -> Speaking (AI check). */
import { t, pick, trLang } from "../i18n.js";
import { esc, icon, onAct, spinner, errorBox, sayBtn, toast, modal, bar } from "../ui.js";
import { api, cachedGet } from "../api.js";
import { state, markStep, markDayDone, addXp, addCards, update } from "../store.js";
import { catalog, go } from "../main.js";
import { playAll, stop } from "../audio.js";
import { lockedView, recognizer, certificateStatus } from "./common.js";
import { currentUser } from "../auth.js";

const STEP_XP = { words: 10, dialogue: 10, grammar: 5, quiz: 0, speak: 10 };
const isDriver = (who) => /driver|haydovchi|you\b/i.test(String(who));

export default async function day(root, [nStr]) {
  const n = Number(nStr);
  const cat = await catalog();
  const all = [...cat.orientation.days, ...cat.days];
  const row = all.find((d) => d.n === n);
  if (!row) { go("/app/course", { replace: true }); return; }
  const label = n <= 0 ? "O" + (cat.orientation.days.findIndex((d) => d.n === n) + 1) : t("day", { n });
  const a = state.me.access;
  if (!row.free && !a.full) return lockedView(root, `${label} · ${pick(row.title)}`);

  root.innerHTML = spinner();
  let data;
  const load = async () => {
    try { data = await cachedGet(`content?kind=day&id=${n}`, "day:" + n, { uid: currentUser() ? currentUser().uid : "anon" }); }
    catch (e) {
      if (e.status === 401 || e.status === 402) return lockedView(root, `${label} · ${pick(row.title)}`);
      root.innerHTML = errorBox(e.code === "network" ? t("error.network") : t("error.generic"));
      return null;
    }
    return data;
  };
  if (!(await load())) { return onAct(root, { retry: () => day(root, [nStr]) }); }
  const d = data.item;

  const steps = [];
  if (d.words.length) steps.push("words");
  if (d.dialogue.length) steps.push("dialogue");
  if (d.tip) steps.push("grammar");
  if (d.quiz.length) steps.push("quiz");
  if (d.speak) steps.push("speak");
  const done = (s) => !!(state.progress.days[n] && state.progress.days[n].s && state.progress.days[n].s[s]);
  let cur = steps.find((s) => !done(s)) || steps[0];
  let wordsMode = "list", flashIdx = 0, flashShown = false, showTr = true, rolePlay = false;
  let quiz = { picks: d.quiz.map(() => null), result: null, busy: false };
  let speak = { text: "", result: null, busy: false, rec: null, listening: false };
  const L = trLang();
  const prevDay = all[all.findIndex((x) => x.n === n) - 1], nextDay = all[all.findIndex((x) => x.n === n) + 1];

  function header() {
    return `
      <a class="back" href="/app/course" data-link>${icon("left", "ico")} ${esc(t("nav.course"))}</a>
      <div class="eyebrow">${esc(label)} · ${esc(pick(d.weekTitle))}${d.review ? " · " + esc(t("reviewDay")) : ""}</div>
      <h1 style="margin-bottom:2px">${esc(pick(d.title))}</h1>
      <p class="muted" style="margin-top:0">${esc(d.title.en)}</p>
      ${data.offline ? `<p class="badge warn">${esc(t("offline"))}</p>` : ""}
      <div class="steps" role="tablist">${steps.map((s) => `<button role="tab" data-act="step" data-s="${s}" class="${s === cur ? "on" : ""} ${done(s) ? "done" : ""}" aria-selected="${s === cur}">${done(s) ? icon("check", "ico") : ""}${esc(t("step." + s))}</button>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- steps
  function wordsView() {
    if (wordsMode === "flash") {
      const w = d.words[flashIdx];
      return `
        <div class="row between" style="margin-bottom:10px"><div class="seg"><button data-act="mode" data-m="list">${esc(t("words.list"))}</button><button class="on">${esc(t("words.flash"))}</button></div><span class="muted small">${flashIdx + 1} / ${d.words.length}</span></div>
        <div class="card flash" data-act="flip">
          <div class="big">${esc(w.en)}</div>
          ${flashShown ? `<div style="font-size:1.2rem">${esc(w[L] || w.uz)}</div><div class="muted small">${esc(w.ex.en)}</div><div class="muted small">${esc(w.ex[L] || w.ex.uz)}</div>` : `<div class="muted small">${esc(t("words.tapReveal"))}</div>`}
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" data-act="flash" data-d="-1" ${flashIdx === 0 ? "disabled" : ""}>${icon("left", "ico")}</button>
          ${sayBtn(w.en)}
          <span class="grow"></span>
          <button class="btn" data-act="flash" data-d="1" ${flashIdx === d.words.length - 1 ? "disabled" : ""}>${esc(t("next"))} ${icon("chevron", "ico")}</button>
        </div>
        <button class="btn primary block" style="margin-top:16px" data-act="finish" data-s="words">${icon("check")} ${esc(t("words.learned"))}</button>`;
    }
    return `
      <div class="row between" style="margin-bottom:6px"><div class="seg"><button class="on">${esc(t("words.list"))}</button><button data-act="mode" data-m="flash">${esc(t("words.flash"))}</button></div><span class="muted small">${d.words.length}</span></div>
      <div class="card">${d.words.map((w) => `
        <div class="word">
          ${sayBtn(w.en)}
          <div class="grow">
            <div class="en">${esc(w.en)}</div>
            <div class="tr">${esc(w[L] || w.uz)}</div>
            ${w.ex.en ? `<div class="ex row" style="gap:6px;align-items:flex-start"><div class="grow">${esc(w.ex.en)}<div class="tr">${esc(w.ex[L] || w.ex.uz)}</div></div>${sayBtn(w.ex.en)}</div>` : ""}
          </div>
        </div>`).join("")}
      </div>
      <button class="btn primary block" style="margin-top:16px" data-act="finish" data-s="words">${icon("check")} ${esc(t("words.learned"))}</button>`;
  }

  function dialogueView() {
    return `
      <div class="row wrap-row" style="margin-bottom:12px">
        <button class="btn sm dark" data-act="playall">${icon("play", "ico")} ${esc(t("dialogue.playAll"))}</button>
        <button class="btn sm" data-act="stopall">${esc(t("dialogue.stop"))}</button>
        <label class="row small" style="gap:6px"><input type="checkbox" data-act="tr" ${showTr ? "checked" : ""}> ${esc(t("dialogue.showTr"))}</label>
      </div>
      <label class="row small" style="gap:6px;margin-bottom:12px"><input type="checkbox" data-act="role" ${rolePlay ? "checked" : ""}> ${esc(t("dialogue.roleplay"))}</label>
      <div class="chat">${d.dialogue.map((l, i) => `
        <div class="bubble ${isDriver(l.who) ? "me" : ""} ${rolePlay && isDriver(l.who) ? "hide-en" : ""}" data-line="${i}">
          <div class="who">${esc(l.who)}</div>
          <div class="en" style="padding-right:40px">${esc(l.en)}</div>
          ${showTr ? `<div class="tr">${esc(l[L] || l.uz)}</div>` : ""}
          <span class="play">${sayBtn(l.en, { gender: isDriver(l.who) ? "male" : "female" })}</span>
        </div>`).join("")}
      </div>
      <button class="btn primary block" style="margin-top:16px" data-act="finish" data-s="dialogue">${esc(t("continue"))}</button>`;
  }

  function grammarView() {
    return `
      <div class="card stack">
        <h2>${esc(pick(d.tip.title))}</h2>
        <p style="font-size:1.05rem">${esc(pick(d.tip.text))}</p>
        ${L !== "en" ? `<details><summary class="small muted">English</summary><p class="small"><b>${esc(d.tip.title.en)}</b> ${esc(d.tip.text.en)}</p></details>` : ""}
        ${d.grammarId ? `<a class="btn ghost" href="/app/grammar/${esc(d.grammarId)}" data-link>${icon("book", "ico")} ${esc(t("grammar.openUnit"))}</a>` : ""}
      </div>
      <button class="btn primary block" style="margin-top:16px" data-act="finish" data-s="grammar">${esc(t("continue"))}</button>`;
  }

  function quizView() {
    const r = quiz.result;
    return `
      ${r ? `<div class="card ${r.score / r.total >= 0.8 ? "accent" : ""} stack" style="margin-bottom:14px">
        <div class="result">${esc(t("quiz.score", { score: r.score, total: r.total }))}</div>
        ${bar((r.score / r.total) * 100, r.score / r.total >= 0.6 ? "ok" : "")}
        <div class="muted">${esc(r.score / r.total >= 0.8 ? t("quiz.great") : r.score / r.total >= 0.5 ? t("quiz.ok") : t("quiz.low"))}</div>
      </div>` : ""}
      ${d.quiz.map((q, i) => `
        <div class="quiz-q card">
          <div class="q">${i + 1}. ${esc(q.q.en)}</div>
          ${q.q[L] ? `<div class="qtr">${esc(q.q[L])}</div>` : ""}
          <div class="opts">${q.opts.map((o, j) => {
            let cls = "";
            if (r) { const res = r.results[i]; if (res.answer === j) cls = "right"; else if (quiz.picks[i] === j) cls = "wrong"; }
            else if (quiz.picks[i] === j) cls = "sel";
            return `<button class="opt ${cls}" data-act="pick" data-q="${i}" data-o="${j}" ${r ? "disabled" : ""}>${esc(o)}</button>`;
          }).join("")}</div>
        </div>`).join("")}
      ${r ? `<div class="row"><button class="btn grow" data-act="quizagain">${esc(t("quiz.again"))}</button>${nextStepBtn("quiz")}</div>`
          : `<button class="btn primary block" data-act="check" ${quiz.busy ? "disabled" : ""}>${esc(t("quiz.check"))}</button>`}`;
  }

  function speakView() {
    const r = speak.result;
    const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    return `
      <div class="card stack">
        <div class="eyebrow">${esc(t("speak.task"))}</div>
        <p style="font-size:1.08rem;margin:0"><b>${esc(pick(d.speak))}</b></p>
        ${L !== "en" ? `<p class="small muted" style="margin:0">${esc(d.speak.en)}</p>` : ""}
      </div>
      <div class="card stack center" style="margin-top:12px">
        ${hasSR ? `<button class="mic ${speak.listening ? "on" : ""}" data-act="mic" aria-label="Mic">${icon("mic")}</button>
          <div class="muted small">${esc(speak.listening ? t("speak.listening") : t("speak.tapMic"))}</div>
          <div class="small muted">${esc(t("speak.orType"))}</div>` : `<div class="small muted">${esc(t("speak.noMic"))}</div>`}
        <textarea class="input" id="speakText" rows="3" placeholder="I am a truck driver…" style="text-align:left">${esc(speak.text)}</textarea>
        <div class="row">
          <button class="btn dark grow" data-act="aicheck" ${speak.busy ? "disabled" : ""}>${icon("chat", "ico")} ${esc(t("speak.check"))}</button>
          <button class="btn grow" data-act="finish" data-s="speak">${icon("check", "ico")} ${esc(t("speak.didIt"))}</button>
        </div>
        ${r ? tutorResult(r) : ""}
      </div>`;
  }

  function nextStepBtn(s) {
    const i = steps.indexOf(s);
    return i < steps.length - 1 ? `<button class="btn primary grow" data-act="step" data-s="${steps[i + 1]}">${esc(t("next"))}: ${esc(t("step." + steps[i + 1]))}</button>` : "";
  }

  function paint() {
    const body = cur === "words" ? wordsView() : cur === "dialogue" ? dialogueView() : cur === "grammar" ? grammarView() : cur === "quiz" ? quizView() : speakView();
    root.innerHTML = header() + `<section>${body}</section>
      <div class="row between" style="margin-top:22px">
        ${prevDay ? `<a class="btn ghost sm" href="/app/day/${prevDay.n}" data-link>${icon("left", "ico")} ${esc(t("prev"))}</a>` : "<span></span>"}
        ${nextDay ? `<a class="btn ghost sm" href="/app/day/${nextDay.n}" data-link>${esc(t("next"))} ${icon("chevron", "ico")}</a>` : ""}
      </div>`;
    const ta = root.querySelector("#speakText");
    if (ta) ta.addEventListener("input", () => { speak.text = ta.value; });
  }

  function complete(s) {
    const first = !done(s);
    markStep(n, s);
    if (first && STEP_XP[s]) addXp(STEP_XP[s]);
    if (s === "words") addCards(d.words.map((w) => w.id));
    const allDone = steps.every((x) => done(x));
    if (allDone && !(state.progress.days[n] && state.progress.days[n].done)) {
      markDayDone(n);
      addXp(20);
      const xp = steps.reduce((sum, x) => sum + (STEP_XP[x] || 0), 20);
      const certReady = !!d.final && certificateStatus(cat, state.progress).ready;
      const m = modal(`<div class="center stack"><div style="font-size:3rem">🎉</div><h2>${esc(t("lesson.complete", { xp }))}</h2>
        <div class="stack">${certReady ? `<a class="btn primary block" href="/app/certificate" data-link data-close>${esc(t("cert.open"))}</a>` : ""}
        ${nextDay ? `<a class="btn ${certReady ? "" : "primary"} block" href="/app/day/${nextDay.n}" data-link data-close>${esc(t("lesson.nextDay"))}</a>` : ""}
        <a class="btn block" href="/app/course" data-link data-close>${esc(t("lesson.toCourse"))}</a></div></div>`);
      return m;
    }
    const i = steps.indexOf(s);
    if (i < steps.length - 1) cur = steps[i + 1];
    paint();
    window.scrollTo(0, 0);
  }

  paint();
  const off = onAct(root, {
    step: (el) => { stop(); cur = el.dataset.s; paint(); },
    mode: (el) => { wordsMode = el.dataset.m; flashIdx = 0; flashShown = false; paint(); },
    flip: () => { flashShown = !flashShown; paint(); },
    flash: (el) => { flashIdx = Math.max(0, Math.min(d.words.length - 1, flashIdx + Number(el.dataset.d))); flashShown = false; paint(); },
    finish: (el) => complete(el.dataset.s),
    playall: () => {
      const bubbles = () => [...root.querySelectorAll(".bubble")];
      playAll(d.dialogue.map((l) => ({ text: l.en, gender: isDriver(l.who) ? "male" : "female" })), (i) => {
        bubbles().forEach((b, j) => b.classList.toggle("playing", j === i));
        if (i >= 0 && bubbles()[i]) bubbles()[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    stopall: () => stop(),
    tr: () => { showTr = !showTr; paint(); },
    role: () => { rolePlay = !rolePlay; paint(); },
    pick: (el) => { if (quiz.result) return; quiz.picks[+el.dataset.q] = +el.dataset.o; paint(); },
    quizagain: () => { quiz = { picks: d.quiz.map(() => null), result: null, busy: false }; paint(); },
    check: async () => {
      if (quiz.picks.some((x) => x === null)) { toast(t("quiz.answerAll")); return; }
      quiz.busy = true; paint();
      try {
        const r = await api("quiz", { method: "POST", body: { kind: "day", id: n, answers: quiz.picks } });
        quiz.result = r;
        const key = "day:" + n;
        const prevBest = (state.progress.quiz[key] && state.progress.quiz[key].best) || 0;
        const gain = Math.round((Math.max(0, r.score - prevBest) / r.total) * 20);
        update((p) => { const q = p.quiz[key] || { best: 0 }; if (r.score >= (q.best || 0)) p.quiz[key] = { best: r.score, total: r.total, at: Date.now() }; });
        if (gain) addXp(gain);
        markStep(n, "quiz");
        if (steps.every((x) => done(x)) && !(state.progress.days[n] && state.progress.days[n].done)) { quiz.busy = false; complete("quiz"); return; }
      } catch (e) { toast(e.code === "network" ? t("error.network") : t("error.generic"), "bad"); }
      quiz.busy = false; paint();
    },
    mic: () => {
      if (speak.listening && speak.rec) { speak.rec.stop(); return; }
      speak.rec = recognizer({
        onText: (s) => { speak.text = s; const ta = root.querySelector("#speakText"); if (ta) ta.value = s; },
        onEnd: () => { speak.listening = false; paint(); },
      });
      if (!speak.rec) { toast(t("speak.noMic")); return; }
      speak.listening = true; paint();
      try { speak.rec.start(); } catch { speak.listening = false; paint(); }
    },
    aicheck: async () => {
      const text = (root.querySelector("#speakText") || {}).value || speak.text;
      if (!text.trim()) { toast(t("speak.tapMic")); return; }
      if (!state.me.access.signedIn) { toast(t("teacher.signin")); go("/app/signin"); return; }
      speak.busy = true; speak.text = text; paint();
      try { speak.result = await api("ai", { method: "POST", body: { action: "check", text, day: n, lang: L } }); }
      catch (e) { speak.result = { error: e.code }; }
      speak.busy = false; paint();
    },
  });
  return () => { off(); stop(); if (speak.rec) try { speak.rec.abort(); } catch { /* ignore */ } };
}

/** Renders the AI teacher's answer (shared with the teacher screen). */
export function tutorResult(r) {
  if (r.error) {
    const msg = r.error === "daily-limit" ? t("teacher.limit") : r.error === "busy" || r.error === "upstream" ? t("teacher.busy") : r.error === "sign-in" ? t("teacher.signin") : t("error.generic");
    return `<div class="note" style="text-align:left">${esc(msg)}</div>`;
  }
  if (r.answer) {
    return `<div class="card flat stack" style="text-align:left"><p style="margin:0">${esc(r.answer)}</p>${(r.examples || []).map((e) => `<div class="row">${sayBtn(e)}<span>${esc(e)}</span></div>`).join("")}</div>`;
  }
  const head = { correct: t("teacher.correct"), almost: t("teacher.almost"), wrong: t("teacher.wrong"), not_english: t("teacher.notEnglish") }[r.verdict] || "";
  const cls = r.verdict === "correct" ? "ok" : r.verdict === "almost" ? "warn" : "bad";
  return `<div class="card flat stack" style="text-align:left">
    <span class="badge ${cls}" style="align-self:flex-start">${esc(head)}</span>
    ${r.verdict !== "correct" && r.corrected ? `<div><div class="tiny muted">${esc(t("teacher.corrected"))}</div><div class="row">${sayBtn(r.corrected)}<b>${esc(r.corrected)}</b></div></div>` : ""}
    ${r.better && r.better !== r.corrected ? `<div><div class="tiny muted">${esc(t("teacher.better"))}</div><div class="row">${sayBtn(r.better)}<span>${esc(r.better)}</span></div></div>` : ""}
    <p style="margin:0">${esc(r.explanation || "")}</p>
    ${typeof r.left === "number" ? `<div class="tiny muted">${esc(t("teacher.left", { n: r.left }))}</div>` : ""}
  </div>`;
}
