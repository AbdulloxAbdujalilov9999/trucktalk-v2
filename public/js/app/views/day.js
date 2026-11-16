/* One course day, laid out like the main TruckTalk app: a head with the day's title, big tabs, the tab's parts one after
 * another, and "Next: …" at the bottom.
 *   Words         flip cards (or a list), then practice: fill in the blank and match the words
 *   Conversation  the dialogue, a spoken role-play (the app plays the other person, the microphone checks your lines),
 *                 and a speaking task checked by the AI teacher
 *   Grammar       the day's rule, with a link to the full unit
 *   Quiz          the day's questions (graded by the server) plus questions on the day's words
 * A review day has Practice (the whole week's words), Conversation (any dialogue of the week) and the review quiz.
 * "Next" marks a part done; the day is done when every part is, and the quiz has been taken. */
import { t, pick, trLang, lang } from "../i18n.js";
import { esc, icon, onAct, spinner, errorBox, sayBtn, toast, modal } from "../ui.js";
import { api, cachedGet } from "../api.js";
import { state, markStep, markDayDone, addXp, addCards, update, setting } from "../store.js";
import { catalog, go, showLock } from "../main.js";
import { play, playAll, stop, pause, newRun } from "../audio.js";
import { lockedView, recognizer, hasSpeech, certificateStatus, titleParts, dayRow, dayLabel, allDays, weekDays, weekTitle, isDone, isLocked, pctOf } from "./common.js";
import { currentUser } from "../auth.js";
import { compareSpeech, distinctItems, shuffle } from "../../shared/drills.js";
import { blankRound, vocabRound, speakers, defaultSpeaker } from "../../shared/lesson.js";
import { streak, review as reviewCard } from "../../shared/progress.js";

const STEP_XP = { words: 10, dialogue: 10, grammar: 5, quiz: 0, speak: 10 };
const RP_PASS = 70;
const CONFETTI = ["#4A7FA7", "#B3CFE5", "#1B7F57", "#F2A900", "#1A3D63"];
const SEC = { vocab: "sec.vocab", practice: "sec.practice", dialogue: "sec.dialogue", roleplay: "sec.roleplay", speak: "sec.speak" };

/** Two voices, so a dialogue sounds like two people: the driver gets the male voice, the other side the female one. */
function voicesFor(lines) {
  const people = speakers(lines);
  const driver = people.find((w) => /^driver$/i.test(w)) || people.find((w) => /driver|haydovchi/i.test(w));
  return (who) => (driver ? (who === driver ? "male" : "female") : people.indexOf(who) % 2 === 0 ? "male" : "female");
}

/** Asks for the microphone once, before a role-play, so a blocked or missing microphone is known up front. */
async function ensureMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { ok: true };
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((x) => x.stop());
    return { ok: true };
  } catch (e) {
    const nm = e && e.name;
    return { ok: false, reason: nm === "NotAllowedError" || nm === "SecurityError" ? "denied" : nm === "NotFoundError" || nm === "OverconstrainedError" ? "nomic" : "fail" };
  }
}
/** iPhones only let speech start from a tap; the microphone prompt uses up that tap, so wake the voice first. */
function unlockSpeech() {
  try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch { /* no speech engine */ }
}

