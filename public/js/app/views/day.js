/* One course day: Words (flip cards, then quick games with the day's words) -> Dialogue (listen, then a spoken role-play)
 * -> Grammar -> Quiz (graded by the server) -> Speaking (AI check). */
import { t, pick, trLang } from "../i18n.js";
import { esc, icon, onAct, spinner, errorBox, sayBtn, toast, modal, bar } from "../ui.js";
import { api, cachedGet } from "../api.js";
import { state, markStep, markDayDone, addXp, addCards, update } from "../store.js";
import { catalog, go } from "../main.js";
import { play, playAll, stop, pause, newRun } from "../audio.js";
import { lockedView, recognizer, certificateStatus, enTitle, trTitle } from "./common.js";
import { currentUser } from "../auth.js";
import { compareSpeech, distinctItems, shuffle } from "../../shared/drills.js";
import { blankRound, speakers, defaultSpeaker } from "../../shared/lesson.js";
import { streak } from "../../shared/progress.js";

const STEP_XP = { words: 10, dialogue: 10, grammar: 5, quiz: 0, speak: 10 };
const STEP_IC = { words: "card", dialogue: "chat", grammar: "book", quiz: "clipboard", speak: "mic" };
const isDriver = (who) => /driver|haydovchi|you\b/i.test(String(who));
const voiceOf = (who) => (isDriver(who) ? "male" : "female");
const LETTERS = "ABCDEFGH";
const CONFETTI = ["#ffb000", "#4a7fa7", "#12805a", "#b3cfe5", "#e5533d"];
const hasSR = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export default async function day(root, [nStr]) {
  const n = Number(nStr);
  const cat = await catalog();
  const all = [...cat.orientation.days, ...cat.days];
  const row = all.find((x) => x.n === n);
  if (!row) { go("/app/course", { replace: true }); return; }
  const label = n <= 0 ? "O" + (cat.orientation.days.findIndex((x) => x.n === n) + 1) : t("day", { n });
  const a = state.me.access;
  if (!row.free && !a.full) return lockedView(root, `${label} · ${enTitle(row.title)}`);

  root.innerHTML = spinner();
  let data;
  const load = async () => {
    try { data = await cachedGet(`content?kind=day&id=${n}`, "day:" + n, { uid: currentUser() ? currentUser().uid : "anon" }); }
    catch (e) {
      if (e.status === 401 || e.status === 402) return lockedView(root, `${label} · ${enTitle(row.title)}`);
      root.innerHTML = errorBox(e.code === "network" ? t("error.network") : t("error.generic"));
      return null;
    }
    return data;
  };
  if (!(await load())) { return onAct(root, { retry: () => day(root, [nStr]) }); }
  const d = data.item;
  const L = trLang();

  const steps = [];
  if (d.words.length) steps.push("words");
  if (d.dialogue.length) steps.push("dialogue");
  if (d.tip) steps.push("grammar");
  if (d.quiz.length) steps.push("quiz");
  if (d.speak) steps.push("speak");
  const done = (s) => !!(state.progress.days[n] && state.progress.days[n].s && state.progress.days[n].s[s]);
  let cur = steps.find((s) => !done(s)) || steps[0];
  const prevDay = all[all.findIndex((x) => x.n === n) - 1], nextDay = all[all.findIndex((x) => x.n === n) + 1];

  // words: flip cards (or a list), then practice with the day's words
  let wordsMode = "cards";
  const flipped = new Set();
  const wpItems = d.words.map((w) => ({ id: w.id, en: w.en, tr: w[L] || w.uz }));
  const blankWords = d.words.map((w) => ({ id: w.id, en: w.en, ex: w.ex && w.ex.en, tr: w.ex && (w.ex[L] || w.ex.uz) }));
  const canMatch = distinctItems(wpItems, 5).length >= 3;
  const canBlank = blankRound(blankWords, 6).length >= 2;
  let wp = null, wpTimer = 0;
  function newWp(mode) {
    clearTimeout(wpTimer);
    if (mode === "match") {
      const pairs = distinctItems(wpItems, 5);
      const ks = pairs.map((_, k) => k);
      wp = { mode, pairs, left: shuffle(ks.slice()), right: shuffle(ks.slice()), selL: null, selR: null, matched: new Set(), wrong: null, xp: 0 };
    } else {
      wp = { mode: "blank", qs: blankRound(blankWords, 6), i: 0, pick: null, right: 0, xp: 0 };
    }
  }
  if (canMatch || canBlank) newWp(canMatch ? "match" : "blank");

  // dialogue: listen, then a role-play where the student says one person's lines
  let showTr = true;
  const people = speakers(d.dialogue);
  let rp = { on: false, me: defaultSpeaker(d.dialogue), hide: false, i: 0, phase: "", heard: "", res: null, best: null, scores: [], xp: 0, run: null, rec: null, shown: false };

  let quiz = { picks: d.quiz.map(() => null), result: null, busy: false };
  let speak = { text: "", result: null, busy: false, rec: null, listening: false };

  // ---------------------------------------------------------------- header and step tabs
  function header() {
    const nDone = steps.filter(done).length;
    const week = enTitle(d.weekTitle);
    return `
      <section class="card lesson-head">
        <div class="lh-nav">
          <a class="back" href="/app/course" data-link>${icon("left", "ico")} ${esc(t("nav.course"))}</a>
          <span class="grow"></span>
          ${prevDay ? `<a class="btn icon sm" href="/app/day/${prevDay.n}" data-link aria-label="${esc(t("lesson.prevDay"))}" title="${esc(t("lesson.prevDay"))}">${icon("left")}</a>` : ""}
          ${nextDay ? `<a class="btn icon sm" href="/app/day/${nextDay.n}" data-link aria-label="${esc(t("lesson.nextDay"))}" title="${esc(t("lesson.nextDay"))}">${icon("chevron")}</a>` : ""}
        </div>
        <div class="eyebrow">${esc(label)}${week ? " · " + esc(week) : ""}${d.review ? " · " + esc(t("reviewDay")) : ""}</div>
        <h1>${esc(enTitle(d.title))}</h1>
        ${trTitle(d.title) ? `<p class="lh-tr">${esc(trTitle(d.title))}</p>` : ""}
        <div class="lh-meta">
          <span class="badge">${icon("clock")} ${esc(t("lesson.minutes"))}</span>
          <span class="badge">${esc(t("lesson.steps", { n: steps.length }))}</span>
          ${d.words.length ? `<span class="badge">${esc(t("lesson.wordsN", { n: d.words.length }))}</span>` : ""}
          ${data.offline ? `<span class="badge warn">${esc(t("offline"))}</span>` : ""}
        </div>
        <div class="lh-prog">${bar(steps.length ? (nDone / steps.length) * 100 : 0, "ok")}<span>${esc(t("lesson.progress", { done: nDone, total: steps.length }))}</span></div>
      </section>
      <div class="steps" role="tablist">${steps.map((s) => `<button role="tab" data-act="step" data-s="${s}" class="${s === cur ? "on" : ""} ${done(s) ? "done" : ""}" aria-selected="${s === cur}">${done(s) ? `<span class="st-ok">${icon("check")}</span>` : ""}${icon(STEP_IC[s])}<span>${esc(t("step." + s))}</span></button>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- words
  function wordsView() {
    const tools = `
      <div class="tools">
        <button class="btn sm dark" data-act="wplay">${icon("play", "ico")} ${esc(t("words.listenAll", { n: d.words.length }))}</button>
        <button class="btn sm ghost" data-act="stopall">${esc(t("dialogue.stop"))}</button>
        <span class="grow"></span>
        <div class="seg" role="group"><button class="${wordsMode === "cards" ? "on" : ""}" data-act="mode" data-m="cards" aria-pressed="${wordsMode === "cards"}">${esc(t("words.cards"))}</button><button class="${wordsMode === "list" ? "on" : ""}" data-act="mode" data-m="list" aria-pressed="${wordsMode === "list"}">${esc(t("words.list"))}</button></div>
      </div>`;
    const cards = `<div class="fcards">${d.words.map((w, i) => `
      <div class="fcard ${flipped.has(i) ? "flipped" : ""}" data-i="${i}">
        <button class="fc-in" data-act="flip" data-i="${i}" aria-pressed="${flipped.has(i)}">
          <span class="fc-face fc-front"><span class="fc-n">${i + 1}</span><span class="fc-en">${esc(w.en)}</span><span class="fc-hint">${icon("repeat")} ${esc(t("words.flipHint"))}</span></span>
          <span class="fc-face fc-back"><span class="fc-tr">${esc(w[L] || w.uz)}</span>${w.ex && w.ex.en ? `<span class="fc-ex">${esc(w.ex.en)}</span><span class="fc-ext">${esc(w.ex[L] || w.ex.uz)}</span>` : ""}</span>
        </button>
        <span class="fc-say">${sayBtn(w.en)}</span>
      </div>`).join("")}</div>`;
    const list = `<div class="card">${d.words.map((w, i) => `
      <div class="word" data-i="${i}">
        ${sayBtn(w.en)}
        <div class="grow">
          <div class="en">${esc(w.en)}</div>
          <div class="tr">${esc(w[L] || w.uz)}</div>
          ${w.ex && w.ex.en ? `<div class="ex row" style="gap:6px;align-items:flex-start"><div class="grow">${esc(w.ex.en)}<div class="tr">${esc(w.ex[L] || w.ex.uz)}</div></div>${sayBtn(w.ex.en)}</div>` : ""}
        </div>
      </div>`).join("")}</div>`;
    return `
      <div class="step-intro"><div class="eyebrow">${esc(t("words.vocab"))}</div><p>${esc(t("words.tapFlip"))}</p></div>
      ${tools}
      ${wordsMode === "cards" ? cards : list}
      ${wp ? `<section class="card wp">
        <div class="wp-head"><span class="wp-ic">${icon("target")}</span><div class="grow"><h3 style="margin:0">${esc(t("wp.title"))}</h3><p class="small muted" style="margin:0">${esc(t("wp.sub"))}</p></div></div>
        ${canMatch && canBlank ? `<div class="seg" role="group"><button class="${wp.mode === "match" ? "on" : ""}" data-act="wpmode" data-m="match">${esc(t("game.match"))}</button><button class="${wp.mode === "blank" ? "on" : ""}" data-act="wpmode" data-m="blank">${esc(t("wp.blank"))}</button></div>` : ""}
        <div id="wp">${wpView()}</div>
      </section>` : ""}
      <button class="btn primary block" style="margin-top:16px" data-act="finish" data-s="words">${icon("check")} ${esc(t("words.learned"))}</button>`;
  }

  function wpView() {
    if (wp.mode === "match") {
      const n = wp.pairs.length;
      if (wp.matched.size === n) {
        return `<div class="wp-done stack"><span class="num ok-text">${n} / ${n}</span><b>${esc(t("wp.matched"))}</b>${wp.xp ? `<span class="small muted">+${wp.xp} XP</span>` : ""}
          <button class="btn primary" data-act="wpnew">${icon("repeat", "ico")} ${esc(t("wp.newSet"))}</button></div>`;
      }
      const cls = (side, k) => wp.matched.has(k) ? "right" : wp.wrong && wp.wrong[side] === k ? "wrong" : (side === 0 ? wp.selL : wp.selR) === k ? "sel" : "";
      return `<div class="wp-top"><span>${esc(t("game.matchSub"))}</span><span>${wp.matched.size} / ${n}</span></div>
        <div class="pairs">
          <div class="col">${wp.left.map((k) => `<button class="opt pair ${cls(0, k)}" data-act="wpl" data-k="${k}" ${wp.matched.has(k) ? "disabled" : ""}>${esc(wp.pairs[k].en)}</button>`).join("")}</div>
          <div class="col">${wp.right.map((k) => `<button class="opt pair ${cls(1, k)}" data-act="wpr" data-k="${k}" ${wp.matched.has(k) ? "disabled" : ""}>${esc(wp.pairs[k].tr)}</button>`).join("")}</div>
        </div>`;
    }
    const qs = wp.qs;
    if (wp.i >= qs.length) {
      return `<div class="wp-done stack"><span class="num ${wp.right === qs.length ? "ok-text" : ""}">${wp.right} / ${qs.length}</span><b>${esc(t("game.score", { n: wp.right, total: qs.length }))}</b>${wp.xp ? `<span class="small muted">+${wp.xp} XP</span>` : ""}
        <button class="btn primary" data-act="wpnew">${icon("repeat", "ico")} ${esc(t("wp.newSet"))}</button></div>`;
    }
    const q = qs[wp.i], answered = wp.pick !== null;
    const gapCls = answered ? "ok" : "";
    return `<div class="wp-top"><span>${esc(t("wp.blankHelp"))}</span><span>${wp.i + 1} / ${qs.length}</span></div>
      <div class="blank-s">${esc(q.before)}<span class="gap ${gapCls}">${answered ? esc(q.answer) : "&nbsp;"}</span>${esc(q.after)}</div>
      ${q.tr ? `<div class="blank-tr">${esc(q.tr)}</div>` : ""}
      <div class="opts two">${q.opts.map((o, j) => {
        const c = answered ? (j === q.a ? "right" : j === wp.pick ? "wrong" : "") : "";
        return `<button class="opt ${c}" data-act="wpb" data-o="${j}" ${answered ? "disabled" : ""}><span class="opt-l">${LETTERS[j]}</span><span>${esc(o)}</span></button>`;
      }).join("")}</div>
      ${answered ? `<div class="row" style="margin-top:12px"><span class="grow ${wp.pick === q.a ? "ok-text" : "bad-text"}"><b>${esc(wp.pick === q.a ? t("game.right") : t("game.wrong"))}</b></span>
        <button class="btn primary sm" data-act="wpnext">${esc(t("next"))} ${icon("chevron", "ico")}</button></div>` : ""}`;
  }

  // ---------------------------------------------------------------- dialogue and role-play
  function dialogueView() {
    return `
      <div class="step-intro"><div class="eyebrow">${esc(t("step.dialogue"))}</div><p>${esc(t("dialogue.intro"))}</p></div>
      <div class="tools">
        <button class="btn sm dark" data-act="playall">${icon("play", "ico")} ${esc(t("dialogue.playAll"))}</button>
        <button class="btn sm ghost" data-act="stopall">${esc(t("dialogue.stop"))}</button>
        <label class="switch-row small"><input type="checkbox" data-act="tr" ${showTr ? "checked" : ""}> ${esc(t("dialogue.showTr"))}</label>
      </div>
      <div class="chat">${d.dialogue.map((l, i) => `
        <div class="bubble ${l.who === rp.me ? "me" : ""} ${rp.on && rp.hide && rp.phase !== "end" && l.who === rp.me ? "hide-en" : ""}" data-line="${i}">
          <div class="who">${esc(l.who)}</div>
          <div class="en" style="padding-right:40px">${esc(l.en)}</div>
          ${showTr ? `<div class="tr">${esc(l[L] || l.uz)}</div>` : ""}
          <span class="play">${sayBtn(l.en, { gender: voiceOf(l.who) })}</span>
        </div>`).join("")}
      </div>
      ${people.length >= 2 ? `<section class="card rp" id="rp">${rpView()}</section>` : ""}
      <button class="btn primary block" style="margin-top:16px" data-act="finish" data-s="dialogue">${esc(t("continue"))}</button>`;
  }

  function rpView() {
    if (!rp.on) {
      return `
        <div class="rp-head"><span class="rp-ic">${icon("mic")}</span><div class="grow"><h3>${esc(t("rp.title"))}</h3><p class="small muted">${esc(t("rp.sub"))}</p></div></div>
        <div class="stack" style="margin-top:12px">
          <div class="rp-label">${esc(t("rp.youPlay"))}</div>
          <div class="chips" role="group">${people.map((w, i) => `<button class="chip ${w === rp.me ? "on" : ""}" data-act="rpwho" data-w="${i}" aria-pressed="${w === rp.me}">${esc(w)}</button>`).join("")}</div>
          <label class="switch-row small"><input type="checkbox" data-act="rphide" ${rp.hide ? "checked" : ""}> ${esc(t("rp.challenge"))}</label>
          <button class="btn primary block" data-act="rpstart">${icon("play", "ico")} ${esc(t("rp.start"))}</button>
        </div>`;
    }
    const total = d.dialogue.length;
    if (rp.phase === "end") {
      const nums = rp.scores.filter((x) => typeof x === "number");
      const avg = nums.length ? Math.round(nums.reduce((s, x) => s + x, 0) / nums.length) : null;
      const other = people.find((w) => w !== rp.me);
      return `<div class="rp-sum stack">
        <div class="done-ic" style="width:60px;height:60px;border-radius:18px">${icon("award")}</div>
        <h3 style="margin:0">${esc(t("rp.done"))}</h3>
        ${avg !== null ? `<div class="rp-score ${avg >= 60 ? "ok-text" : ""}">${avg}%</div><div class="small muted">${esc(t("rp.avg", { n: avg }))}</div>` : ""}
        ${rp.xp ? `<div class="small muted">+${rp.xp} XP</div>` : ""}
        <div class="row wrap-row" style="justify-content:center">
          <button class="btn primary" data-act="rpstart">${icon("repeat", "ico")} ${esc(t("game.again"))}</button>
          ${other ? `<button class="btn ghost" data-act="rpswap">${esc(t("rp.other"))}: ${esc(other)}</button>` : ""}
        </div>
      </div>`;
    }
    const line = d.dialogue[rp.i] || {};
    const mine = line.who === rp.me;
    const masked = mine && rp.hide && !rp.shown && rp.phase !== "result";
    let body = "";
    if (rp.phase === "other") {
      body = `<p class="muted small center" style="margin:10px 0 0">${icon("volume", "ico")} ${esc(t("rp.listen"))}</p>`;
    } else if (rp.phase === "paused") {
      body = `<button class="btn primary block" style="margin-top:12px" data-act="rpgo">${icon("play", "ico")} ${esc(t("continue"))}</button>`;
    } else if (rp.phase === "mine" || rp.phase === "result") {
      const r = rp.res;
      body = `
        ${r ? `<div class="answer ${r.score >= 60 ? "ok" : "bad"}" style="margin-top:12px">
          <b>${esc(r.score >= 60 ? t("say.great") : t("say.again"))} · ${r.score}%</b>
          <div class="say-phrase" style="font-size:1.15rem">${r.words.map((x) => `<span class="${x.ok ? "w-ok" : "w-miss"}">${esc(x.w)}</span>`).join(" ")}</div>
          <div class="tiny muted">${esc(t("say.heard"))}: “${esc(rp.heard)}”</div>
        </div>` : ""}
        ${hasSR() ? `<button class="mic ${rp.rec ? "on" : ""}" data-act="rpmic" aria-label="${esc(t("rp.tapMic"))}">${icon("mic")}</button>
          <div class="muted small center">${esc(rp.rec ? t("speak.listening") : r ? t("rp.again") : t("rp.tapMic"))}</div>`
          : `<p class="small muted" style="margin:12px 0 0">${esc(t("rp.noMic"))}</p>`}
        <div class="row wrap-row" style="margin-top:12px">
          ${masked ? `<button class="btn ghost sm" data-act="rpshow">${esc(t("rp.show"))}</button>` : ""}
          ${!hasSR() ? `<button class="btn primary grow" data-act="rpself">${icon("check", "ico")} ${esc(t("say.saidIt"))}</button>` : ""}
          ${hasSR() && !r ? `<span class="grow"></span><button class="btn ghost sm" data-act="rpself">${esc(t("say.saidIt"))}</button>` : ""}
          ${hasSR() && r ? `<button class="btn primary grow" data-act="rpnext">${esc(t("next"))} ${icon("chevron", "ico")}</button>` : ""}
        </div>`;
    }
    return `
      <div class="row between" style="margin-bottom:10px"><span class="rp-label">${esc(t("rp.line", { n: Math.min(rp.i + 1, total), total }))}</span><button class="btn ghost sm" data-act="rpstop">${esc(t("dialogue.stop"))}</button></div>
      ${bar((rp.i / total) * 100)}
      <div class="rp-line ${mine ? "mine" : ""}" style="margin-top:12px">
        <div class="who">${esc(line.who || "")}${mine ? " · " + esc(t("rp.yourTurn")) : ""}</div>
        <div class="en ${masked ? "masked" : ""}">${esc(line.en || "")}</div>
        <div class="tr">${esc(line[L] || line.uz || "")}</div>
        ${mine && !masked ? `<div style="margin-top:8px">${sayBtn(line.en, { gender: voiceOf(line.who) })}</div>` : ""}
      </div>
      ${body}`;
  }

  function markBubbles() {
    root.querySelectorAll(".bubble[data-line]").forEach((b) => b.classList.toggle("speaking", rp.on && rp.phase !== "end" && Number(b.dataset.line) === rp.i));
  }

  // ---------------------------------------------------------------- grammar, quiz, speaking
  function grammarView() {
    return `
      <div class="card stack tipcard">
        <div class="row"><span class="tip-ic">${icon("book")}</span><div class="grow"><div class="eyebrow" style="margin:0">${esc(t("grammar.tip"))}</div><h2 style="margin:0">${esc(pick(d.tip.title))}</h2></div></div>
        <p style="font-size:1.05rem;margin:0">${esc(pick(d.tip.text))}</p>
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
      </div>` : `<div class="step-intro"><div class="eyebrow">${esc(t("step.quiz"))}</div><p>${esc(t("quiz.intro"))}</p></div>`}
      ${d.quiz.map((q, i) => `
        <div class="quiz-q card">
          <div class="q">${i + 1}. ${esc(q.q.en)}</div>
          ${q.q[L] ? `<div class="qtr">${esc(q.q[L])}</div>` : ""}
          <div class="opts">${q.opts.map((o, j) => {
            let cls = "";
            if (r) { const res = r.results[i]; if (res.answer === j) cls = "right"; else if (quiz.picks[i] === j) cls = "wrong"; }
            else if (quiz.picks[i] === j) cls = "sel";
            return `<button class="opt ${cls}" data-act="pick" data-q="${i}" data-o="${j}" ${r ? "disabled" : ""}><span class="opt-l">${LETTERS[j] || j + 1}</span><span>${esc(o)}</span></button>`;
          }).join("")}</div>
        </div>`).join("")}
      ${r ? `<div class="row"><button class="btn grow" data-act="quizagain">${esc(t("quiz.again"))}</button>${nextStepBtn("quiz")}</div>`
          : `<button class="btn primary block" data-act="check" ${quiz.busy ? "disabled" : ""}>${esc(t("quiz.check"))}</button>`}`;
  }

  function speakView() {
    const r = speak.result;
    return `
      <div class="card stack">
        <div class="row"><span class="tip-ic" style="background:var(--sky-soft);color:var(--steel)">${icon("mic")}</span><div class="grow"><div class="eyebrow" style="margin:0">${esc(t("speak.task"))}</div>
        <p style="font-size:1.08rem;margin:0"><b>${esc(pick(d.speak))}</b></p></div></div>
        ${L !== "en" ? `<p class="small muted" style="margin:0">${esc(d.speak.en)}</p>` : ""}
      </div>
      <div class="card stack center" style="margin-top:12px">
        ${hasSR() ? `<button class="mic ${speak.listening ? "on" : ""}" data-act="mic" aria-label="Mic">${icon("mic")}</button>
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
      <div class="lesson-foot">
        ${prevDay ? `<a class="btn ghost sm" href="/app/day/${prevDay.n}" data-link>${icon("left", "ico")} ${esc(t("prev"))}</a>` : "<span></span>"}
        ${nextDay ? `<a class="btn ghost sm" href="/app/day/${nextDay.n}" data-link>${esc(t("next"))} ${icon("chevron", "ico")}</a>` : ""}
      </div>`;
    const ta = root.querySelector("#speakText");
    if (ta) ta.addEventListener("input", () => { speak.text = ta.value; });
    markBubbles();
  }
  const paintWp = () => { const el = root.querySelector("#wp"); if (el) el.innerHTML = wpView(); };
  const paintRp = () => { const el = root.querySelector("#rp"); if (el) el.innerHTML = rpView(); markBubbles(); };

  function complete(s) {
    const first = !done(s);
    markStep(n, s);
    if (first && STEP_XP[s]) addXp(STEP_XP[s]);
    if (s === "words") addCards(d.words.map((w) => w.id));
    const allDone = steps.every((x) => done(x));
    if (allDone && !(state.progress.days[n] && state.progress.days[n].done)) {
      markDayDone(n);
      addXp(20);
      paint();
      const xp = steps.reduce((sum, x) => sum + (STEP_XP[x] || 0), 20);
      const certReady = !!d.final && certificateStatus(cat, state.progress).ready;
      const bits = Array.from({ length: 26 }, (_, i) => `<i style="--x:${(i * 37 + 5) % 100}%;--d:${((i % 9) * 0.11).toFixed(2)}s;--c:${CONFETTI[i % CONFETTI.length]};--r:${(i * 47) % 360}deg"></i>`).join("");
      const m = modal(`<div class="confetti" aria-hidden="true">${bits}</div>
        <div class="center stack party-in">
          <div class="done-ic">${icon("award")}</div>
          <h2 style="margin:0">${esc(t("lesson.dayDone"))}</h2>
          <p class="muted" style="margin:0">${esc(label)} · ${esc(enTitle(d.title))}</p>
          <div class="done-stats">
            <div><b>+${xp}</b><span>XP</span></div>
            <div><b>${streak(state.progress)}</b><span>${esc(t("home.streak"))}</span></div>
            ${d.words.length ? `<div><b>${d.words.length}</b><span>${esc(t("done.cards"))}</span></div>` : ""}
          </div>
          <div class="stack">${certReady ? `<a class="btn primary block" href="/app/certificate" data-link data-close>${esc(t("cert.open"))}</a>` : ""}
          ${nextDay ? `<a class="btn ${certReady ? "" : "primary"} block" href="/app/day/${nextDay.n}" data-link data-close>${esc(t("lesson.nextDay"))}</a>` : ""}
          <a class="btn block" href="/app/course" data-link data-close>${esc(t("lesson.toCourse"))}</a></div>
        </div>`);
      m.el.classList.add("party");
      return m;
    }
    const i = steps.indexOf(s);
    if (i < steps.length - 1) cur = steps[i + 1];
    paint();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- role-play: the app says the other lines, the student says theirs
  function rpEndRec() { if (rp.rec) { const r = rp.rec; rp.rec = null; try { r.abort(); } catch { /* ignore */ } } }
  function rpStop() { rpEndRec(); stop(); rp.on = false; rp.phase = ""; }
  async function rpAdvance() {
    const live = rp.run;
    while (rp.i < d.dialogue.length && d.dialogue[rp.i].who !== rp.me) {
      rp.phase = "other"; paintRp();
      const line = d.dialogue[rp.i];
      const r = await play(line.en, { gender: voiceOf(line.who) });
      if (!live()) return;
      if (r === "stopped") { rp.phase = "paused"; paintRp(); return; }
      if (!(await pause(350)) || !live()) return;
      rp.i++;
    }
    if (rp.i >= d.dialogue.length) { rp.phase = "end"; paint(); return; }
    rp.phase = "mine"; rp.heard = ""; rp.res = null; rp.best = null; rp.shown = false;
    paintRp();
  }
  function rpStart() {
    rpEndRec();
    rp.on = true; rp.i = 0; rp.scores = []; rp.xp = 0; rp.phase = "other";
    rp.run = newRun();
    paint();
    const box = root.querySelector("#rp");
    if (box) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    rpAdvance();
  }
  function rpNext(score, xp) {
    rpEndRec();
    rp.scores.push(score);
    if (xp) { rp.xp += xp; addXp(xp); }
    rp.i++;
    rp.run = newRun();
    rpAdvance();
  }

  paint();
  const off = onAct(root, {
    step: (el) => { if (rp.on) rpStop(); stop(); cur = el.dataset.s; paint(); },
    mode: (el) => { wordsMode = el.dataset.m === "list" ? "list" : "cards"; paint(); },
    flip: (el) => {
      const i = Number(el.dataset.i);
      const on = !flipped.has(i);
      if (on) flipped.add(i); else flipped.delete(i);
      const card = el.closest(".fcard");
      card.classList.toggle("flipped", on);
      el.setAttribute("aria-pressed", String(on));
    },
    wplay: () => {
      const items = () => [...root.querySelectorAll(".fcard, .word[data-i]")];
      playAll(d.words.map((w) => ({ text: w.en })), (i) => {
        items().forEach((c) => c.classList.toggle("playing", Number(c.dataset.i) === i));
        const c = items().find((x) => Number(x.dataset.i) === i);
        if (c) c.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    finish: (el) => { if (rp.on) rpStop(); complete(el.dataset.s); },
    // practice with the day's words
    wpmode: (el) => { newWp(el.dataset.m === "blank" ? "blank" : "match"); paint(); },
    wpnew: () => { newWp(wp.mode); paintWp(); },
    wpl: (el) => { const k = Number(el.dataset.k); if (wp.matched.has(k)) return; wp.selL = k; play(wp.pairs[k].en); wpPair(); },
    wpr: (el) => { const k = Number(el.dataset.k); if (wp.matched.has(k)) return; wp.selR = k; wpPair(); },
    wpb: (el) => {
      if (wp.pick !== null) return;
      wp.pick = Number(el.dataset.o);
      const q = wp.qs[wp.i];
      if (wp.pick === q.a) { wp.right++; wp.xp += 2; addXp(2); }
      paintWp();
      play(q.before + q.answer + q.after);
    },
    wpnext: () => { wp.i++; wp.pick = null; paintWp(); },
    // dialogue
    playall: () => {
      if (rp.on) { rpStop(); paint(); }
      const bubbles = () => [...root.querySelectorAll(".bubble")];
      playAll(d.dialogue.map((l) => ({ text: l.en, gender: voiceOf(l.who) })), (i) => {
        bubbles().forEach((b, j) => b.classList.toggle("playing", j === i));
        if (i >= 0 && bubbles()[i]) bubbles()[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    stopall: () => { stop(); root.querySelectorAll(".playing").forEach((x) => x.classList.remove("playing")); },
    tr: () => { showTr = !showTr; paint(); },
    rpwho: (el) => { rp.me = people[Number(el.dataset.w)] || rp.me; paint(); },
    rphide: () => { rp.hide = !rp.hide; paintRp(); },
    rpstart: () => rpStart(),
    rpswap: () => { rp.me = people.find((w) => w !== rp.me) || rp.me; rpStart(); },
    rpstop: () => { rpStop(); paint(); },
    rpgo: () => { rp.run = newRun(); rpAdvance(); },
    rpshow: () => { rp.shown = true; paintRp(); },
    rpself: () => rpNext(null, 1),
    rpnext: () => rpNext(rp.best, rp.best >= 60 ? 2 : 0),
    rpmic: () => {
      if (rp.rec) { try { rp.rec.stop(); } catch { /* ignore */ } return; }
      stop();
      const line = d.dialogue[rp.i];
      let heard = "";
      const rec = recognizer({
        onText: (s) => { heard = s; },
        onEnd: () => {
          if (rp.rec !== rec) return;
          rp.rec = null;
          if (heard) {
            rp.heard = heard;
            rp.res = compareSpeech(line.en, heard);
            rp.best = Math.max(rp.best || 0, rp.res.score);
            rp.phase = "result";
          } else toast(t("say.again"));
          paintRp();
        },
      });
      if (!rec) { toast(t("rp.noMic")); return; }
      rp.rec = rec;
      paintRp();
      try { rec.start(); } catch { rp.rec = null; paintRp(); }
    },
    // quiz
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
    // speaking
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

  function wpPair() {
    if (wp.selL === null || wp.selR === null) { paintWp(); return; }
    if (wp.selL === wp.selR) { wp.matched.add(wp.selL); wp.xp += 1; addXp(1); }
    else {
      wp.wrong = [wp.selL, wp.selR];
      clearTimeout(wpTimer); wpTimer = setTimeout(() => { if (wp) { wp.wrong = null; paintWp(); } }, 700);
    }
    wp.selL = wp.selR = null;
    paintWp();
  }

  return () => { off(); stop(); clearTimeout(wpTimer); rpEndRec(); if (speak.rec) try { speak.rec.abort(); } catch { /* ignore */ } };
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
