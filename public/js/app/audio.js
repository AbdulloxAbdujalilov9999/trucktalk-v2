/* Plays course phrases: the natural voice from /api/tts when it's set up (cached on the device after the first play),
 * otherwise the phone's built-in English voice. Never leaves the student in silence, and never hangs: the phone's voice
 * gets a time limit, because some phones (and headless browsers) never report the end of an utterance.
 * Languages: "en" (natural or device voice), "uz" (natural voice only: phones have no Uzbek voice), "ru" (device voice). */
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

const LOCALE = { en: "en-US", ru: "ru-RU" };
function pickVoice(lang = "en") {
  const vs = ("speechSynthesis" in window && speechSynthesis.getVoices()) || [];
  if (lang === "ru") return vs.find((x) => /^ru/i.test(x.lang)) || null;
  return vs.find((x) => /en[-_]US/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang)) || null;
}
// the voice list arrives a moment after the page loads on some phones: ask early, wait for it when it matters
if ("speechSynthesis" in window) { try { speechSynthesis.getVoices(); } catch { /* ignore */ } }
function voicesReady(timeout = 1500) {
  if (speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { clearTimeout(timer); speechSynthesis.removeEventListener("voiceschanged", done); res(); };
    const timer = setTimeout(done, timeout);
    speechSynthesis.addEventListener("voiceschanged", done);
  });
}

/** Can this phone say something in this language? (Uzbek only with the natural voice.) */
export async function canSpeak(lang) {
  if (lang === "uz") return naturalOn();
  if (!("speechSynthesis" in window)) return false;
  if (lang === "en") return true;
  try { await voicesReady(); } catch { /* ignore */ }
  return !!pickVoice(lang);
}

function deviceSpeak(text, lang, rate) {
  if (!("speechSynthesis" in window) || !LOCALE[lang]) return Promise.resolve("failed");
  const v = pickVoice(lang);
  if (lang !== "en" && !v) return Promise.resolve("failed");
  return new Promise((resolve) => {
    pending = resolve;
    const say = spoken(text);
    const u = new SpeechSynthesisUtterance(say);
    u.lang = LOCALE[lang]; u.rate = rate;
    if (v) u.voice = v;
    let started = false, timer = 0;
    const end = (r) => { clearTimeout(timer); if (pending === resolve) settle(r); };
    u.onstart = () => { started = true; };
    u.onend = () => end("played"); u.onerror = () => end("failed");
    // the time limit: a generous guess of how long the phrase takes, then a while longer if the phone is still at it
    const guess = 2500 + (say.length * 90) / Math.max(0.5, rate), deadline = Date.now() + Math.max(15000, 3 * guess);
    const check = () => {
      if (pending !== resolve) return;
      if ((speechSynthesis.speaking || speechSynthesis.pending) && Date.now() < deadline) { timer = setTimeout(check, 500); return; }
      end(started ? "played" : "failed");
    };
    timer = setTimeout(check, guess);
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
}

/** Plays a phrase. Resolves "played" | "stopped" | "failed".
 *  lang "en" (gender female|male), "uz" (the narrator: natural voice only) or "ru" (the phone's voice).
 *  device: true skips the natural voice (for text that isn't a course phrase). rate: extra speed factor (0.75 = slower). */
export async function play(text, { lang = "en", gender, device = false, rate: extra = 1 } = {}) {
  halt();
  const my = ++gen;
  const g = gender || setting("voice", "female");
  const rate = (Number(setting("rate", 1)) || 1) * (Number(extra) || 1);
  if (lang === "ru") return deviceSpeak(text, "ru", 0.95 * rate);
  if (!device && await naturalOn()) {
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

/** Waits ms, unless a stop/play ends the run first. Resolves true when the wait ran to the end. */
export function pause(ms) {
  const my = seq;
  return new Promise((res) => {
    const t0 = Date.now();
    const tick = () => { if (my !== seq) return res(false); if (Date.now() - t0 >= ms) return res(true); setTimeout(tick, Math.min(200, ms)); };
    setTimeout(tick, Math.min(200, ms));
  });
}

/** A new run: ends any playAll/run in progress and returns a function telling whether this run is still the current one. */
export function newRun() { const my = ++seq; return () => my === seq; }

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
