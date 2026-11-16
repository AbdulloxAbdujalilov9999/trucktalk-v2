/* Conversation practice: pick a real situation (a police stop, a DOT inspection, a broker call...). The AI plays the
 * other person and coaches every line the student says or types: what to fix, why, and what they could say next.
 * A conversation counts as one AI use (the server keeps its line count). An unfinished conversation is kept for this
 * browser tab, so a look at the dictionary doesn't lose it. */
import { t, trLang, lang } from "../i18n.js";
import { esc, icon, onAct, sayBtn, toast } from "../ui.js";
import { api } from "../api.js";
import { state, addXp } from "../store.js";
import { go } from "../main.js";
import { play, stop } from "../audio.js";
import { recognizer, pageHead } from "./common.js";
import { SCENES, sceneById, MAX_TURNS } from "../../shared/scenes.js";

const ui = (o) => (o && (o[lang()] || o.uz || o.en)) || "";

export default async function talk(root, params) {
  if (!params[0]) return list(root);
  const sc = sceneById(params[0]);
  if (!sc) { go("/app/talk", { replace: true }); return; }
  return scene(root, sc);
}

function list(root) {
  const a = state.me.access;
  root.innerHTML = `
    ${pageHead({ back: "/app/practice", backLabel: t("nav.practice"), right: `<span class="badge info">AI</span>`, eyebrow: t("practice.title"), title: t("talk.title"), sub: esc(t("talk.intro")),
      body: a.signedIn ? `<p class="tiny muted head-extra">${esc(t("talk.cost", { n: (a.limits && a.limits.ai) || 0 }))}</p>` : "" })}
    ${!a.signedIn ? `<div class="card accent row wrap-row"><b class="grow">${esc(t("talk.signin"))}</b><a class="btn dark" href="/app/signin" data-link>${esc(t("signin"))}</a></div>` : ""}
    <section class="quick quick-two">
      ${SCENES.map((s) => `
      <a class="quick-tile" href="/app/talk/${s.id}" data-link>
        <span class="quick-ico">${icon(s.icon)}</span>
        <span class="grow"><span class="quick-t">${esc(ui(s.title))}</span><span class="quick-s">${esc(ui(s.who))}</span></span>
        ${icon("chevron", "ico faint")}
      </a>`).join("")}
    </section>`;
}

