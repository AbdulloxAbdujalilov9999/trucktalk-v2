/* Practice: the hub (listening in the truck, conversation practice, review, games) and five short games.
 *   numbers  trucking numbers and spelling read aloud: load numbers, phone numbers, times, weights, heights, money...
 *   listen   hear a phrase, pick what you heard
 *   match    tap the English and its translation
 *   build    put the words of a sentence in order
 *   say      say a phrase; the phone's speech recognition shows which words came through
 * The phrase games use only what the student can already open (see items.js). A phrase they get wrong goes to their
 * review deck, so it comes back at the right time. */
import { t } from "../i18n.js";
import { esc, icon, onAct, spinner, bar, sayBtn } from "../ui.js";
import { state, update, addXp } from "../store.js";
import { go } from "../main.js";
import { play, stop } from "../audio.js";
import { recognizer } from "./common.js";
import { sources, itemsOf, defaultSet, rememberSet, setPicker } from "../items.js";
import { review as reviewCard, dueCards } from "../../shared/progress.js";
import { drillRound, checkDrill, compareSpeech, sentenceTiles, tileable, sameSentence, distinctItems, listenRound, shuffle, DRILL_KINDS } from "../../shared/drills.js";
import { SCENES } from "../../shared/scenes.js";

const SET_RE = /^(mine|video:\d{1,2}|day:-?\d{1,2})$/;

export default async function practice(root, params, { query }) {
  const game = params[0] || "";
  if (game === "numbers") return numbers(root, query);
  if (["listen", "match", "build", "say"].includes(game)) return phraseGame(root, game, query);
  return hub(root);
}

// ---------------------------------------------------------------- shared bits
function games() {
  return [
    { id: "numbers", ic: "hash", title: t("game.numbers"), sub: t("game.numbersSub") },
    { id: "listen", ic: "volume", title: t("game.listen"), sub: t("game.listenSub") },
    { id: "match", ic: "grid", title: t("game.match"), sub: t("game.matchSub") },
    { id: "build", ic: "blocks", title: t("game.build"), sub: t("game.buildSub") },
    { id: "say", ic: "mic", title: t("game.say"), sub: t("game.saySub") },
  ];
}
const back = () => `<a class="back" href="/app/practice" data-link>${icon("left", "ico")} ${esc(t("nav.practice"))}</a>`;
const progress = (i, n) => `<div class="row between" style="margin-bottom:6px"><span class="muted small">${i + 1} / ${n}</span></div>${bar((i / n) * 100)}`;

/** A phrase the student got wrong: into the review deck (or back to the start of it), due soon. */
function toReview(id) {
  if (!id) return;
  update((p) => { const now = Date.now(); p.srs[id] = p.srs[id] ? reviewCard(p.srs[id], false, now) : { b: 0, due: now, u: now }; });
}

