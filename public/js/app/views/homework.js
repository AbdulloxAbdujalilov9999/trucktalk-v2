/* Homework, as in the main TruckTalk app: the words to study and a quiz on them that completes the session.
 * Here a session is one lesson (the main app cut its glossary into blocks of 20 words), so a lesson links straight to its
 * homework and a locked lesson's homework is locked too. The quiz mixes "fill in the blank" in the example sentences
 * with three kinds of word questions; words answered wrong go back into Review. The search covers every word you can
 * open, plus the phrases of the 50 video lessons (it replaces the old phrasebook). */
import { t, trLang } from "../i18n.js";
import { esc, icon, onAct, spinner, errorBox, sayBtn, toast } from "../ui.js";
import { cachedGet } from "../api.js";
import { state, addXp, update, setting } from "../store.js";
import { catalog, videos, showLock, go } from "../main.js";
import { playAll, stop } from "../audio.js";
import { currentUser } from "../auth.js";
import { videoItems } from "../../shared/videos.js";
import { blankRound, vocabRound } from "../../shared/lesson.js";
import { shuffle } from "../../shared/drills.js";
import { review as reviewCard } from "../../shared/progress.js";
import { homeworkDays, homeworkStats, dayLabel, dayRow, titleParts, weekTitle, isLocked, pctOf, ring, lockedView } from "./common.js";

const QUIZ_MAX = 20;
const showTr = () => setting("showUz", true) !== false;
const uidNow = () => (currentUser() ? currentUser().uid : "anon");

export default async function homework(root, params) {
  if (params[0] != null) return session(root, Number(params[0]));
  return list(root);
}

/** A word row: the English with its sound, the translation and the example sentence. */
function wordLine(w, L, i) {
  const tr = showTr(), ex = w.ex && w.ex.en, exTr = w.ex && (w.ex[L] || w.ex.uz);
  return `<div class="transcript-line" data-i="${i}">
    <div class="line-text">
      <p class="line-en">${esc(w.en)}</p>
      ${tr ? `<p class="line-uz">${esc(w[L] || w.uz)}</p>` : ""}
      ${ex ? `<p class="line-ex">“${esc(ex)}”${tr && exTr ? ` <i>${esc(exTr)}</i>` : ""}</p>` : ""}
    </div>
    ${sayBtn(w.en)}
  </div>`;
}

