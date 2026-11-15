/* App state: the signed-in person (from /api/me), progress (local copy + cloud sync) and settings. */
import { api } from "./api.js";
import { currentUser } from "./auth.js";
import { EMPTY, merge, sanitize, dayKey, xpByDay, addCard } from "../shared/progress.js";

const P_KEY = (uid) => "tt2:p:" + (uid || "anon");
const DEVICE_KEY = "tt2:device";

export const state = {
  me: { user: null, access: { tier: "anon", full: false, signedIn: false, limits: { ai: 0, voiceMin: 0 } } },
  progress: EMPTY(),
  sync: "idle",          // idle | saving | saved | failed | offline
  syncedAt: 0,
};
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } }

export const device = (() => {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d || !/^[a-z0-9]{6,24}$/.test(d)) { d = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6); localStorage.setItem(DEVICE_KEY, d); }
    return d;
  } catch { return "nostorage1"; }
})();

function readLocal(uid) {
  try { const s = localStorage.getItem(P_KEY(uid)); return s ? sanitize(JSON.parse(s)) : EMPTY(); } catch { return EMPTY(); }
}
function writeLocal(uid, p) { try { localStorage.setItem(P_KEY(uid), JSON.stringify(p)); } catch { /* storage full or blocked */ } }

const uidNow = () => (currentUser() && currentUser().uid) || null;

/** Loads progress for whoever is signed in now; on a fresh sign-in, anonymous progress is folded in. */
export async function loadProgress() {
  const uid = uidNow();
  let p = readLocal(uid);
  if (uid) {
    const anon = readLocal(null);
    if (Object.keys(anon.days).length || Object.keys(anon.srs).length || Object.keys(anon.videos).length || Object.keys(anon.xp).length) {
      p = merge(p, anon);
      try { localStorage.removeItem(P_KEY(null)); } catch { /* ignore */ }
    }
  }
  state.progress = p;
  writeLocal(uid, p);
  emit();
  if (uid) await syncNow();
}

let syncTimer = null, syncing = null;
export function scheduleSync(ms = 2500) {
  if (!uidNow()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow(); }, ms);
}
export async function syncNow() {
  const uid = uidNow();
  if (!uid) return;
  if (syncing) return syncing;
  state.sync = "saving"; emit();
  syncing = (async () => {
    try {
      const r = await api("progress", { method: "POST", body: { progress: state.progress } });
      if (uidNow() !== uid) return;
      state.progress = merge(state.progress, r.progress);
      writeLocal(uid, state.progress);
      state.sync = "saved"; state.syncedAt = Date.now();
    } catch (e) {
      state.sync = e.code === "network" ? "offline" : "failed";
    } finally { syncing = null; emit(); }
  })();
  return syncing;
}
addEventListener("online", () => scheduleSync(500));
addEventListener("pagehide", () => { if (uidNow() && state.sync !== "saved") syncNow(); });

/** Changes progress: fn(p) mutates a copy. Saves locally at once and to the cloud shortly after. */
export function update(fn) {
  const p = JSON.parse(JSON.stringify(state.progress));
  fn(p);
  state.progress = sanitize(p);
  writeLocal(uidNow(), state.progress);
  state.sync = uidNow() ? "pending" : "idle";
  emit();
  scheduleSync();
}

export function addXp(n) {
  if (!(n > 0)) return;
  update((p) => {
    const k = dayKey();
    p.xp[device] = p.xp[device] || {};
    p.xp[device][k] = (p.xp[device][k] || 0) + Math.round(n);
  });
}
export function xpToday() { return xpByDay(state.progress)[dayKey()] || 0; }
export function goal() { return (state.progress.goal && state.progress.goal.v) || 30; }
export function setting(name, fallback) { const s = state.progress.set && state.progress.set[name]; return s ? s.v : fallback; }
export function setSetting(name, v) { update((p) => { p.set[name] = { v, u: Date.now() }; }); }

export function markStep(n, step) {
  update((p) => {
    const d = (p.days[n] = p.days[n] || { s: {} });
    d.s = d.s || {};
    if (!d.s[step]) d.s[step] = Date.now();
  });
}
export function markDayDone(n) { update((p) => { const d = (p.days[n] = p.days[n] || { s: {} }); if (!d.done) d.done = Date.now(); }); }
export function addCards(ids) { update((p) => { const now = Date.now(); ids.forEach((id) => addCard(p, id, now)); }); }

export async function refreshMe() {
  try { state.me = await api("me"); }
  catch (e) { if (e.status === 401) state.me = { user: null, access: { tier: "anon", full: false, signedIn: false, limits: { ai: 0, voiceMin: 0 } } }; }
  emit();
  return state.me;
}
export const access = () => state.me.access;
