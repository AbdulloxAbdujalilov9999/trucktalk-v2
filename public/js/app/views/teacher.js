/* The AI teacher: check a sentence, ask a question (Claude, server-side limits), and the live voice teacher (ElevenLabs,
 * minutes counted by the server; paid plans). */
import { t, trLang } from "../i18n.js";
import { esc, icon, onAct, toast } from "../ui.js";
import { api, config } from "../api.js";
import { state, refreshMe } from "../store.js";
import { go, catalog } from "../main.js";
import { tutorResult } from "./day.js";
import { recognizer, pageHead } from "./common.js";

// ElevenLabs' browser library, pinned and integrity-locked (same file the current TruckTalk uses)
const SDK_URL = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.32.1/dist/lib.iife.js";
const SDK_HASH = "sha384-/H9FO+W4/iXm0jrbV5RolrnHPc/xL0qgBQelFSw1mwGLju6BDADE48C9U/Un+PAP";
function loadSDK() {
  if (window.ElevenLabsClient) return Promise.resolve(window.ElevenLabsClient);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL; s.integrity = SDK_HASH; s.crossOrigin = "anonymous";
    s.onload = () => (window.ElevenLabsClient ? resolve(window.ElevenLabsClient) : reject(new Error("sdk")));
    s.onerror = () => reject(new Error("sdk"));
    document.head.appendChild(s);
  });
}