// ---------------------------------------------------------------- the list: every session, by week, and the search
async function list(root) {
  root.innerHTML = spinner();
  const L = trLang();
  const [cat, vids, w] = await Promise.all([
    catalog(),
    videos().catch(() => []),
    cachedGet("content?kind=words", "words", { uid: uidNow() }).catch(() => ({ words: {} })),
  ]);
  const a = state.me.access;
  const days = homeworkDays(cat);
  const wordsOf = (n) => (w.words && w.words[n]) || null;
  const open = new Set();
  let q = "";

  // weeks in course order: the orientation (week 0) first
  const groups = [];
  for (const d of days) {
    let g = groups.find((x) => x.week === d.week);
    if (!g) groups.push((g = { week: d.week, days: [] }));
    g.days.push(d);
  }

  // what the search looks through: the words of every lesson you can open, then the video lessons' phrases
  const all = [];
  for (const d of days) {
    for (const x of wordsOf(d.n) || []) {
      all.push({ en: x.en, tr: x[L] || x.uz, ex: x.ex && x.ex.en, src: t("day", { n: dayLabel(cat, d.n) }), href: `/app/homework/${d.n}` });
    }
  }
  for (const v of vids) for (const it of videoItems(v)) all.push({ en: it.en, tr: it.uz, ex: "", src: t("lesson", { n: v.n }), href: `/app/videos/${v.n}` });
  const hay = all.map((x) => (x.en + " " + x.tr).toLowerCase());
  const courseWords = all.filter((x) => x.href.startsWith("/app/homework")).length;

  function itemHtml(d) {
    const n = d.n, label = dayLabel(cat, n), tp = titleParts(d.title);
    const locked = isLocked(d, a), res = state.progress.quiz["hw:" + n], score = pctOf(res);
    const words = wordsOf(n), expanded = open.has(n) && !locked && words;
    const body = expanded ? `<div class="accordion-body">
        <div class="practice-header">
          <p class="panel-sub">${esc(t("hw.inSession", { n: words.length }))}</p>
          <button class="btn ghost sm" data-act="hwplay" data-n="${n}">${icon("play")} ${esc(t("hw.playAll"))}</button>
        </div>
        <div class="transcript">${words.map((x, i) => wordLine(x, L, i)).join("")}</div>
        <div class="row wrap-row" style="margin-top:14px">
          <a class="btn primary" href="/app/homework/${n}" data-link>${esc(res ? t("hw.retake") : t("hw.take"))} ${icon("arrowR")}</a>
          <a class="btn ghost" href="/app/day/${n}" data-link>${esc(t("hw.openLesson"))}</a>
        </div>
      </div>` : "";
    return `<div class="accordion-item${expanded ? " open" : ""}" id="hw-${n}">
      <button class="accordion-header" ${locked ? `data-act="locked"` : `data-act="hwtoggle" data-n="${n}" aria-expanded="${!!expanded}"`}>
        <span class="accordion-lead">
          <span class="acc-badge${res ? " done" : ""}${locked ? " locked" : ""}">${res ? icon("check") : locked ? icon("lock") : esc(label)}</span>
          <span class="accordion-title"><span class="accordion-num">${esc(t("hw.sessionOf", { n: label }))}</span><span class="acc-range">${esc(tp.main)}</span></span>
        </span>
        <span class="accordion-right">
          ${res ? `<span class="badge ok">${icon("check")} ${score}%</span>` : `<span class="mono">${esc(t("hw.nWords", { n: d.words }))}</span>`}
          <span class="accordion-chevron">${icon(locked ? "lock" : "chevron")}</span>
        </span>
      </button>
      ${body}
    </div>`;
  }

  function groupsHtml() {
    return groups.map((g) => {
      const tp = titleParts(weekTitle(cat, g.week));
      const got = g.days.filter((d) => state.progress.quiz["hw:" + d.n]).length;
      return `<div class="hw-week" id="w${g.week}">
        <div class="hw-week-head">
          <div><p class="eyebrow">${esc(g.week === 0 ? t("lessons.orientationCaps") : t("lessons.weekCaps", { n: g.week }))}</p><h3>${esc(tp.main)}</h3></div>
          <span class="week-count">${got}/${g.days.length}</span>
        </div>
        <div class="accordion">${g.days.map(itemHtml).join("")}</div>
      </div>`;
    }).join("");
  }

  function hitsHtml() {
    const s = q.toLowerCase();
    const found = all.filter((_, i) => hay[i].includes(s));
    if (!found.length) return `<div class="empty">${icon("search")}<p>${esc(t("hw.none"))}</p></div>`;
    const tr = showTr();
    return `<p class="hint" style="margin-bottom:12px">${esc(t("hw.found", { n: found.length }))}</p>
      <div class="gloss-hits">${found.slice(0, 120).map((x) => `
        <div class="gloss-item">
          <div class="line-text">
            <div class="gloss-en">${esc(x.en)}</div>
            ${tr && x.tr ? `<div class="gloss-uz">${esc(x.tr)}</div>` : ""}
            ${x.ex ? `<div class="gloss-ex">“${esc(x.ex)}”</div>` : ""}
            <a class="gloss-daylink" href="${x.href}" data-link>${esc(x.src)}</a>
          </div>
          ${sayBtn(x.en)}
        </div>`).join("")}</div>`;
  }

  const bodyHtml = () => (q ? hitsHtml() : groupsHtml());

  function paint() {
    const hw = homeworkStats(cat, state.progress);
    const pct = hw.total ? Math.round((hw.done / hw.total) * 100) : 0;
    const cards = Object.keys(state.progress.srs).length;
    root.innerHTML = `
      <section class="hero-strip">
        <div class="hero-top">
          <div class="hero-left">
            <p class="eyebrow">${esc(t("hw.eyebrow"))}</p>
            <h1 class="hwy-title">${esc(t("hw.title"))}</h1>
            <p class="hero-sub">${esc(t("hw.sub"))}</p>
          </div>
          ${ring(pct, { label: t("hw.doneOf", { a: hw.done, b: hw.total }) })}
        </div>
        <div class="hero-stats">
          <div class="stat-tile"><span class="stat-ico">${icon("homework")}</span><span class="stat-num">${hw.done}<span class="stat-den">/${hw.total}</span></span><span class="stat-label">${esc(t("hw.sessionsDone"))}</span></div>
          <div class="stat-tile"><span class="stat-ico">${icon("target")}</span><span class="stat-num">${hw.done ? hw.avg + "%" : "—"}</span><span class="stat-label">${esc(t("hw.avgScore"))}</span></div>
          <a class="stat-tile" href="/app/review" data-link><span class="stat-ico">${icon("cards")}</span><span class="stat-num">${cards}</span><span class="stat-label">${esc(t("profile.cards"))}</span></a>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>${esc(t("hw.glossary"))}</h2>
          <p class="panel-sub">${esc(t("hw.glossarySub", { n: courseWords }))}</p>
        </div>
        <input class="search-input" id="hwq" type="search" placeholder="${esc(t("hw.search"))}" aria-label="${esc(t("hw.search"))}" autocomplete="off" value="${esc(q)}">
        <div class="progressbar" style="margin:14px 0 4px"${q ? " hidden" : ""}><div class="progressbar-fill" style="width:${pct}%"></div></div>
        <div id="hwBody">${bodyHtml()}</div>
      </section>`;
  }
  const paintBody = () => { const el = root.querySelector("#hwBody"); if (el) el.innerHTML = bodyHtml(); const bar = root.querySelector(".panel .progressbar"); if (bar) bar.hidden = !!q; };

  paint();
  // /app/homework#w3 (from a week's page) opens at that week; render() scrolls to the top first, so wait a moment
  const jump = /^#w(\d{1,2})$/.exec(location.hash);
  const jumpTimer = jump ? setTimeout(() => { const el = root.querySelector("#w" + jump[1]); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 80) : 0;

  const onInput = (e) => { if (e.target.id === "hwq") { q = e.target.value.trim(); paintBody(); } };
  root.addEventListener("input", onInput);
  const off = onAct(root, {
    locked: () => showLock(),
    hwtoggle: (el) => {
      const n = Number(el.dataset.n);
      if (open.has(n)) open.delete(n); else open.add(n);
      stop();
      const item = root.querySelector("#hw-" + n), d = days.find((x) => x.n === n);
      if (item && d) item.outerHTML = itemHtml(d);
    },
    hwplay: (el) => {
      const n = Number(el.dataset.n), words = wordsOf(n) || [];
      const lines = () => [...root.querySelectorAll(`#hw-${n} .transcript-line`)];
      playAll(words.map((x) => ({ text: x.en })), (i) => {
        lines().forEach((x) => x.classList.toggle("now", Number(x.dataset.i) === i));
        const c = lines().find((x) => Number(x.dataset.i) === i);
        if (c) c.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },
  });
  return () => { off(); stop(); clearTimeout(jumpTimer); root.removeEventListener("input", onInput); };
}

// ---------------------------------------------------------------- one session: the words, then the quiz
async function session(root, n) {
  const cat = await catalog();
  const row = dayRow(cat, n);
  if (!row || !(row.words > 0)) { go("/app/homework", { replace: true }); return; }
  const a = state.me.access;
  const label = dayLabel(cat, n), tp = titleParts(row.title);
  const lockTitle = `${t("nav.homework")} · ${t("day", { n: label })}`;
  if (isLocked(row, a)) return lockedView(root, lockTitle, "/app/homework");

  root.innerHTML = spinner();
  let data;
  try { data = await cachedGet(`content?kind=day&id=${n}`, "day:" + n, { uid: uidNow() }); }
  catch (e) {
    if (e.status === 401 || e.status === 402) return lockedView(root, lockTitle, "/app/homework");
    root.innerHTML = errorBox(e.code === "network" ? t("error.network") : t("error.generic"));
    return onAct(root, { retry: () => session(root, n) });
  }
  const d = data.item, L = trLang();
  const sessions = homeworkDays(cat);
  const at = sessions.findIndex((x) => x.n === n);
  const prev = sessions[at - 1] || null, next = sessions[at + 1] || null;
  const wordItems = d.words.map((w) => ({ id: w.id, en: w.en, tr: w[L] || w.uz }));
  const blankItems = d.words.map((w) => ({ id: w.id, en: w.en, ex: w.ex && w.ex.en, tr: w.ex && (w.ex[L] || w.ex.uz) }));
  let quiz = newQuiz();

  /** Up to 20 questions, each word once: four "fill in the blank" in the example sentences, the rest word questions. */
  function newQuiz() {
    const blanks = blankRound(blankItems, 4).map((x) => ({ ...x, kind: "blank" }));
    const used = new Set(blanks.map((x) => x.id));
    const vocab = vocabRound(wordItems.filter((w) => !used.has(w.id)), QUIZ_MAX - blanks.length);
    return { qs: shuffle([...blanks, ...vocab]), answers: {}, result: null };
  }

  function head() {
    const res = state.progress.quiz["hw:" + n];
    const pager = (x, dir) => {
      if (!x) return `<button class="btn ghost sm" disabled>${dir < 0 ? icon("arrowL") : ""}${esc(t(dir < 0 ? "prev" : "next"))}${dir > 0 ? icon("arrowR") : ""}</button>`;
      const txt = esc(t("day", { n: dayLabel(cat, x.n) }));
      return `<a class="btn ghost sm" href="/app/homework/${x.n}" ${isLocked(x, a) ? `data-act="locked"` : "data-link"}>${dir < 0 ? icon("arrowL") + " " + txt : txt + " " + icon("arrowR")}</a>`;
    };
    return `<section class="lesson-head">
      <div class="lesson-head-top">
        <a class="btn ghost sm" href="/app/homework#w${row.week}" data-link>${icon("arrowL")} ${esc(t("nav.homework"))}</a>
        <div class="lesson-pager">${pager(prev, -1)}${pager(next, 1)}</div>
      </div>
      <p class="eyebrow">${esc(t("hw.sessionEyebrow", { n: at + 1, total: sessions.length }))} · ${esc(t("day", { n: label }))}</p>
      <h1 class="hwy-title">${esc(t("hw.wordsToLearn", { n: d.words.length }))}</h1>
      <p class="lesson-title-uz">${esc(tp.main)}</p>
      <div class="lesson-badges">
        ${res ? `<span class="badge-complete">${icon("check")} ${esc(t("lesson.completedScore", { n: pctOf(res) }))}</span>` : `<span class="badge-time">${icon("clock")} ${esc(t("hw.studyThenQuiz"))}</span>`}
        ${data.offline ? `<span class="badge warn">${esc(t("offline.short"))}</span>` : ""}
      </div>
    </section>`;
  }

  function questionText(x) {
    if (x.kind === "meaning") return t("quiz.qMeaning", { w: x.en });
    if (x.kind === "reverse") return t("quiz.qReverse", { w: x.tr });
    if (x.kind === "listen") return t("quiz.qListen");
    return "";
  }

  function quizHtml() {
    const r = quiz.result, tr = showTr();
    return `<form id="hwForm" class="quiz-form" novalidate>
      ${quiz.qs.map((x, i) => {
        const mine = quiz.answers[i];
        const legend = x.kind === "blank"
          ? `${i + 1}. ${esc(x.before)}<span class="fib-blank">____</span>${esc(x.after)}<span class="q-kind">${esc(t("quiz.kind.blank"))}</span>${tr && x.tr ? `<span class="q-tr">${esc(x.tr)}</span>` : ""}`
          : `${i + 1}. ${esc(questionText(x))}<span class="q-kind">${esc(t("quiz.kind." + x.kind))}</span>`;
        return `<fieldset class="quiz-q" id="hq-${i}">
          <legend>${legend}</legend>
          ${x.kind === "listen" ? `<div class="q-listen">${sayBtn(x.en)}<span class="hint">${esc(t("quiz.tapListen"))}</span></div>` : ""}
          <div class="quiz-opts">${x.opts.map((o, j) => {
            const cls = r ? (j === x.a ? " right" : j === mine ? " wrong" : "") : "";
            return `<label class="quiz-opt${cls}"><input type="radio" name="h${i}" value="${j}" ${mine === j ? "checked" : ""} ${r ? "disabled" : ""}><span>${esc(o)}</span></label>`;
          }).join("")}</div>
          ${r ? `<p class="quiz-feedback ${mine === x.a ? "correct" : "incorrect"}">${esc(mine === x.a ? t("quiz.correct") : t("quiz.correctWas", { a: x.opts[x.a] }))}</p>` : ""}
        </fieldset>`;
      }).join("")}
      ${r ? resultHtml(r) : `<button type="submit" class="btn primary block">${esc(t("hw.submit"))}</button>`}
    </form>`;
  }

  function resultHtml(r) {
    const nextBtn = next ? (isLocked(next, a)
      ? `<button type="button" class="btn ghost" data-act="locked">${icon("lock")} ${esc(t("hw.nextSession"))}</button>`
      : `<a class="btn primary" href="/app/homework/${next.n}" data-link>${esc(t("hw.nextSession"))} ${icon("arrowR")}</a>`) : "";
    return `<div class="quiz-result" id="hwResult">
      <div><strong>${esc(t("quiz.scorePct", { n: r.pct }))}</strong> — ${esc(r.pct >= 70 ? t("hw.great") : t("hw.reviewMissed"))}</div>
      <div class="progressbar"><div class="progressbar-fill" style="width:${r.pct}%"></div></div>
      <div class="quiz-actions">
        ${nextBtn}
        <button type="button" class="btn ghost" data-act="qretake">${icon("refresh")} ${esc(t("quiz.retake"))}</button>
        ${r.missed ? `<a class="btn ghost" href="/app/review" data-link>${icon("cards")} ${esc(t("hw.reviewN", { n: r.missed }))}</a>` : ""}
      </div>
    </div>`;
  }

  function paint() {
    root.innerHTML = `${head()}
      <section class="panel">
        <div class="practice-header">
          <p class="panel-sub">${esc(t("hw.readThrough", { n: d.words.length }))}</p>
          <button class="btn primary sm" data-act="hwplay">${icon("play")} ${esc(t("hw.playAllWords"))}</button>
        </div>
        <div class="transcript">${d.words.map((w, i) => wordLine(w, L, i)).join("")}</div>
      </section>
      <section class="panel" id="hwQuiz">
        <div class="panel-head">
          <h2>${esc(t("hw.quizHead"))}</h2>
          <p class="panel-sub">${esc(t("hw.quizSub", { n: quiz.qs.length }))}</p>
        </div>
        <div id="hwQuizBody">${quizHtml()}</div>
      </section>`;
  }
  const paintQuiz = () => { const el = root.querySelector("#hwQuizBody"); if (el) el.innerHTML = quizHtml(); };

  function submit() {
    if (quiz.result) return;
    const missing = quiz.qs.findIndex((_, i) => quiz.answers[i] == null);
    if (missing >= 0) {
      toast(t("quiz.answerAll"));
      const el = root.querySelector("#hq-" + missing);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const right = quiz.qs.map((x, i) => quiz.answers[i] === x.a);
    const score = right.filter(Boolean).length, total = quiz.qs.length;
    const pct = Math.round((score / total) * 100);
    const key = "hw:" + n, prevRes = state.progress.quiz[key], prevPct = pctOf(prevRes) || 0;
    // the first finish earns 10 XP plus up to 10 for the score; a better retake earns the difference
    const gain = prevRes ? Math.round(Math.max(0, pct - prevPct) / 10) : 10 + Math.round(pct / 10);
    if (!prevRes || pct > prevPct) update((p) => { p.quiz[key] = { best: score, total, at: Date.now() }; });
    if (gain) addXp(gain);
    // words answered wrong come back soon in Review
    const missed = [...new Set(quiz.qs.filter((x, i) => !right[i]).map((x) => x.id).filter(Boolean))];
    if (missed.length) update((p) => { const now = Date.now(); for (const id of missed) p.srs[id] = p.srs[id] ? reviewCard(p.srs[id], false, now) : { b: 0, due: now, u: now }; });
    quiz.result = { score, total, pct, missed: missed.length };
    toast(gain ? t("hw.doneXp", { n: gain }) : t("hw.done"), "ok");
    const h = root.querySelector(".lesson-head");
    if (h) h.outerHTML = head();
    paintQuiz();
    requestAnimationFrame(() => { const el = root.querySelector("#hwResult"); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); });
  }

  paint();
  const onChange = (e) => { const el = e.target; if (el.matches('#hwForm input[type="radio"]') && !quiz.result) quiz.answers[Number(el.name.slice(1))] = Number(el.value); };
  const onSubmit = (e) => { if (e.target.id === "hwForm") { e.preventDefault(); submit(); } };
  root.addEventListener("change", onChange);
  root.addEventListener("submit", onSubmit);
  const off = onAct(root, {
    locked: () => showLock(),
    hwplay: () => {
      const lines = () => [...root.querySelectorAll(".panel .transcript-line")];
      playAll(d.words.map((w) => ({ text: w.en })), (i) => {
        lines().forEach((x) => x.classList.toggle("now", Number(x.dataset.i) === i));
        const c = lines().find((x) => Number(x.dataset.i) === i);
        if (c) c.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },
    qretake: () => {
      quiz = newQuiz();
      const sub = root.querySelector("#hwQuiz .panel-sub");
      if (sub) sub.textContent = t("hw.quizSub", { n: quiz.qs.length });
      paintQuiz();
      const el = root.querySelector("#hwQuiz");
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    },
  });
  return () => { off(); stop(); root.removeEventListener("change", onChange); root.removeEventListener("submit", onSubmit); };
}
