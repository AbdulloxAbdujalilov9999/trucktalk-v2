/* Plays course phrases: the natural voice from /api/tts when it's set up (cached on the device after the first play),
 * otherwise the phone's built-in English voice. Never leaves the student in silence. */
import { ttsQuery, spoken } from "../shared/text.js";
import { config } from "./api.js";
import { setting } from "./store.js";

const CACHE = "tt2-voice-v1";
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
let audio = null, natural = null, disabledUntil = 0, gen = 0, seq = 0, unlocked = false, pending = null;

function el() { if (!audio) { audio = new Audio(); audio.preload = "auto"; } return audio; }
function unlock() {
  if (unlocked) return; unlocked = true;
  try { const a = el(); a.src = SILENT; const p = a.play(); if (p && p.catch) p.catch(() => { unlocked = false; }); } catch { unlocked = false; }
}
["pointerdown", "touchend", "keydown"].forEach((ev) => document.addEventListener(ev, unlock, { capture: true, passive: true }));

function settle(r) { const p = pending; pending = null; if (p) p(r); }

async function naturalOn() {
  if (natural === null) { const c = await config(); natural = !!(c.features && c.features.naturalVoice); }
  return natural && Date.now() > disabledUntil;
}

async function blobFor(url) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return await hit.blob(); } catch { cache = null; }
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) { if (r.status === 503) disabledUntil = Date.now() + 10 * 60 * 1000; throw new Error("tts " + r.status); }
    if (cache) { try { await cache.put(url, r.clone()); } catch { /* quota */ } }
    return await r.blob();
  } finally { clearTimeout(timer); }
}

function pickVoice() {
  const vs = ("speechSynthesis" in window && speechSynthesis.getVoices()) || [];
  return vs.find((x) => /en[-_]US/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang)) || null;
}

function deviceSpeak(text, lang, rate) {
  if (!("speechSynthesis" in window) || lang === "uz") return Promise.resolve("failed");
  return new Promise((resolve) => {
    pending = resolve;
    const u = new SpeechSynthesisUtterance(spoken(text));
    u.lang = "en-US"; u.rate = rate;
    const v = pickVoice(); if (v) u.voice = v;
    u.onend = () => settle("played"); u.onerror = () => settle("failed");
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
}

/** Plays a phrase. lang "en" (gender female|male) or "uz" (the narrator). Resolves "played" | "stopped" | "failed". */
export async function play(text, { lang = "en", gender } = {}) {
  halt();
  const my = ++gen;
  const g = gender || setting("voice", "female");
  const rate = Number(setting("rate", 1)) || 1;
  if (await naturalOn()) {
    try {
      const blob = await blobFor("/api/tts?" + ttsQuery(text, { lang, gender: g }));
      if (my !== gen) return "stopped";
      const a = el();
      const url = URL.createObjectURL(blob);
      const done = new Promise((res) => { pending = res; a.onended = () => settle("played"); a.onerror = () => settle("failed"); });
      a.src = url; a.playbackRate = rate;
      await a.play();
      const r = await done;
      URL.revokeObjectURL(url);
      if (r !== "failed") return r;
    } catch { /* fall back to the device voice */ }
    if (my !== gen) return "stopped";
  }
  return deviceSpeak(text, lang, 0.92 * rate);
}

function halt() {
  settle("stopped");
  try { if (audio) audio.pause(); } catch { /* ignore */ }
  try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch { /* ignore */ }
}

/** Silences everything now and ends a playAll run. */
export function stop() { gen++; seq++; halt(); }

/** Plays a list one after another; onLine(i) before each (and -1 at the end). Any other play/stop ends the run. */
export async function playAll(items, onLine) {
  const my = ++seq;
  for (let i = 0; i < items.length; i++) {
    if (my !== seq) break;
    if (onLine) onLine(i);
    const r = await play(items[i].text, items[i]);
    if (my !== seq || r === "stopped") break;
    await new Promise((res) => setTimeout(res, 350));
  }
  if (onLine) onLine(-1);
  return my === seq ? "played" : "stopped";
}