export default async function teacher(root, _p, { query }) {
  const cfg = await config();
  const a = state.me.access;
  let tab = query.get("tab") || "check", busy = false, result = null, text = "", rec = null, listening = false;
  const call = { conv: null, sessionId: null, state: "idle", left: 0, timer: null, raf: 0, transcript: [] };

  function voicePane() {
    if (!cfg.features.voiceTeacher) return `<div class="card empty">${esc(t("teacher.voiceOff"))}</div>`;
    if (!(a.limits && a.limits.voiceMin > 0)) return `<div class="card stack center"><p>${esc(t("teacher.voicePlan"))}</p><a class="btn primary" href="/app/pricing" data-link>${esc(t("lock.seePlans"))}</a></div>`;
    const v = state.me.voice || {};
    const label = call.state === "connecting" ? t("teacher.connecting") : call.state === "speaking" ? t("teacher.speaking") : call.state === "listening" ? t("teacher.listening") : "";
    return `<div class="card stack center">
      <p class="muted">${esc(t("teacher.voiceSub"))}</p>
      <div class="orb ${call.conv ? "" : "idle"}" id="orb"></div>
      <div><b>${esc(label)}</b> <span class="muted" id="clock"></span></div>
      ${call.conv ? `<button class="btn bad" data-act="vend">${esc(t("teacher.voiceEnd"))}</button>`
                  : `<button class="btn primary" data-act="vstart" ${call.state === "connecting" ? "disabled" : ""}>${icon("phone", "ico")} ${esc(t("teacher.voiceStart"))}</button>`}
      <div class="tiny muted">${esc(t("teacher.voiceLeft", { n: v.minutesLeft != null ? v.minutesLeft : "–" }))}</div>
      <div class="chat" style="text-align:left">${call.transcript.slice(-12).map((m) => `<div class="bubble ${m.me ? "me" : ""}"><div class="en">${esc(m.text)}</div></div>`).join("")}</div>
    </div>`;
  }

  function paint() {
    const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    root.innerHTML = `
      ${pageHead({ back: "/app/practice", backLabel: t("nav.practice"), right: `<span class="badge info">AI</span>`, eyebrow: t("practice.title"), title: t("teacher.title"), sub: esc(t("teacher.hubSub")),
        body: `<div class="seg full head-extra" role="group" aria-label="${esc(t("teacher.title"))}">
          <button data-act="tab" data-t="check" class="${tab === "check" ? "on" : ""}" aria-pressed="${tab === "check"}">${esc(t("teacher.check"))}</button>
          <button data-act="tab" data-t="ask" class="${tab === "ask" ? "on" : ""}" aria-pressed="${tab === "ask"}">${esc(t("teacher.ask"))}</button>
          <button data-act="tab" data-t="voice" class="${tab === "voice" ? "on" : ""}" aria-pressed="${tab === "voice"}">${esc(t("teacher.voice"))}</button>
        </div>` })}
      ${!a.signedIn ? `<div class="card accent row wrap-row"><b class="grow">${esc(t("teacher.signin"))}</b><a class="btn dark" href="/app/signin" data-link>${esc(t("signin"))}</a></div>` : ""}
      ${tab === "voice" ? voicePane() : `
      <div class="card stack">
        <p class="muted" style="margin:0">${esc(tab === "check" ? t("teacher.checkHint") : t("teacher.askHint"))}</p>
        <textarea class="input" id="tq" maxlength="400" placeholder="${tab === "check" ? "I waiting at the dock since two hours." : "…"}">${esc(text)}</textarea>
        <div class="row">
          ${hasSR && tab === "check" ? `<button class="btn icon ${listening ? "bad" : ""}" data-act="mic" aria-label="Mic">${icon("mic", "ico")}</button>` : ""}
          <button class="btn primary grow" data-act="send" ${busy || !a.signedIn ? "disabled" : ""}>${icon("send", "ico")} ${esc(t("teacher.send"))}</button>
        </div>
        ${result ? tutorResult(result) : ""}
        ${a.signedIn ? `<div class="tiny muted">${esc(t("teacher.daily", { n: a.limits ? a.limits.ai : 0 }))}</div>` : ""}
      </div>`}`;
    const ta = root.querySelector("#tq");
    if (ta) ta.addEventListener("input", () => { text = ta.value; });
  }

  // ---------------------------------------------------------------- voice call
  function tick() { call.left = Math.max(0, call.left - 1); const c = root.querySelector("#clock"); if (c) c.textContent = call.left ? Math.floor(call.left / 60) + ":" + String(call.left % 60).padStart(2, "0") : ""; if (!call.left && call.conv) hangUp(); }
  function orbLoop() {
    const orb = root.querySelector("#orb");
    if (orb && call.conv) {
      let lvl = 0;
      try { lvl = call.state === "speaking" ? call.conv.getOutputVolume() : call.conv.getInputVolume(); } catch { /* ignore */ }
      orb.style.setProperty("--lvl", Math.min(1, (lvl || 0) * 1.7).toFixed(3));
    }
    call.raf = requestAnimationFrame(orbLoop);
  }
  async function report(conversationId) {
    if (!call.sessionId) return;
    const body = { action: "voice-end", sessionId: call.sessionId, conversationId };
    for (const wait of [0, 5000, 15000]) {
      await new Promise((r) => setTimeout(r, wait));
      try { const r = await api("ai", { method: "POST", body }); if (r.settled) break; } catch { break; }
    }
    refreshMe();
  }
  function hangUp() {
    const c = call.conv; call.conv = null;
    clearInterval(call.timer); cancelAnimationFrame(call.raf);
    let convId = null;
    if (c) { try { convId = c.getId(); } catch { /* ignore */ } try { c.endSession(); } catch { /* ignore */ } }
    call.state = "idle";
    report(convId);
    paint();
  }
  async function startCall() {
    call.state = "connecting"; call.transcript = []; paint();
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) new AC().resume(); } catch { /* ignore */ }
    try {
      const [link, sdk] = await Promise.all([api("ai", { method: "POST", body: { action: "voice-start" } }), loadSDK()]);
      call.sessionId = link.sessionId; call.left = link.maxSeconds;
      const user = state.me.user || {};
      const days = ((await catalog().catch(() => null)) || { days: [] }).days, pd = state.progress.days || {};
      const next = days.find((d) => !(pd[d.n] && pd[d.n].done));
      call.conv = await sdk.Conversation.startSession({
        signedUrl: link.signedUrl,
        dynamicVariables: {
          student_name: (user.name || "").split(" ")[0] || "friend",
          helper_language: trLang() === "ru" ? "Russian" : "Uzbek",
          lessons_done: String(days.filter((d) => pd[d.n] && pd[d.n].done).length),
          next_lesson: next ? next.title.en : "a review of the whole course",
        },
        onMessage: (m) => { const txt = String((m && m.message) || "").trim(); if (txt) { call.transcript.push({ me: m.source === "user", text: txt }); paint(); } },
        onModeChange: (m) => { call.state = m && m.mode === "speaking" ? "speaking" : "listening"; paint(); },
        onDisconnect: () => { if (call.conv) hangUp(); },
      });
      call.state = "listening";
      call.timer = setInterval(tick, 1000);
      orbLoop();
      paint();
    } catch (e) {
      call.state = "idle"; call.conv = null; paint();
      const denied = e && (e.name === "NotAllowedError" || /permission|denied/i.test(String(e.message || "")));
      toast(denied ? t("teacher.micDenied") : e.code === "no-minutes" ? t("teacher.noMinutes") : e.code === "plan" ? t("teacher.voicePlan") : t("teacher.busy"), "bad");
      if (call.sessionId) report(null);
    }
  }
  const onHide = () => { if (call.conv) hangUp(); };
  addEventListener("pagehide", onHide);

  paint();
  const off = onAct(root, {
    tab: (el) => { tab = el.dataset.t; result = null; paint(); },
    mic: () => {
      if (listening && rec) { rec.stop(); return; }
      rec = recognizer({ onText: (s) => { text = s; const ta = root.querySelector("#tq"); if (ta) ta.value = s; }, onEnd: () => { listening = false; paint(); } });
      if (!rec) return;
      listening = true; paint();
      try { rec.start(); } catch { listening = false; paint(); }
    },
    send: async () => {
      if (!a.signedIn) { go("/app/signin"); return; }
      const v = (root.querySelector("#tq") || {}).value || text;
      if (!v.trim()) return;
      busy = true; text = v; paint();
      try { result = await api("ai", { method: "POST", body: { action: tab === "ask" ? "ask" : "check", text: v, lang: trLang() } }); }
      catch (e) { result = { error: e.code }; }
      busy = false; paint();
    },
    vstart: startCall,
    vend: hangUp,
  });
  return () => { off(); removeEventListener("pagehide", onHide); if (call.conv) hangUp(); if (rec) try { rec.abort(); } catch { /* ignore */ } };
}