function endCard({ right, total, xp, missed, againLabel = t("game.again") }) {
  const face = right === total ? "🏆" : right >= total * 0.6 ? "👍" : "💪";
  return `<div class="card center stack" style="padding:26px 16px">
    <div style="font-size:2.6rem">${face}</div>
    <h2>${esc(t("game.score", { n: right, total }))}</h2>
    ${xp ? `<p class="muted" style="margin:0">+${xp} XP</p>` : ""}
    ${missed ? `<p class="small muted" style="margin:0">${esc(t("game.toReview", { n: missed }))}</p>` : ""}
    <div class="row wrap-row" style="justify-content:center">
      <button class="btn primary" data-act="again">${icon("repeat", "ico")} ${esc(againLabel)}</button>
      <a class="btn ghost" href="/app/practice" data-link>${esc(t("game.other"))}</a>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- the hub
function hub(root) {
  const due = dueCards(state.progress).length, total = Object.keys(state.progress.srs).length;
  root.innerHTML = `
  <div class="pagehead"><h1>${esc(t("practice.title"))}</h1></div>
  <p class="muted" style="margin-top:-4px">${esc(t("practice.sub"))}</p>
  <div class="stack-lg">
    <section class="grid grid-2">
      <a class="card link stack hub-main" href="/app/listen" data-link>
        <div class="row">${icon("headphones")}<h3 class="grow" style="margin:0">${esc(t("listen.title"))}</h3></div>
        <p class="muted" style="margin:0">${esc(t("listen.sub"))}</p>
      </a>
      <a class="card link stack hub-main" href="/app/talk" data-link>
        <div class="row">${icon("chat")}<h3 class="grow" style="margin:0">${esc(t("talk.title"))}</h3><span class="badge info">AI</span></div>
        <p class="muted" style="margin:0">${esc(t("talk.sub", { n: SCENES.length }))}</p>
      </a>
      <a class="card link stack" href="/app/review" data-link>
        <div class="row"><span class="mi amber">${icon("repeat")}</span><h3 class="grow" style="margin:0">${esc(t("nav.review"))}</h3>${due ? `<span class="badge warn">${due}</span>` : ""}</div>
        <p class="muted" style="margin:0">${esc(due ? t("home.reviewReady", { n: due }) : total ? t("practice.reviewLater") : t("home.reviewNone"))}</p>
      </a>
    </section>
    <section>
      <h2>${esc(t("practice.games"))}</h2>
      <div class="grid grid-2">
        ${games().map((g) => `
        <a class="card link stack" href="/app/practice/${g.id}" data-link>
          <div class="row"><span class="mi">${icon(g.ic)}</span><h3 style="margin:0">${esc(g.title)}</h3></div>
          <p class="muted small" style="margin:0">${esc(g.sub)}</p>
        </a>`).join("")}
      </div>
    </section>
  </div>`;
}

// ---------------------------------------------------------------- numbers and spelling
function kindLabel(k) {
  return {
    all: t("num.all"), load: t("num.load"), phone: t("num.phone"), time: t("num.time"), weight: t("num.weight"), height: t("num.height"),
    money: t("num.money"), mile: t("num.mile"), temp: t("num.temp"), spell: t("num.spell"), address: t("num.address"),
  }[k] || k;
}
function fieldHint(f) {
  return { digits: t("num.hintDigits"), time: t("num.hintTime"), height: t("num.hintHeight"), number: t("num.hintNumber"), letters: t("num.hintLetters") }[f] || "";
}
const KINDS = ["all", ...DRILL_KINDS, "address"];

function numbers(root, query) {
  let kind = KINDS.includes(query.get("k")) ? query.get("k") : "all";
  let phase = "pick", round = [], i = 0, typed = "", ok = null, right = 0, xp = 0;
  const voice = "speechSynthesis" in window;

  const hear = (slow) => { const d = round[i]; if (d) play(d.say, { device: true, rate: slow ? 0.7 : 1 }); };

  function paint() {
    if (phase === "pick") {
      root.innerHTML = `${back()}
        <div class="pagehead"><h1>${esc(t("game.numbers"))}</h1></div>
        <div class="card stack">
          <p style="margin:0">${esc(t("num.intro"))}</p>
          ${voice ? "" : `<div class="note">${esc(t("num.noVoice"))}</div>`}
          <div class="chips">${KINDS.map((k) => `<button class="chip ${k === kind ? "on" : ""}" data-act="kind" data-k="${k}" aria-pressed="${k === kind}">${esc(kindLabel(k))}</button>`).join("")}</div>
          <button class="btn primary block" data-act="start">${icon("play", "ico")} ${esc(t("start"))}</button>
        </div>`;
      return;
    }
    if (phase === "end") {
      root.innerHTML = `${back()}<div class="pagehead"><h1>${esc(t("game.numbers"))}</h1></div>${endCard({ right, total: round.length, xp })}`;
      return;
    }
    const d = round[i];
    const mode = d.field === "digits" ? "numeric" : "text";
    root.innerHTML = `${back()}
      <div class="pagehead"><h1>${esc(t("game.numbers"))}</h1><span class="grow"></span><span class="badge info">${esc(kindLabel(d.kind))}</span></div>
      ${progress(i, round.length)}
      <div class="card stack center" style="margin-top:14px">
        <button class="bigplay" data-act="hear" aria-label="${esc(t("num.play"))}">${icon("volume")}</button>
        <div><button class="btn sm ghost" data-act="slow">${esc(t("num.slower"))}</button></div>
        <p class="muted small" style="margin:0">${esc(fieldHint(d.field))}</p>
        <form id="drillForm" class="row" autocomplete="off">
          <input class="input big-input grow" id="ans" inputmode="${mode}" autocapitalize="${d.field === "letters" ? "characters" : "off"}" spellcheck="false" maxlength="40"
            value="${esc(typed)}" ${ok !== null ? "disabled" : ""} aria-label="${esc(fieldHint(d.field))}">
          ${ok === null ? `<button class="btn primary" type="submit">${esc(t("game.check"))}</button>` : ""}
        </form>
        ${ok === null ? "" : `
        <div class="answer ${ok ? "ok" : "bad"}">
          <b>${ok ? "✓ " + esc(t("game.right")) : "✗ " + esc(t("game.wrong"))}</b>
          <div class="shown">${esc(d.shown)}</div>
          <div class="small muted">${esc(t("num.said"))}: “${esc(d.say)}”</div>
        </div>
        <button class="btn primary block" data-act="next">${esc(i + 1 < round.length ? t("next") : t("done"))}</button>`}
      </div>`;
    const f = root.querySelector("#drillForm");
    f.addEventListener("submit", (e) => { e.preventDefault(); answer(); });
    const inp = root.querySelector("#ans");
    if (ok === null) { inp.addEventListener("input", () => { typed = inp.value; }); inp.focus(); }
    else { const nx = root.querySelector('[data-act="next"]'); if (nx) nx.focus(); }
  }

  function answer() {
    const inp = root.querySelector("#ans");
    typed = inp ? inp.value : typed;
    if (!typed.trim() || ok !== null) return;
    ok = checkDrill(round[i], typed);
    if (ok) { right++; xp += 2; addXp(2); }
    paint();
    if (!ok) hear(true);
  }

  paint();
  const off = onAct(root, {
    kind: (el) => { kind = el.dataset.k; history.replaceState(history.state, "", "/app/practice/numbers" + (kind === "all" ? "" : "?k=" + kind)); paint(); },
    start: () => { round = drillRound(kind === "all" ? "all" : [kind], 10); i = 0; right = 0; xp = 0; typed = ""; ok = null; phase = "play"; paint(); hear(false); },
    hear: () => hear(false),
    slow: () => hear(true),
    next: () => { i++; typed = ""; ok = null; if (i >= round.length) { phase = "end"; paint(); return; } paint(); hear(false); },
    again: () => { phase = "pick"; paint(); },
  });
  return () => { off(); stop(); };
}

// ---------------------------------------------------------------- the phrase games
async function phraseGame(root, game, query) {
  root.innerHTML = spinner();
  const here = location.pathname + location.search;
  const src = await sources();
  if (location.pathname + location.search !== here) return;   // the student moved on while it loaded
  let set = query.get("set");
  if (!set || !SET_RE.test(set) || itemsOf(set, src).length < 2) set = defaultSet(src);
  rememberSet(set);
  const items = itemsOf(set, src);
  const title = games().find((g) => g.id === game).title;
  const header = () => `${back()}
    <div class="pagehead"><h1>${esc(title)}</h1></div>
    <div style="margin-bottom:14px">${setPicker(set, src)}</div>`;
  const small = () => `${header()}<div class="card empty">${icon("search")}<p>${esc(t("game.small"))}</p></div>`;

  const impl = { listen: listenGame, match: matchGame, build: buildGame, say: sayGame }[game];
  const body = document.createElement("div");
  const cleanup = impl(body, items, { header, small });
  root.innerHTML = "";
  root.appendChild(body);
  const onChange = (e) => {
    if (e.target.id !== "setpick") return;
    go(`/app/practice/${game}?set=${encodeURIComponent(e.target.value)}`, { replace: true });
  };
  root.addEventListener("change", onChange);
  return () => { root.removeEventListener("change", onChange); if (cleanup) cleanup(); stop(); };
}

function listenGame(root, items, { header, small }) {
  const sentences = items.filter((x) => x.kind !== "word");
  const base = sentences.length >= 6 ? sentences : items;
  let qs = listenRound(base, 8), i = 0, chosen = null, right = 0, xp = 0, missed = 0;
  const hear = (slow) => { if (qs[i]) play(qs[i].item.en, { rate: slow ? 0.75 : 1 }); };

  function paint() {
    if (qs.length < 4) { root.innerHTML = small(); return; }
    if (i >= qs.length) { root.innerHTML = header() + endCard({ right, total: qs.length, xp, missed }); return; }
    const q = qs[i];
    root.innerHTML = `${header()}
      ${progress(i, qs.length)}
      <div class="card stack center" style="margin-top:14px">
        <button class="bigplay" data-act="hear" aria-label="${esc(t("num.play"))}">${icon("volume")}</button>
        <div><button class="btn sm ghost" data-act="slow">${esc(t("num.slower"))}</button></div>
        <p class="muted small" style="margin:0">${esc(t("listenq.q"))}</p>
      </div>
      <div class="opts" style="margin-top:12px">
        ${q.opts.map((o, k) => `<button class="opt ${chosen === null ? "" : k === q.a ? "right" : k === chosen ? "wrong" : ""}" data-act="pick" data-k="${k}" ${chosen === null ? "" : "disabled"}>${esc(o)}</button>`).join("")}
      </div>
      ${chosen === null ? "" : `
      <div class="card flat stack" style="margin-top:12px">
        <div class="row">${sayBtn(q.item.en)}<div class="grow"><b>${esc(q.item.en)}</b><div class="muted">${esc(q.item.tr)}</div></div></div>
      </div>
      <button class="btn primary block" style="margin-top:12px" data-act="next">${esc(i + 1 < qs.length ? t("next") : t("done"))}</button>`}`;
  }
  paint(); hear(false);
  return onAct(root, {
    hear: () => hear(false), slow: () => hear(true),
    pick: (el) => {
      if (chosen !== null) return;
      chosen = Number(el.dataset.k);
      if (chosen === qs[i].a) { right++; xp += 2; addXp(2); } else { missed++; toReview(qs[i].item.id); }
      paint();
    },
    next: () => { i++; chosen = null; paint(); hear(false); },
    again: () => { qs = listenRound(base, 8); i = 0; chosen = null; right = 0; xp = 0; missed = 0; paint(); hear(false); },
  });
}

function matchGame(root, items, { header, small }) {
  const fits = items.filter((x) => x.en.length <= 42 && x.tr.length <= 60);
  const words = fits.filter((x) => x.kind === "word");
  const base = words.length >= 5 ? words : fits;
  let pairs = [], left = [], right = [], selL = null, selR = null, matched = new Set(), wrong = null, missed = new Set(), xp = 0, timer = 0;

  function newRound() {
    pairs = distinctItems(base, 5);
    left = shuffle(pairs.map((_, k) => k)); right = shuffle(pairs.map((_, k) => k));
    selL = selR = null; matched = new Set(); wrong = null; missed = new Set(); xp = 0;
  }
  function paint() {
    if (pairs.length < 3) { root.innerHTML = small(); return; }
    if (matched.size === pairs.length) {
      root.innerHTML = header() + endCard({ right: pairs.length - Math.min(missed.size, pairs.length), total: pairs.length, xp, missed: missed.size, againLabel: t("match.next") });
      return;
    }
    const cls = (side, k) => {
      if (matched.has(k)) return "right";
      if (wrong && wrong[side] === k) return "wrong";
      return (side === 0 ? selL : selR) === k ? "sel" : "";
    };
    root.innerHTML = `${header()}
      <p class="muted small">${esc(t("match.hint"))}</p>
      <div class="pairs">
        <div class="col">${left.map((k) => `<button class="opt pair ${cls(0, k)}" data-act="l" data-k="${k}" ${matched.has(k) ? "disabled" : ""}>${esc(pairs[k].en)}</button>`).join("")}</div>
        <div class="col">${right.map((k) => `<button class="opt pair ${cls(1, k)}" data-act="r" data-k="${k}" ${matched.has(k) ? "disabled" : ""}>${esc(pairs[k].tr)}</button>`).join("")}</div>
      </div>`;
  }
  function tryPair() {
    if (selL === null || selR === null) { paint(); return; }
    if (selL === selR) { matched.add(selL); xp += 1; addXp(1); }
    else {
      wrong = [selL, selR];
      if (!missed.has(selL)) { missed.add(selL); toReview(pairs[selL].id); }
      clearTimeout(timer); timer = setTimeout(() => { wrong = null; paint(); }, 700);
    }
    selL = selR = null; paint();
  }
  newRound(); paint();
  const off = onAct(root, {
    l: (el) => { const k = Number(el.dataset.k); if (matched.has(k)) return; selL = k; play(pairs[k].en); tryPair(); },
    r: (el) => { const k = Number(el.dataset.k); if (matched.has(k)) return; selR = k; tryPair(); },
    again: () => { newRound(); paint(); },
  });
  return () => { off(); clearTimeout(timer); };
}

function buildGame(root, items, { header, small }) {
  const pool0 = items.filter((x) => x.kind === "sentence" && tileable(x.en));
  let pool = distinctItems(pool0, 6), i = 0, puzzle = null, picked = [], checked = null, right = 0, xp = 0, missed = 0;
  const load = () => { puzzle = pool[i] ? sentenceTiles(pool[i].en) : null; picked = []; checked = null; };

  function paint() {
    if (pool.length < 3) { root.innerHTML = small(); return; }
    if (i >= pool.length) { root.innerHTML = header() + endCard({ right, total: pool.length, xp, missed }); return; }
    const it = pool[i], all = picked.length === puzzle.tiles.length;
    root.innerHTML = `${header()}
      ${progress(i, pool.length)}
      <div class="card stack" style="margin-top:14px">
        <div class="tiny muted">${esc(t("build.hint"))}</div>
        <div class="build-tr">${esc(it.tr)}</div>
        <div class="answer-line ${checked === null ? "" : checked ? "ok" : "bad"}" aria-live="polite">
          ${picked.length ? picked.map((ti, k) => `<button class="tile" data-act="unpick" data-k="${k}" ${checked === null ? "" : "disabled"}>${esc(puzzle.tiles[ti])}</button>`).join("") : `<span class="faint small">${esc(t("build.empty"))}</span>`}
        </div>
        <div class="tiles">
          ${puzzle.tiles.map((w, ti) => picked.includes(ti) ? `<span class="tile used">${esc(w)}</span>` : `<button class="tile" data-act="pick" data-t="${ti}">${esc(w)}</button>`).join("")}
        </div>
        ${checked === false ? `<div class="note"><div class="tiny muted">${esc(t("build.right"))}</div><b>${esc(puzzle.answer.join(" "))}</b></div>` : ""}
        ${checked === true ? `<div class="answer ok"><b>✓ ${esc(t("game.right"))}</b></div>` : ""}
      </div>
      <div class="row" style="margin-top:12px">
        ${checked === null
          ? `<button class="btn ghost" data-act="hint">${icon("volume", "ico")} ${esc(t("build.listen"))}</button>
             <button class="btn primary grow" data-act="check" ${all ? "" : "disabled"}>${esc(t("game.check"))}</button>`
          : `<button class="btn primary block" data-act="next">${esc(i + 1 < pool.length ? t("next") : t("done"))}</button>`}
      </div>`;
  }
  load(); paint();
  return onAct(root, {
    pick: (el) => { if (checked !== null) return; const ti = Number(el.dataset.t); if (!picked.includes(ti)) picked.push(ti); paint(); },
    unpick: (el) => { if (checked !== null) return; picked.splice(Number(el.dataset.k), 1); paint(); },
    hint: () => play(pool[i].en),
    check: () => {
      checked = sameSentence(picked.map((ti) => puzzle.tiles[ti]), puzzle.answer);
      if (checked) { right++; xp += 2; addXp(2); } else { missed++; toReview(pool[i].id); }
      paint(); play(pool[i].en);
    },
    next: () => { i++; load(); paint(); },
    again: () => { pool = distinctItems(pool0, 6); i = 0; right = 0; xp = 0; missed = 0; load(); paint(); },
  });
}

function sayGame(root, items, { header, small }) {
  const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const pick = () => { const s = items.filter((x) => x.en.length <= 90); const sent = s.filter((x) => x.kind !== "word"); return distinctItems(sent.length >= 6 ? sent : s, 6); };
  let pool = pick(), i = 0, heard = null, result = null, listening = false, rec = null, counted = false, right = 0, xp = 0;

  function paint() {
    if (pool.length < 3) { root.innerHTML = small(); return; }
    if (i >= pool.length) { root.innerHTML = header() + endCard({ right, total: pool.length, xp }); return; }
    const it = pool[i];
    const words = result ? result.words.map((w) => `<span class="${w.ok ? "w-ok" : "w-miss"}">${esc(w.w)}</span>`).join(" ") : esc(it.en);
    root.innerHTML = `${header()}
      ${progress(i, pool.length)}
      <div class="card stack center" style="margin-top:14px">
        <div class="say-phrase">${words}</div>
        <div class="muted">${esc(it.tr)}</div>
        <div class="row" style="justify-content:center">${sayBtn(it.en)}<button class="btn sm ghost" data-act="slow">${esc(t("num.slower"))}</button></div>
        ${hasSR
          ? `<button class="mic ${listening ? "on" : ""}" data-act="mic" aria-label="${esc(t("say.tap"))}">${icon("mic")}</button>
             <div class="tiny muted">${esc(listening ? t("say.listening") : t("say.tap"))}</div>`
          : `<div class="note">${esc(t("say.noMic"))}</div>`}
        ${heard !== null ? `<div class="small muted">${esc(t("say.heard"))}: “${esc(heard || "…")}”</div>` : ""}
        ${result ? `<div class="result ${result.score >= 80 ? "ok-text" : "bad-text"}">${result.score}% · ${esc(result.score >= 80 ? t("say.great") : t("say.again"))}</div>` : ""}
      </div>
      <div class="row" style="margin-top:12px">
        ${hasSR ? "" : `<button class="btn ghost grow" data-act="selfok">${esc(t("say.saidIt"))}</button>`}
        <button class="btn primary grow" data-act="next">${esc(i + 1 < pool.length ? t("next") : t("done"))}</button>
      </div>`;
  }
  function mic() {
    if (listening && rec) { try { rec.stop(); } catch { /* ignore */ } return; }
    stop();
    const at = i;
    rec = recognizer({
      onText: (s) => { if (at === i) heard = s; },
      onEnd: () => {
        if (at !== i) return;
        listening = false;
        if (heard) {
          result = compareSpeech(pool[i].en, heard);
          if (result.score >= 80 && !counted) { counted = true; right++; xp += 2; addXp(2); }
        }
        paint();
      },
    });
    if (!rec) return;
    heard = null; result = null; listening = true; paint();
    try { rec.start(); } catch { listening = false; paint(); }
  }
  paint();
  const off = onAct(root, {
    slow: () => play(pool[i].en, { rate: 0.75 }),
    mic,
    selfok: () => { if (!counted) { counted = true; right++; xp += 1; addXp(1); } i++; heard = null; result = null; counted = false; paint(); },
    next: () => { if (rec) { try { rec.abort(); } catch { /* ignore */ } } listening = false; i++; heard = null; result = null; counted = false; paint(); },
    again: () => { pool = pick(); i = 0; right = 0; xp = 0; heard = null; result = null; counted = false; paint(); },
  });
  return () => { off(); if (rec) { try { rec.abort(); } catch { /* ignore */ } } };
}