function scene(root, sc) {
  const KEY = "tt2:talk:" + sc.id;
  const L = trLang();
  const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const fresh = () => ({ msgs: [{ r: "them", t: sc.opening.en, tr: sc.opening[L] || sc.opening.uz, natural: true }], convo: null, done: false, sugg: sc.starters.slice(), left: null });
  let s = fresh();
  try { const saved = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (saved && Array.isArray(saved.msgs) && saved.msgs.length && !saved.done) s = saved; } catch { /* ignore */ }
  const save = () => { try { if (s.done) sessionStorage.removeItem(KEY); else sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };

  let busy = false, draft = "", listening = false, rec = null, problem = null, gone = false;
  const turn = () => s.msgs.filter((m) => m.r === "me").length + 1;

  function bubble(m, k) {
    if (m.r === "them") {
      return `<div class="bubble">
        <div class="who">${esc(ui(sc.who))}</div>
        <div class="en">${esc(m.t)}</div>
        ${m.tr ? `<div class="tr">${esc(m.tr)}</div>` : ""}
        <button class="btn icon sm play" data-act="hear" data-k="${k}" aria-label="${esc(t("num.play"))}">${icon("volume")}</button>
      </div>`;
    }
    const f = m.fb;
    const badge = !f ? "" : f.verdict === "good" ? `<span class="badge ok">✓ ${esc(t("talk.good"))}</span>` : f.verdict === "fix" ? `<span class="badge warn">${esc(t("talk.fix"))}</span>` : `<span class="badge bad">${esc(t("talk.unclear"))}</span>`;
    return `<div class="bubble me"><div class="en">${esc(m.t)}</div></div>
      ${f ? `<div class="feedback ${esc(f.verdict)}">
        ${badge}
        ${f.verdict === "fix" && f.corrected ? `<div class="row">${sayBtn(f.corrected, { device: true })}<b>${esc(f.corrected)}</b></div>` : ""}
        ${f.note ? `<div class="small">${esc(f.note)}</div>` : ""}
      </div>` : ""}`;
  }

  function summary() {
    const mine = s.msgs.filter((m) => m.r === "me");
    const good = mine.filter((m) => m.fb && m.fb.verdict === "good").length;
    const fixes = mine.filter((m) => m.fb && m.fb.verdict === "fix" && m.fb.corrected);
    return `<div class="card center stack" style="margin-top:16px;padding:24px 16px">
      <div style="font-size:2.4rem">🎉</div>
      <h2 style="margin:0">${esc(t("talk.doneTitle"))}</h2>
      <p class="muted" style="margin:0">${esc(t("talk.doneStats", { n: mine.length, good }))}</p>
      ${fixes.length ? `<div class="stack" style="text-align:left">
        <div class="tiny muted">${esc(t("talk.fixes"))}</div>
        ${fixes.map((m) => `<div class="row">${sayBtn(m.fb.corrected, { device: true })}<div class="grow"><div class="faint small"><s>${esc(m.t)}</s></div><b>${esc(m.fb.corrected)}</b></div></div>`).join("")}
      </div>` : ""}
      <div class="row wrap-row" style="justify-content:center">
        <button class="btn primary" data-act="restart">${icon("repeat", "ico")} ${esc(t("talk.again"))}</button>
        <a class="btn ghost" href="/app/talk" data-link>${esc(t("talk.other"))}</a>
      </div>
    </div>`;
  }

  function composer() {
    const a = state.me.access;
    if (!a.signedIn) return `<div class="card accent row wrap-row" style="margin-top:16px"><b class="grow">${esc(t("talk.signin"))}</b><a class="btn dark" href="/app/signin" data-link>${esc(t("signin"))}</a></div>`;
    if (problem === "daily-limit") {
      return `<div class="card stack center" style="margin-top:16px"><p style="margin:0">${esc(t("talk.limit"))}</p>
        <div class="row wrap-row" style="justify-content:center"><a class="btn ghost" href="/app/practice" data-link>${esc(t("talk.practiceInstead"))}</a><a class="btn" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a></div></div>`;
    }
    return `<div class="card stack composer" style="margin-top:16px">
      ${s.sugg.length ? `<div class="tiny muted">${esc(t("talk.ideas"))}</div><div class="chips">${s.sugg.map((x, k) => `<button class="chip" data-act="sugg" data-k="${k}">${esc(x)}</button>`).join("")}</div>` : ""}
      <textarea class="input" id="msg" maxlength="300" rows="2" placeholder="${esc(t("talk.placeholder"))}" ${busy ? "disabled" : ""}>${esc(draft)}</textarea>
      <div class="row">
        ${hasSR ? `<button class="btn icon ${listening ? "bad" : ""}" data-act="mic" aria-label="${esc(t("say.tap"))}" ${busy ? "disabled" : ""}>${icon("mic", "ico")}</button>` : ""}
        <button class="btn primary grow" data-act="send" ${busy ? "disabled" : ""}>${icon("send", "ico")} ${esc(busy ? t("talk.thinking") : t("teacher.send"))}</button>
      </div>
      <div class="row between tiny muted"><span>${esc(t("talk.turn", { n: Math.min(turn(), MAX_TURNS), max: MAX_TURNS }))}</span>${s.left != null ? `<span>${esc(t("talk.left", { n: s.left }))}</span>` : ""}</div>
    </div>`;
  }

  function paint() {
    root.innerHTML = `
      ${pageHead({ back: "/app/talk", backLabel: t("talk.title"), game: true, eyebrow: ui(sc.who), title: ui(sc.title),
        right: s.msgs.length > 1 && !s.done ? `<button class="btn sm ghost" data-act="restart">${icon("refresh")} ${esc(t("talk.restart"))}</button>` : "" })}
      <div class="card accent stack goal">
        <div class="tiny"><b>${esc(t("talk.goal"))}</b></div>
        <div>${esc(ui(sc.goal))}</div>
        <div class="tiny muted">${esc(t("talk.roles", { who: ui(sc.who) }))}</div>
      </div>
      <div class="chat" style="margin-top:16px">${s.msgs.map(bubble).join("")}
        ${busy ? `<div class="bubble typing" aria-label="${esc(t("talk.thinking"))}"><span></span><span></span><span></span></div>` : ""}</div>
      ${s.done ? summary() : composer()}`;
    const ta = root.querySelector("#msg");
    if (ta) {
      ta.addEventListener("input", () => { draft = ta.value; });
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    }
  }
  const scrollEnd = () => { const last = root.querySelector(".chat > :last-child"); if (last && last.scrollIntoView) last.scrollIntoView({ block: "nearest", behavior: "smooth" }); };

  async function send() {
    const ta = root.querySelector("#msg");
    const text = String((ta && ta.value) || draft).replace(/\s+/g, " ").trim();
    if (!text || busy || s.done) return;
    if (rec && listening) { try { rec.stop(); } catch { /* ignore */ } }
    stop();
    busy = true; problem = null; draft = text;
    const history = s.msgs.slice(1).map((m) => ({ r: m.r, t: m.t }));
    s.msgs.push({ r: "me", t: text });
    paint(); scrollEnd();
    try {
      const r = await api("ai", { method: "POST", body: { action: "roleplay", scene: sc.id, history, text, lang: L, convo: s.convo } });
      const me = s.msgs[s.msgs.length - 1];
      me.fb = { verdict: r.verdict, corrected: r.corrected, note: r.note };
      s.msgs.push({ r: "them", t: r.reply, tr: r.reply_tr || "" });
      s.convo = r.convo; s.sugg = r.suggestions || []; s.done = !!r.done;
      if (typeof r.left === "number") s.left = r.left;
      addXp(r.verdict === "good" ? 3 : 1);
      if (s.done) addXp(5);
      draft = "";
      busy = false; save();
      if (gone) return;   // the student left this screen: the conversation is kept for when they come back
      paint(); scrollEnd();
      play(r.reply, { device: true });
    } catch (e) {
      s.msgs.pop();   // the line wasn't answered: put it back in the box
      busy = false;
      if (gone) return;
      if (e.code === "daily-limit") problem = "daily-limit";
      else if (e.code === "too-long") { s.done = true; save(); }
      else if (e.code === "sign-in") toast(t("talk.signin"), "bad");
      else toast(e.code === "network" ? t("error.network") : t("teacher.busy"), "bad");
      paint();
    }
  }

  paint();
  if (s.msgs.length === 1) play(sc.opening.en);
  const off = onAct(root, {
    hear: (el) => { const m = s.msgs[Number(el.dataset.k)]; if (m) play(m.t, m.natural ? {} : { device: true }); },
    sugg: (el) => { draft = s.sugg[Number(el.dataset.k)] || ""; const ta = root.querySelector("#msg"); if (ta) { ta.value = draft; ta.focus(); } },
    send,
    mic: () => {
      if (listening && rec) { try { rec.stop(); } catch { /* ignore */ } return; }
      stop();
      rec = recognizer({
        onText: (txt) => { draft = txt; const ta = root.querySelector("#msg"); if (ta) ta.value = txt; },
        onEnd: () => { listening = false; paint(); },
      });
      if (!rec) return;
      listening = true; paint();
      try { rec.start(); } catch { listening = false; paint(); }
    },
    restart: () => { stop(); s = fresh(); draft = ""; problem = null; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } paint(); play(sc.opening.en); },
  });
  return () => { gone = true; off(); stop(); if (rec) { try { rec.abort(); } catch { /* ignore */ } } };
}