export default async function day(root, [nStr], { query }) {
  const n = Number(nStr);
  const cat = await catalog();
  const row = dayRow(cat, n);
  if (!row) { go("/app/course", { replace: true }); return; }
  const a = state.me.access;
  const label = dayLabel(cat, n), tp = titleParts(row.title);
  if (isLocked(row, a)) return lockedView(root, `${t("day", { n: label })} · ${tp.main}`, `/app/course/${row.week}`);

  // ---------------------------------------------------------------- load the day (a review day: the week's days too)
  root.innerHTML = spinner();
  const uid = currentUser() ? currentUser().uid : "anon";
  let data;
  try { data = await cachedGet(`content?kind=day&id=${n}`, "day:" + n, { uid }); }
  catch (e) {
    if (e.status === 401 || e.status === 402) return lockedView(root, `${t("day", { n: label })} · ${tp.main}`, `/app/course/${row.week}`);
    root.innerHTML = errorBox(e.code === "network" ? t("error.network") : t("error.generic"));
    return onAct(root, { retry: () => day(root, [nStr], { query }) });
  }
  const d = data.item;
  const L = trLang();
  let weekData = [];
  if (d.review) {
    const src = weekDays(cat, row.week).filter((x) => !x.review && x.n !== n);
    weekData = (await Promise.all(src.map((x) => cachedGet(`content?kind=day&id=${x.n}`, "day:" + x.n, { uid }).then((r) => r.item).catch(() => null)))).filter(Boolean);
  }
  const days = allDays(cat);
  const at = days.findIndex((x) => x.n === n);
  const prevDay = days[at - 1] || null;
  const nextDay = days[at + 1] || null;
  const weekTp = titleParts(weekTitle(cat, row.week));

  const wordSrc = d.review ? weekData.flatMap((x) => x.words) : d.words;
  const wordItems = wordSrc.map((w) => ({ id: w.id, en: w.en, tr: w[L] || w.uz }));
  const blankItems = wordSrc.map((w) => ({ id: w.id, en: w.en, ex: w.ex && w.ex.en, tr: w.ex && (w.ex[L] || w.ex.uz) }));
  const convs = d.review ? weekData.filter((x) => x.dialogue.length).map((x) => ({ n: x.n, title: x.title, lines: x.dialogue })) : [{ n, title: d.title, lines: d.dialogue }];
  const showTr = () => setting("showUz", true) !== false;

  const TABS = d.review
    ? [{ id: "practice", label: "tab.practice", ic: "target", step: "words", parts: ["practice"] },
      { id: "talk", label: "tab.talk", ic: "talk", step: "dialogue", parts: ["roleplay", "speak"] },
      { id: "quiz", label: "tab.reviewQuiz", ic: "clipboard", step: "quiz", parts: ["quiz"] }]
    : [{ id: "vocab", label: "tab.words", ic: "cards", step: "words", parts: ["vocab", "practice"] },
      { id: "talk", label: "tab.talk", ic: "talk", step: "dialogue", parts: ["dialogue", "roleplay", "speak"] },
      { id: "grammar", label: "tab.grammar", ic: "grammar", step: "grammar", parts: ["grammar"] },
      { id: "quiz", label: "tab.quiz", ic: "clipboard", step: "quiz", parts: ["quiz"] }];
  const stepDone = (k) => !!(state.progress.days[n] && state.progress.days[n].s && state.progress.days[n].s[k]);
  const dayDone = () => isDone(state.progress, n);
  let cur = TABS.find((x) => x.id === query.get("tab")) || (dayDone() ? TABS[0] : TABS.find((x) => !stepDone(x.step))) || TABS[0];

  // ---------------------------------------------------------------- state of each part
  let wordsMode = "cards";
  const flipped = new Set();
  let ps = newPractice();
  let rp = rpFresh();
  let speak = { text: "", result: null, busy: false, rec: null, listening: false };
  let quiz = newQuiz();

  function newPractice() {
    const blanks = blankRound(blankItems, 6).map((q) => ({ ...q, pick: null }));
    const pairs = distinctItems(wordItems, 6);
    return { blanks, pairs, right: shuffle(pairs.map((_, k) => k)), selL: null, selR: null, matched: new Set(), wrong: false };
  }
  function newQuiz() {
    const vocab = vocabRound(wordItems, d.review ? 8 : 6);
    return { vocab, answers: {}, result: null, busy: false };
  }

  // ---------------------------------------------------------------- head, tabs, step navigation
  function head() {
    const got = TABS.filter((x) => stepDone(x.step)).length;
    const score = pctOf(state.progress.quiz["day:" + n]);
    const pager = (x, dir) => {
      if (!x) return `<button class="btn ghost sm" disabled>${dir < 0 ? icon("arrowL") : ""}${esc(t("dayShort"))}${dir > 0 ? icon("arrowR") : ""}</button>`;
      const txt = esc(t("day", { n: dayLabel(cat, x.n) }));
      return `<a class="btn ghost sm" href="/app/day/${x.n}" ${isLocked(x, a) ? `data-act="locked"` : "data-link"}>${dir < 0 ? icon("arrowL") + " " + txt : txt + " " + icon("arrowR")}</a>`;
    };
    return `<section class="lesson-head">
      <div class="lesson-head-top">
        <a class="btn ghost sm" href="/app/course/${row.week}" data-link>${icon("arrowL")} ${esc(row.week === 0 ? t("lessons.orientation") : t("week", { n: row.week }))}</a>
        <div class="lesson-pager">${pager(prevDay, -1)}${pager(nextDay, 1)}</div>
      </div>
      <p class="eyebrow">${esc(row.week === 0 ? t("lessons.orientationCaps") : t("lessons.weekCaps", { n: row.week }))} · ${esc(weekTp.main)}${d.review ? " · " + esc(t("lessons.reviewCaps")) : ""}</p>
      <h1 class="hwy-title">${esc(t("lesson.title", { n: label, title: tp.main }))}</h1>
      ${tp.sub ? `<p class="lesson-title-uz">${esc(tp.sub)}</p>` : ""}
      <div class="lesson-badges">
        <span class="badge-time">${icon("clock")} ${esc(t(d.review ? "lesson.minReview" : "lesson.min"))}</span>
        ${dayDone() ? `<span class="badge-complete">${icon("check")} ${esc(score != null ? t("lesson.completedScore", { n: score }) : t("lesson.completed"))}</span>`
          : `<span class="badge-time">${esc(t("lesson.partsDone", { a: got, b: TABS.length }))}</span>`}
        ${data.offline ? `<span class="badge warn">${esc(t("offline.short"))}</span>` : ""}
      </div>
    </section>`;
  }

  function tabsBar() {
    return `<div class="ltabs" role="tablist">${TABS.map((x) => `<button class="tabbtn${x === cur ? " on" : ""}" role="tab" aria-selected="${x === cur}" data-act="tab" data-t="${x.id}">
      ${stepDone(x.step) ? `<span class="tab-ok" aria-label="${esc(t("done"))}">${icon("check")}</span>` : ""}<span class="tab-ico">${icon(x.ic)}</span><span class="tab-lbl">${esc(t(x.label))}</span></button>`).join("")}</div>`;
  }

  function stepNav() {
    const i = TABS.indexOf(cur), prev = TABS[i - 1], next = TABS[i + 1];
    let right = "<span></span>";
    if (next) right = `<button class="btn primary" data-act="nextpart"><span>${esc(t("lesson.nextPart", { name: t(next.label) }))}</span> ${icon("arrowR")}</button>`;
    else if (nextDay) {
      const nl = dayLabel(cat, nextDay.n);
      right = isLocked(nextDay, a)
        ? `<button class="btn ghost" data-act="locked">${icon("lock")} <span>${esc(t("lesson.dayLocked", { n: nl }))}</span></button>`
        : `<a class="btn primary" href="/app/day/${nextDay.n}" data-link><span>${esc(t("day", { n: nl }))}</span> ${icon("arrowR")}</a>`;
    }
    return `<div class="step-nav">${prev ? `<button class="btn ghost" data-act="tab" data-t="${prev.id}">${icon("arrowL")} <span>${esc(t(prev.label))}</span></button>` : "<span></span>"}${right}</div>`;
  }

  function body() {
    const multi = cur.parts.length > 1;
    return cur.parts.map((p) => `<div class="lesson-sec" id="sec-${p}">${multi ? `<h2 class="sec-title">${esc(t(SEC[p]))}</h2>` : ""}<div id="part-${p}">${partHtml(p)}</div></div>`).join("");
  }
  const partHtml = (p) => ({ vocab: vocabHtml, practice: practiceHtml, dialogue: dialogueHtml, roleplay: rpHtml, speak: speakHtml, grammar: grammarHtml, quiz: quizHtml }[p])();

  function paint() {
    root.innerHTML = head() + tabsBar() + `<section class="panel lesson-body" id="lessonBody">${body()}</section>` + stepNav();
    afterPaint();
  }
  /** Redraws the head, tabs and bottom buttons (after a part is marked done) without touching the open part. */
  function paintChrome() {
    const h = root.querySelector(".lesson-head"), tb = root.querySelector(".ltabs"), sn = root.querySelector(".step-nav");
    if (h) h.outerHTML = head();
    if (tb) tb.outerHTML = tabsBar();
    if (sn) sn.outerHTML = stepNav();
  }
  function paintPart(p, noScroll) {
    const el = root.querySelector("#part-" + p);
    if (!el) return;
    el.innerHTML = partHtml(p);
    afterPaint();
    if (p === "roleplay" && !noScroll) {
      const turn = root.querySelector("#rpTurn") || (rp.phase === "done" && root.querySelector(".rp-summary"));
      if (turn) turn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
  function afterPaint() {
    const ta = root.querySelector("#speakText");
    if (ta && ta.value !== speak.text) ta.value = speak.text;
  }

  // ---------------------------------------------------------------- words
  function vocabHtml() {
    const tr = showTr();
    const cards = `<div class="flashcards">${d.words.map((w, i) => `
      <div class="flashcard${flipped.has(i) ? " flipped" : ""}" data-i="${i}">
        <button class="flashcard-inner" data-act="flip" data-i="${i}" aria-pressed="${flipped.has(i)}">
          <span class="flashcard-face flashcard-front"><span class="fc-num">${i + 1}</span><span class="fc-en">${esc(w.en)}</span><span class="fc-hint">${esc(t("vocab.tapFlip"))}</span></span>
          <span class="flashcard-face flashcard-back">${tr ? `<span class="fc-uz">${esc(w[L] || w.uz)}</span>` : ""}${w.ex && w.ex.en ? `<span class="fc-ex">“${esc(w.ex.en)}”</span>` : ""}</span>
        </button>
        ${sayBtn(w.en)}
      </div>`).join("")}</div>`;
    const list = `<div class="transcript">${d.words.map((w, i) => `
      <div class="transcript-line" data-i="${i}">
        <div class="line-text">
          <p class="line-en">${esc(w.en)}</p>
          ${tr ? `<p class="line-uz">${esc(w[L] || w.uz)}</p>` : ""}
          ${w.ex && w.ex.en ? `<p class="line-ex">“${esc(w.ex.en)}”${tr && (w.ex[L] || w.ex.uz) ? ` <i>${esc(w.ex[L] || w.ex.uz)}</i>` : ""}</p>` : ""}
        </div>
        ${sayBtn(w.en)}
      </div>`).join("")}</div>`;
    return `<div class="vocab-head">
        <p class="panel-sub">${esc(t(tr ? "vocab.help" : "vocab.helpNoTr"))}</p>
        <div class="row wrap-row">
          <button class="btn primary sm" data-act="wplay">${icon("play")} ${esc(t("vocab.listenAll", { n: d.words.length }))}</button>
          <div class="seg" role="group" aria-label="${esc(t("vocab.view"))}"><button class="${wordsMode === "cards" ? "on" : ""}" data-act="wmode" data-m="cards" aria-pressed="${wordsMode === "cards"}">${esc(t("vocab.cards"))}</button><button class="${wordsMode === "list" ? "on" : ""}" data-act="wmode" data-m="list" aria-pressed="${wordsMode === "list"}">${esc(t("vocab.list"))}</button></div>
        </div>
      </div>
      ${wordsMode === "cards" ? cards : list}`;
  }

  function practiceHtml() {
    if (!wordItems.length) return `<p class="panel-sub">${esc(t("practice.none"))}</p>`;
    const tr = showTr();
    const answered = ps.blanks.filter((q) => q.pick !== null), right = answered.filter((q) => q.pick === q.a).length;
    const fib = ps.blanks.length ? `<div class="practice-block">
      <span class="tip-label">${esc(t("practice.fibHead", { a: right, b: ps.blanks.length }))}</span>
      ${ps.blanks.map((q, i) => {
        const done = q.pick !== null, ok = q.pick === q.a;
        const gap = done ? `<span class="fib-filled ${ok ? "correct" : "incorrect"}">${esc(q.opts[q.pick])}</span>` : `<span class="fib-blank">____</span>`;
        return `<div class="fib-item">
          <p class="fib-sentence"><span>${esc(q.before)}${gap}${esc(q.after)}</span>${done ? sayBtn(q.before + q.answer + q.after) : ""}</p>
          ${tr && q.tr ? `<p class="fib-uz">${esc(q.tr)}</p>` : ""}
          <div class="fib-bank">${q.opts.map((o, j) => `<button class="fib-chip${done ? (j === q.a ? " correct" : j === q.pick ? " incorrect" : "") : ""}" data-act="fib" data-q="${i}" data-o="${j}" ${done ? "disabled" : ""}>${esc(o)}</button>`).join("")}</div>
          ${done && !ok ? `<p class="fib-note bad-text">${esc(t("practice.rightWas", { a: q.answer }))}</p>` : ""}
        </div>`;
      }).join("")}
      ${answered.length === ps.blanks.length ? `<div class="practice-done"><b>${esc(t("practice.fibDone", { a: right, b: ps.blanks.length }))}</b><button class="btn primary sm" data-act="pnew">${icon("refresh")} ${esc(t("practice.newSet"))}</button></div>` : ""}
    </div>` : "";
    const np = ps.pairs.length;
    const cls = (side, k) => {
      const sel = side === 0 ? ps.selL === k : ps.selR === k;
      return ps.matched.has(k) ? " matched" : sel ? " selected" + (ps.wrong ? " wrong" : "") : "";
    };
    const match = np >= 3 ? `<div class="practice-block">
      <span class="tip-label">${esc(t("practice.matchHead", { a: ps.matched.size, b: np }))}</span>
      <p class="panel-sub">${esc(t("practice.matchHelp"))}</p>
      <div class="match-grid">
        <div class="match-col">${ps.pairs.map((x, k) => `<button class="match-btn${cls(0, k)}" data-act="ml" data-k="${k}" ${ps.matched.has(k) ? "disabled" : ""}>${esc(x.en)}</button>`).join("")}</div>
        <div class="match-col">${ps.right.map((k) => `<button class="match-btn${cls(1, k)}" data-act="mr" data-k="${k}" ${ps.matched.has(k) ? "disabled" : ""}>${esc(ps.pairs[k].tr)}</button>`).join("")}</div>
      </div>
      ${ps.matched.size === np ? `<div class="practice-done"><b>${esc(t("practice.matchDone"))}</b><button class="btn primary sm" data-act="pnew">${icon("refresh")} ${esc(t("practice.newSet"))}</button></div>` : ""}
    </div>` : "";
    return `<div class="practice-header">
        <p class="panel-sub">${esc(d.review ? t("practice.fromWeek", { n: wordItems.length }) : t("practice.fromDay", { n: wordItems.length }))}</p>
        <button class="btn ghost sm" data-act="pnew">${icon("refresh")} ${esc(t("practice.newSet"))}</button>
      </div>${fib}${match}`;
  }

  // ---------------------------------------------------------------- dialogue
  function dialogueHtml() {
    const lines = d.dialogue, first = lines[0] && lines[0].who, voiceOf = voicesFor(lines), tr = showTr();
    return `<p class="panel-sub">${esc(t("dlg.help"))}</p>
      <div class="dlg-actions">
        <button class="btn primary" data-act="dplay">${icon("play")} ${esc(t("dlg.playAll"))}</button>
        <button class="btn ghost" data-act="torp">${icon("mic")} ${esc(t("dlg.youTry"))}</button>
      </div>
      <div class="dlg">${lines.map((l, i) => `
        <div class="dlg-msg ${l.who === first ? "a" : "b"}" data-line="${i}">
          <span class="dlg-who">${esc(l.who)}</span>
          <div class="dlg-line"><p class="dlg-en">${esc(l.en)}</p>${sayBtn(l.en, { gender: voiceOf(l.who) })}</div>
          ${tr ? `<p class="dlg-uz">${esc(l[L] || l.uz)}</p>` : ""}
        </div>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- role-play
  function rpFresh(role) {
    return { phase: "intro", src: convs[0] ? convs[0].n : null, role: role || null, hide: false, mode: "mic", note: "", idx: 0, messages: [], results: [],
      status: "idle", typing: false, speakingIdx: null, attempts: 0, best: null, feedback: null, live: "", revealed: false, summary: null, rec: null, run: null };
  }
  const rpConv = () => convs.find((c) => c.n === rp.src) || convs[0] || null;
  const rpLines = () => (rpConv() ? rpConv().lines : []);
  function rpReset(role) { rpEndRec(); stop(); const keep = { src: rp.src, hide: rp.hide }; rp = { ...rpFresh(role), ...keep }; }

  function rpHtml() {
    const dl = rpLines();
    if (!dl.length) return `<p class="panel-sub">${esc(t("rp.none"))}</p>`;
    const people = speakers(dl);
    if (!rp.role || !people.includes(rp.role)) rp.role = defaultSpeaker(dl);
    if (rp.phase === "intro") {
      const prev = state.progress.quiz["rp:" + n];
      return `<div class="rp rp-intro">
        <p class="panel-sub">${esc(t("rp.intro"))}</p>
        ${convs.length > 1 ? `<div><p class="speak-target-label">${esc(t("rp.chooseConv"))}</p>
          <select class="select" data-rpsrc aria-label="${esc(t("rp.chooseConv"))}">${convs.map((c) => `<option value="${c.n}" ${c.n === rp.src ? "selected" : ""}>${esc(t("lesson.title", { n: dayLabel(cat, c.n), title: titleParts(c.title).main }))}</option>`).join("")}</select></div>` : ""}
        <div><p class="speak-target-label">${esc(t("rp.youPlay"))}</p>
          <div class="rp-roles">${people.map((w, i) => `<button class="rp-role${w === rp.role ? " active" : ""}" data-act="rprole" data-w="${i}" aria-pressed="${w === rp.role}">${esc(w)}</button>`).join("")}</div></div>
        <div class="rp-options"><label class="rp-check"><input type="checkbox" data-rphide ${rp.hide ? "checked" : ""}> ${esc(t("rp.challenge"))}</label></div>
        <div class="rp-mic-note">${hasSpeech() ? `${icon("mic")} ${esc(t("rp.micNote"))}` : esc(t("rp.noSpeech"))}</div>
        <button class="btn primary lg" style="align-self:flex-start" data-act="rpstart">${icon("play")} ${esc(t("rp.start"))}</button>
        ${prev ? `<p class="hint">${esc(t("rp.best", { n: prev.best }))}</p>` : ""}
      </div>`;
    }
    const voiceOf = voicesFor(dl), total = dl.length, tr = showTr();
    const myTurn = rp.phase === "play" && rp.status !== "partner" && rp.idx < total && dl[rp.idx].who === rp.role;
    const pct = Math.round((Math.min(rp.idx, total) / total) * 100);
    const chat = rp.messages.map((m, i) => `<div class="rp-msg ${m.mine ? "me" : "them"}${rp.speakingIdx === i ? " speaking" : ""}">
        <span class="rp-who">${esc(m.who)}${m.mine ? esc(t("rp.you")) : ""}</span>
        <div class="rp-line"><p>${esc(m.en)}</p>${sayBtn(m.en, { gender: voiceOf(m.who) })}</div>
        ${tr && m.tr ? `<p class="rp-uz">${esc(m.tr)}</p>` : ""}
        ${m.mine && m.score != null ? `<span class="rp-score-chip">${m.score}%</span>` : ""}
      </div>`).join("") + (rp.typing ? `<div class="rp-typing" role="img" aria-label="${esc(t("rp.typing"))}"><i></i><i></i><i></i></div>` : "");
    let turn = "";
    if (myTurn) {
      const line = dl[rp.idx], fb = rp.feedback;
      const hidden = rp.hide && !fb && !rp.revealed;
      const words = fb ? fb.words.map((k) => `<span class="w ${k.ok ? "ok" : "miss"}">${esc(k.w)}</span>`).join(" ") : esc(line.en);
      const listening = rp.status === "listening";
      turn = `<div class="rp-turn" id="rpTurn">
        <span class="rp-turn-label">${esc(t("rp.yourTurnRole", { role: rp.role.toUpperCase() }))}</span>
        <p class="rp-say${hidden ? " hidden-text" : ""}"${hidden ? ` data-act="rpreveal"` : ""}>${words}</p>
        ${tr ? `<p class="rp-say-uz">${esc(line[L] || line.uz || "")}</p>` : ""}
        ${rp.hide && !fb ? `<button class="btn ghost sm" style="align-self:flex-start" data-act="rpreveal">${esc(hidden ? t("rp.showLine") : t("rp.hideLine"))}</button>` : ""}
        ${rp.note ? `<div class="rp-mic-note">${esc(rp.note)}</div>` : ""}
        <p class="rp-live" aria-live="polite" id="rpLive">${listening ? esc(rp.live ? "“" + rp.live + "”" : t("rp.listening")) : esc(rp.live || "")}</p>
        ${fb ? rpFeedbackHtml(fb) : `<div class="rp-turn-actions">
          <button class="btn ghost" data-act="rphear">${icon("volume")} ${esc(t("rp.hear"))}</button>
          ${rp.mode === "mic"
            ? `<button class="rp-mic${listening ? " listening" : ""}" data-act="rpmic" aria-label="${esc(listening ? t("rp.stopListening") : t("rp.tapSpeak"))}">${icon("mic")}</button><span class="rp-mic-hint">${esc(listening ? t("rp.tapStop") : t("rp.tapMic"))}</span>`
            : `<button class="btn primary" data-act="rpsaid">${esc(t("rp.saidIt"))} ${icon("arrowR")}</button>`}
        </div>`}
      </div>`;
    }
    let summary = "";
    if (rp.phase === "done") {
      const avg = rp.summary && rp.summary.avg;
      summary = `<div class="rp-summary">
        <span class="tip-label">${esc(t("rp.complete"))}</span>
        <div class="rp-summary-score">${avg != null ? avg + "%" : esc(t("rp.doneShort"))}</div>
        <p class="panel-sub">${esc(avg == null ? t("rp.doneNoMic") : avg >= 85 ? t("rp.done85") : avg >= RP_PASS ? t("rp.done70") : t("rp.doneLow"))}</p>
        ${rp.results.length ? `<div class="rp-summary-lines">${rp.results.map((r) => `<div class="rp-summary-line"><span>${esc(r.en)}</span><span>${r.score != null ? r.score + "%" : "—"}</span></div>`).join("")}</div>` : ""}
        <div class="rp-fb-actions" style="justify-content:center">
          <button class="btn primary" data-act="rpagain">${icon("refresh")} ${esc(t("rp.again"))}</button>
          <button class="btn ghost" data-act="rpswitch">${esc(t("rp.switch"))}</button>
        </div>
      </div>`;
    }
    return `<div class="rp">
      <div class="rp-progress">
        <div class="progressbar"><div class="progressbar-fill" style="width:${rp.phase === "done" ? 100 : pct}%"></div></div>
        <span class="rp-progress-label">${esc(t("rp.youAre", { role: rp.role }))}</span>
        <button class="btn ghost sm" data-act="rpquit">${esc(t("rp.end"))}</button>
      </div>
      <div class="rp-chat" aria-live="polite">${chat}</div>
      ${turn}${summary}
    </div>`;
  }

  function rpFeedbackHtml(fb) {
    const good = fb.score >= RP_PASS;
    const cls = good ? "good" : fb.score >= 50 ? "okay" : "low";
    const title = fb.score >= 90 ? t("rp.fbExcellent") : good ? t("rp.fbGood") : fb.score >= 50 ? t("rp.fbAlmost") : t("rp.fbAgain");
    return `<div class="rp-feedback ${cls}">
      <p class="rp-fb-title">${esc(title)} <span class="mono">${fb.score}%</span></p>
      <p class="rp-heard">${esc(t("rp.youSaid"))} <b>“${esc(fb.heard)}”</b></p>
      ${fb.words.some((k) => !k.ok) ? `<p class="rp-heard">${esc(t("rp.greenRed"))}</p>` : ""}
      ${!good && rp.attempts >= 2 ? `<p class="rp-heard">${esc(t("rp.tipSlow"))}</p>` : ""}
      <div class="rp-fb-actions">${good
        ? `<button class="btn primary" data-act="rpnext">${esc(t("continue"))} ${icon("arrowR")}</button><button class="btn ghost" data-act="rpretry">${esc(t("retry"))}</button>`
        : `<button class="btn primary" data-act="rpretry">${icon("mic")} ${esc(t("retry"))}</button><button class="btn ghost" data-act="rpnext">${esc(t("rp.continueAnyway"))}</button>`}</div>
    </div>`;
  }

  function rpEndRec() { if (rp.rec) { const r = rp.rec; rp.rec = null; try { r.abort(); } catch { /* ignore */ } } }

  async function rpStart() {
    unlockSpeech();
    const btn = root.querySelector('[data-act="rpstart"]');
    if (btn) btn.disabled = true;
    let mode = "mic", note = "";
    if (!hasSpeech()) mode = "self";
    else {
      const r = await ensureMic();
      if (!r.ok) { mode = "self"; note = t(r.reason === "denied" ? "rp.micDenied" : r.reason === "nomic" ? "rp.micNone" : "rp.micFail"); }
    }
    if (!root.isConnected) return;
    const keep = { src: rp.src, hide: rp.hide, role: rp.role };
    rp = { ...rpFresh(), ...keep, phase: "play", mode, note };
    paintPart("roleplay");
    rpAdvance();
  }

  /** Walks the script: the app says the other person's lines (with a moment of "typing" first), and stops at each of yours. */
  async function rpAdvance() {
    const live = (rp.run = newRun());
    const dl = rpLines(), voiceOf = voicesFor(dl);
    while (rp.idx < dl.length) {
      const line = dl[rp.idx];
      if (line.who === rp.role) {
        Object.assign(rp, { status: "idle", attempts: 0, best: null, feedback: null, live: "", typing: false, speakingIdx: null, revealed: false });
        paintPart("roleplay");
        return;
      }
      rp.status = "partner"; rp.typing = true; paintPart("roleplay");
      if (!(await pause(450)) || !live()) return;
      rp.typing = false;
      rp.messages.push({ who: line.who, en: line.en, tr: line[L] || line.uz, mine: false });
      rp.idx++;
      rp.speakingIdx = rp.messages.length - 1;
      paintPart("roleplay");
      await play(line.en, { gender: voiceOf(line.who) });
      if (!live()) return;
      rp.speakingIdx = null;
      if (!(await pause(250)) || !live()) return;
    }
    const scored = rp.results.filter((r) => r.score != null);
    const avg = scored.length ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length) : null;
    rp.summary = { avg };
    Object.assign(rp, { phase: "done", status: "idle", typing: false, speakingIdx: null });
    const key = "rp:" + n, prev = state.progress.quiz[key];
    if (!prev) addXp(15);
    if (avg != null && (!prev || avg > prev.best)) update((p) => { p.quiz[key] = { best: avg, total: 100, at: Date.now() }; });
    markPart("dialogue");
    paintPart("roleplay");
  }

  function rpAccept(score) {
    const line = rpLines()[rp.idx];
    if (!line) return;
    rpEndRec();
    rp.messages.push({ who: rp.role, en: line.en, tr: line[L] || line.uz, mine: true, score });
    rp.results.push({ en: line.en, score });
    if (score != null && score >= RP_PASS) addXp(1);
    Object.assign(rp, { idx: rp.idx + 1, feedback: null, revealed: false, live: "" });
    rpAdvance();
  }

  function rpListen() {
    if (rp.status === "listening") { if (rp.rec) { try { rp.rec.stop(); } catch { /* ignore */ } } return; }
    stop();
    const line = rpLines()[rp.idx];
    let heard = "", alts = [], err = null;
    const rec = recognizer({
      onText: (s, fin, al) => { heard = s; if (al && al.length) alts = al; rp.live = s; const el = root.querySelector("#rpLive"); if (el) el.textContent = "“" + s + "”"; },
      onError: (e) => { err = e; },
      onEnd: () => {
        if (rp.rec !== rec) return;
        rp.rec = null; rp.status = "idle";
        if (!heard) {
          if (err === "not-allowed" || err === "service-not-allowed") { rp.mode = "self"; rp.note = t("rp.blocked"); rp.live = ""; }
          else if (err === "audio-capture") rp.live = t("rp.micNone");
          else if (err === "network") rp.live = t("rp.needNet");
          else if (err === "aborted") rp.live = "";
          else rp.live = t("rp.noHear");
          paintPart("roleplay", true);
          return;
        }
        let best = null;
        for (const s of alts.length ? alts : [heard]) { const r = compareSpeech(line.en, s); if (!best || r.score > best.score) best = { ...r, heard: s }; }
        rp.attempts++;
        rp.best = Math.max(rp.best || 0, best.score);
        rp.feedback = best; rp.live = "";
        paintPart("roleplay");
      },
    });
    if (!rec) { rp.mode = "self"; paintPart("roleplay", true); return; }
    rp.rec = rec; rp.status = "listening"; rp.live = ""; rp.feedback = null;
    paintPart("roleplay", true);
    try { rec.start(); } catch { rp.rec = null; rp.status = "idle"; paintPart("roleplay", true); }
  }

  // ---------------------------------------------------------------- speaking (checked by the AI teacher)
  function speakHtml() {
    const r = speak.result, tr = showTr();
    return `<div class="speak-panel">
      <span class="tip-label">${esc(t("speak.head"))}</span>
      <p class="speak-prompt-en">${esc(d.speak.en)}</p>
      ${tr && pick(d.speak) !== d.speak.en ? `<p class="speak-prompt-uz">${esc(pick(d.speak))}</p>` : ""}
      <div class="speak-box">
        <div class="rp-turn-actions">
          ${hasSpeech() ? `<button class="rp-mic${speak.listening ? " listening" : ""}" data-act="smic" aria-label="${esc(speak.listening ? t("rp.stopListening") : t("rp.tapSpeak"))}">${icon("mic")}</button>
            <span class="rp-mic-hint">${esc(speak.listening ? t("rp.tapStop") : t("speak.tapMic"))}</span>` : `<p class="hint">${esc(t("speak.noMic"))}</p>`}
        </div>
        <textarea class="input" id="speakText" rows="3" placeholder="${esc(t("speak.placeholder"))}" aria-label="${esc(t("speak.head"))}"></textarea>
        <div class="row wrap-row">
          <button class="btn primary" data-act="aicheck" ${speak.busy ? "disabled" : ""}>${icon("talk")} ${esc(speak.busy ? t("talk.thinking") : t("speak.check"))}</button>
          <button class="btn ghost" data-act="sdone">${icon("check")} ${esc(t("speak.didIt"))}</button>
        </div>
        ${r ? tutorResult(r) : ""}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- grammar
  function grammarHtml() {
    const en = lang() === "en";
    const main = en ? { title: d.tip.title.en, text: d.tip.text.en } : { title: pick(d.tip.title), text: pick(d.tip.text) };
    const other = en ? { title: pick(d.tip.title), text: pick(d.tip.text), label: "Oʻzbekcha" } : { title: d.tip.title.en, text: d.tip.text.en, label: "English" };
    const unit = d.grammarId && cat.grammar.find((g) => g.id === d.grammarId);
    return `<p class="panel-sub">${esc(t("grammar.todayTip"))}</p>
      <h3 style="margin-top:6px">${esc(main.title)}</h3>
      <p class="grammar-explain">${esc(main.text)}</p>
      ${other.text && other.text !== main.text ? `<details class="grammar-en"><summary>${esc(other.label)}</summary><p style="margin:8px 0 0"><b>${esc(other.title)}</b> ${esc(other.text)}</p></details>` : ""}
      ${unit ? `<div class="setting-row btnrow" style="margin-top:18px">
        <div><h3>${esc(t("grammar.deeper"))}</h3><p class="panel-sub">${esc(t("grammar.deeperSub"))}</p></div>
        <a class="btn primary sm" href="/app/grammar/${esc(unit.id)}" data-link>${esc(titleParts(unit.title).main)} ${icon("chevron")}</a>
      </div>` : ""}`;
  }

  // ---------------------------------------------------------------- quiz
  function questions() {
    return [...d.quiz.map((q) => ({ kind: "core", ...q })), ...quiz.vocab];
  }
  function questionText(q) {
    if (q.kind === "core") return { text: q.q.en, tr: q.q[L] && q.q[L] !== q.q.en ? q.q[L] : "" };
    if (q.kind === "meaning") return { text: t("quiz.qMeaning", { w: q.en }), tr: "" };
    if (q.kind === "reverse") return { text: t("quiz.qReverse", { w: q.tr }), tr: "" };
    return { text: t("quiz.qListen"), tr: "" };
  }
  function quizHtml() {
    const qs = questions(), r = quiz.result, tr = showTr();
    const right = (i) => (r ? r.results[i] && r.results[i].answer : null);
    return `<p class="panel-sub">${esc(t(d.review ? "quiz.introReview" : "quiz.introDay", { n: qs.length }))}</p>
      <form id="quizForm" class="quiz-form" novalidate>
        ${qs.map((q, i) => {
          const txt = questionText(q), mine = quiz.answers[i];
          return `<fieldset class="quiz-q" id="qq-${i}">
            <legend>${i + 1}. ${esc(txt.text)}${q.kind !== "core" ? `<span class="q-kind">${esc(t("quiz.kind." + q.kind))}</span>` : ""}${tr && txt.tr ? `<span class="q-tr">${esc(txt.tr)}</span>` : ""}</legend>
            ${q.kind === "listen" ? `<div class="q-listen">${sayBtn(q.en)}<span class="hint">${esc(t("quiz.tapListen"))}</span></div>` : ""}
            <div class="quiz-opts">${q.opts.map((o, j) => {
              const cls = r ? (j === right(i) ? " right" : j === mine ? " wrong" : "") : "";
              return `<label class="quiz-opt${cls}"><input type="radio" name="q${i}" value="${j}" ${mine === j ? "checked" : ""} ${r || quiz.busy ? "disabled" : ""}><span>${esc(o)}</span></label>`;
            }).join("")}</div>
            ${r ? `<p class="quiz-feedback ${r.results[i].correct ? "correct" : "incorrect"}">${esc(r.results[i].correct ? t("quiz.correct") : t("quiz.correctWas", { a: q.opts[right(i)] }))}</p>` : ""}
          </fieldset>`;
        }).join("")}
        ${r ? quizResultHtml(r) : `<button type="submit" class="btn primary block" ${quiz.busy ? "disabled" : ""}>${esc(quiz.busy ? t("quiz.checking") : t("quiz.submit"))}</button>`}
      </form>`;
  }
  function quizResultHtml(r) {
    const left = TABS.filter((x) => !stepDone(x.step));
    return `<div class="quiz-result" id="quizResult">
        <div><strong>${esc(t("quiz.scorePct", { n: r.pct }))}</strong> — ${esc(r.pct >= 80 ? t("quiz.great") : r.pct >= 50 ? t("quiz.ok") : t("quiz.low"))}</div>
        <div class="progressbar"><div class="progressbar-fill" style="width:${r.pct}%"></div></div>
        <div class="quiz-actions">
          <button type="button" class="btn ghost" data-act="qretake">${icon("refresh")} ${esc(t("quiz.retake"))}</button>
          ${!d.review && d.words.length ? `<a class="btn ghost" href="/app/homework/${n}" data-link>${icon("homework")} ${esc(t("lesson.doHomework"))}</a>` : ""}
        </div>
      </div>
      ${left.length && !dayDone() ? `<div class="parts-left"><p>${esc(t("lesson.partsLeft"))}</p><div class="row">${left.map((x) => `<button type="button" class="btn sm" data-act="tab" data-t="${x.id}">${icon(x.ic)} ${esc(t(x.label))}</button>`).join("")}</div></div>` : ""}`;
  }

  async function submitQuiz() {
    if (quiz.result || quiz.busy) return;
    const qs = questions();
    const missing = qs.findIndex((_, i) => quiz.answers[i] == null);
    if (missing >= 0) {
      toast(t("quiz.answerAll"));
      const el = root.querySelector("#qq-" + missing);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    quiz.busy = true; paintPart("quiz", true);
    try {
      const core = d.quiz.length ? await api("quiz", { method: "POST", body: { kind: "day", id: n, answers: d.quiz.map((_, i) => quiz.answers[i]) } }) : { score: 0, total: 0, results: [] };
      const off = d.quiz.length;
      const vres = quiz.vocab.map((q, k) => ({ correct: quiz.answers[off + k] === q.a, answer: q.a }));
      const score = core.score + vres.filter((x) => x.correct).length, total = core.total + vres.length;
      quiz.result = { score, total, pct: Math.round((score / total) * 100), results: [...core.results, ...vres] };
      const key = "day:" + n, prev = state.progress.quiz[key];
      const prevPct = pctOf(prev) || 0;
      if (!prev || quiz.result.pct > prevPct) update((p) => { p.quiz[key] = { best: score, total, at: Date.now() }; });
      const gain = Math.round((Math.max(0, quiz.result.pct - prevPct) / 100) * 20);
      if (gain) addXp(gain);
      // words answered wrong come back soon in Review
      const missed = quiz.vocab.filter((q, k) => !vres[k].correct).map((q) => q.id).filter(Boolean);
      if (missed.length) update((p) => { const now = Date.now(); for (const id of missed) p.srs[id] = p.srs[id] ? reviewCard(p.srs[id], false, now) : { b: 0, due: now, u: now }; });
      quiz.busy = false;
      markPart("quiz");
      if (!completeIfReady()) {
        paint();
        requestAnimationFrame(() => { const el = root.querySelector("#quizResult"); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); });
      }
    } catch (e) {
      quiz.busy = false;
      toast(e.code === "network" ? t("error.network") : t("error.generic"), "bad");
      paintPart("quiz", true);
    }
  }

  // ---------------------------------------------------------------- marking parts done, finishing the day
  function markPart(step) {
    const first = !stepDone(step);
    markStep(n, step);
    if (first && STEP_XP[step]) addXp(STEP_XP[step]);
    if (step === "words" && !d.review && first) addCards(d.words.map((w) => w.id));
    if (first) paintChrome();
  }
  function completeIfReady() {
    if (dayDone() || !TABS.every((x) => stepDone(x.step))) return false;
    markDayDone(n);
    addXp(20);
    paint();
    celebrate();
    return true;
  }
  function celebrate() {
    const xp = TABS.reduce((s, x) => s + (STEP_XP[x.step] || 0), 20);
    const score = pctOf(state.progress.quiz["day:" + n]);
    const certReady = !!d.final && certificateStatus(cat, state.progress).ready;
    const hw = !d.review && d.words.length;
    const bits = Array.from({ length: 28 }, (_, i) => `<i style="--x:${(i * 37 + 5) % 100}%;--d:${((i % 9) * 0.11).toFixed(2)}s;--c:${CONFETTI[i % CONFETTI.length]};--r:${(i * 47) % 360}deg"></i>`).join("");
    const nextBtn = nextDay ? (isLocked(nextDay, a)
      ? `<a class="btn block" href="/app/pricing" data-link data-close>${icon("lock")} ${esc(t("lesson.dayLocked", { n: dayLabel(cat, nextDay.n) }))}</a>`
      : `<a class="btn ${certReady || hw ? "" : "primary"} block" href="/app/day/${nextDay.n}" data-link data-close>${esc(t("lesson.nextDayN", { n: dayLabel(cat, nextDay.n) }))} ${icon("arrowR")}</a>`) : "";
    const m = modal(`<div class="confetti" aria-hidden="true">${bits}</div>
      <div class="center stack party-in">
        <div class="done-ic">${icon("trophy")}</div>
        <h2 style="margin:0">${esc(t("lesson.dayDone"))}</h2>
        <p class="muted" style="margin:0">${esc(t("lesson.title", { n: label, title: tp.main }))}</p>
        <div class="done-stats">
          <div><b>+${xp}</b><span>XP</span></div>
          <div><b>${streak(state.progress)}</b><span>${esc(t("stat.streak"))}</span></div>
          ${score != null ? `<div><b>${score}%</b><span>${esc(t("tab.quiz"))}</span></div>` : ""}
        </div>
        <div class="stack">
          ${certReady ? `<a class="btn primary block" href="/app/certificate" data-link data-close>${icon("award")} ${esc(t("cert.open"))}</a>` : ""}
          ${hw ? `<a class="btn ${certReady ? "" : "primary"} block" href="/app/homework/${n}" data-link data-close>${icon("homework")} ${esc(t("lesson.doHomework"))}</a>` : ""}
          ${nextBtn}
          <a class="btn ghost block" href="/app/course/${row.week}" data-link data-close>${esc(t("lesson.toWeek"))}</a>
        </div>
      </div>
      <button class="modal-x" data-close aria-label="${esc(t("close"))}">${icon("x")}</button>`);
    m.el.classList.add("party");
  }

  function switchTab(id, toTop) {
    const x = TABS.find((y) => y.id === id);
    if (!x) return;
    if (rp.phase !== "intro") rpReset(rp.role);
    stopSpeak();
    stop();
    cur = x;
    try { history.replaceState(history.state, "", location.pathname + "?tab=" + x.id); } catch { /* ignore */ }
    paint();
    if (toTop) window.scrollTo({ top: 0, behavior: "smooth" });
    else {
      const tb = root.querySelector(".ltabs");
      if (tb && tb.getBoundingClientRect().top < 60) tb.scrollIntoView({ block: "start" });
    }
  }
  function stopSpeak() { if (speak.rec) { try { speak.rec.abort(); } catch { /* ignore */ } speak.rec = null; } speak.listening = false; }

  // ---------------------------------------------------------------- events
  paint();
  const off = onAct(root, {
    tab: (el) => switchTab(el.dataset.t, false),
    nextpart: () => {
      const i = TABS.indexOf(cur);
      markPart(cur.step);
      if (completeIfReady()) return;
      if (TABS[i + 1]) switchTab(TABS[i + 1].id, true);
    },
    locked: () => showLock(),
    // words
    wmode: (el) => { wordsMode = el.dataset.m === "list" ? "list" : "cards"; paintPart("vocab"); },
    flip: (el) => {
      const i = Number(el.dataset.i), on = !flipped.has(i);
      if (on) flipped.add(i); else flipped.delete(i);
      el.closest(".flashcard").classList.toggle("flipped", on);
      el.setAttribute("aria-pressed", String(on));
    },
    wplay: () => {
      const items = () => [...root.querySelectorAll(".flashcard[data-i], .transcript-line[data-i]")];
      playAll(d.words.map((w) => ({ text: w.en })), (i) => {
        items().forEach((c) => c.classList.toggle("now", Number(c.dataset.i) === i));
        const c = items().find((x) => Number(x.dataset.i) === i);
        if (c) c.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },
    // practice
    pnew: () => { ps = newPractice(); paintPart("practice"); },
    fib: (el) => {
      const q = ps.blanks[Number(el.dataset.q)];
      if (!q || q.pick !== null) return;
      q.pick = Number(el.dataset.o);
      if (q.pick === q.a) addXp(2);
      paintPart("practice");
      play(q.before + q.answer + q.after);
    },
    ml: (el) => { const k = Number(el.dataset.k); if (ps.matched.has(k) || ps.wrong) return; ps.selL = k; play(ps.pairs[k].en); tryMatch(); },
    mr: (el) => { const k = Number(el.dataset.k); if (ps.matched.has(k) || ps.wrong) return; ps.selR = k; tryMatch(); },
    // dialogue
    dplay: () => {
      if (rp.phase !== "intro") { rpReset(rp.role); paintPart("roleplay"); }
      const voiceOf = voicesFor(d.dialogue);
      const lines = () => [...root.querySelectorAll(".dlg-msg")];
      playAll(d.dialogue.map((l) => ({ text: l.en, gender: voiceOf(l.who) })), (i) => {
        lines().forEach((el, k) => el.classList.toggle("now", k === i));
        if (i >= 0 && lines()[i]) lines()[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    torp: () => { const s = root.querySelector("#sec-roleplay"); if (s) s.scrollIntoView({ block: "start", behavior: "smooth" }); },
    // role-play
    rprole: (el) => { const people = speakers(rpLines()); rp.role = people[Number(el.dataset.w)] || rp.role; paintPart("roleplay", true); },
    rpstart: () => rpStart(),
    rpquit: () => { rpReset(rp.role); paintPart("roleplay", true); },
    rpagain: () => { rpReset(rp.role); rpStart(); },
    rpswitch: () => { const other = speakers(rpLines()).find((w) => w !== rp.role); rpReset(other || rp.role); rpStart(); },
    rphear: () => { const line = rpLines()[rp.idx]; if (line) play(line.en, { gender: voicesFor(rpLines())(line.who) }); },
    rpreveal: () => { rp.revealed = !rp.revealed; paintPart("roleplay", true); },
    rpmic: () => rpListen(),
    rpsaid: () => rpAccept(null),
    rpretry: () => { rp.feedback = null; rp.live = ""; paintPart("roleplay", true); },
    rpnext: () => rpAccept(rp.best),
    // speaking
    smic: () => {
      if (speak.listening && speak.rec) { try { speak.rec.stop(); } catch { /* ignore */ } return; }
      stop();
      const rec = recognizer({
        onText: (s) => { speak.text = s; const ta = root.querySelector("#speakText"); if (ta) ta.value = s; },
        onEnd: () => { if (speak.rec !== rec) return; speak.rec = null; speak.listening = false; paintPart("speak"); },
      });
      if (!rec) { toast(t("speak.noMic")); return; }
      speak.rec = rec; speak.listening = true; paintPart("speak");
      try { rec.start(); } catch { speak.rec = null; speak.listening = false; paintPart("speak"); }
    },
    aicheck: async () => {
      const text = ((root.querySelector("#speakText") || {}).value || speak.text || "").trim();
      if (!text) { toast(t("speak.writeFirst")); return; }
      if (!state.me.access.signedIn) { toast(t("teacher.signin")); go("/app/signin?next=" + encodeURIComponent(location.pathname)); return; }
      speak.text = text; speak.busy = true; paintPart("speak");
      try { speak.result = await api("ai", { method: "POST", body: { action: "check", text, day: n, lang: L } }); markPart("speak"); }
      catch (e) { speak.result = { error: e.code }; }
      speak.busy = false; paintPart("speak");
    },
    sdone: () => { markPart("speak"); toast(t("speak.saved"), "ok"); },
    // quiz
    qretake: () => { quiz = newQuiz(); paintPart("quiz", true); const f = root.querySelector("#sec-quiz"); if (f) f.scrollIntoView({ block: "start", behavior: "smooth" }); },
  });
  const onChange = (e) => {
    const el = e.target;
    if (el.matches('#quizForm input[type="radio"]')) { if (!quiz.result) quiz.answers[Number(el.name.slice(1))] = Number(el.value); }
    else if (el.matches("[data-rphide]")) rp.hide = el.checked;
    else if (el.matches("[data-rpsrc]")) { rp.src = Number(el.value); rp.role = null; paintPart("roleplay", true); }
  };
  const onInput = (e) => { if (e.target.id === "speakText") speak.text = e.target.value; };
  const onSubmit = (e) => { if (e.target.id === "quizForm") { e.preventDefault(); submitQuiz(); } };
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  root.addEventListener("submit", onSubmit);

  let matchTimer = 0;
  function tryMatch() {
    if (ps.selL === null || ps.selR === null) { paintPart("practice"); return; }
    if (ps.selL === ps.selR) {
      ps.matched.add(ps.selL); ps.selL = ps.selR = null; addXp(1);
      paintPart("practice");
      if (ps.matched.size === ps.pairs.length) toast(t("practice.matchDone"), "ok");
      return;
    }
    ps.wrong = true;
    paintPart("practice");
    clearTimeout(matchTimer);
    matchTimer = setTimeout(() => { ps.wrong = false; ps.selL = ps.selR = null; paintPart("practice"); }, 700);
  }

  return () => {
    off(); stop(); rpEndRec(); stopSpeak(); clearTimeout(matchTimer);
    root.removeEventListener("change", onChange); root.removeEventListener("input", onInput); root.removeEventListener("submit", onSubmit);
  };
}

/** Renders the AI teacher's answer (shared with the teacher screen). */
export function tutorResult(r) {
  if (r.error) {
    const msg = r.error === "daily-limit" ? t("teacher.limit") : r.error === "busy" || r.error === "upstream" ? t("teacher.busy") : r.error === "sign-in" ? t("teacher.signin") : t("error.generic");
    return `<div class="rp-mic-note" style="width:100%">${esc(msg)}</div>`;
  }
  if (r.answer) {
    return `<div class="rp-feedback" style="width:100%"><p style="margin:0">${esc(r.answer)}</p>${(r.examples || []).map((e) => `<div class="row">${sayBtn(e)}<span>${esc(e)}</span></div>`).join("")}</div>`;
  }
  const head = { correct: t("teacher.correct"), almost: t("teacher.almost"), wrong: t("teacher.wrong"), not_english: t("teacher.notEnglish") }[r.verdict] || "";
  const cls = r.verdict === "correct" ? "good" : r.verdict === "almost" ? "okay" : "low";
  return `<div class="rp-feedback ${cls}" style="width:100%">
    <p class="rp-fb-title">${esc(head)}</p>
    ${r.verdict !== "correct" && r.corrected ? `<div><div class="speak-target-label">${esc(t("teacher.corrected"))}</div><div class="row">${sayBtn(r.corrected)}<b>${esc(r.corrected)}</b></div></div>` : ""}
    ${r.better && r.better !== r.corrected ? `<div><div class="speak-target-label">${esc(t("teacher.better"))}</div><div class="row">${sayBtn(r.better)}<span>${esc(r.better)}</span></div></div>` : ""}
    ${r.explanation ? `<p class="rp-heard" style="color:var(--ink)">${esc(r.explanation)}</p>` : ""}
    ${typeof r.left === "number" ? `<p class="rp-heard">${esc(t("teacher.left", { n: r.left }))}</p>` : ""}
  </div>`;
}
