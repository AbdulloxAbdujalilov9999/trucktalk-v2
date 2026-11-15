/* The live voice teacher (ElevenLabs Conversational AI agent), with minutes counted by the server.
 *
 *   start: checks the plan's minutes for the last 30 days, reserves up to 10 minutes (charged right away), and returns a
 *          short-lived signed link the browser uses to talk to the private agent.
 *   end:   the browser reports the conversation id. The real duration is read from ElevenLabs itself (never from the
 *          browser), the session is charged min(reserved, real duration) and the rest goes back. A conversation id can
 *          settle only one session, and must belong to our agent and have started around the time of the reservation.
 *          Until a session is settled it costs the full reservation, so closing the tab or lying can't make calls free.
 * Env: ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID; optional VOICE_DAILY_MINUTES (global budget, default 240). */
import { db, key } from "./db.js";
import { newId } from "./crypto.js";
import { take, giveBack } from "./limits.js";
import { int } from "./env.js";

export const MAX_CALL_S = 600;          // keep equal to conversation.max_duration_seconds in elevenlabs/teacher.agent.json
const WINDOW_MS = 30 * 24 * 3600 * 1000;
const MAX_SESSIONS_PER_DAY = 8;

export const voiceConfigured = () => !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID);

/** Seconds a session counts for. */
export const charged = (s) => (s ? Math.max(0, Number(s.charged ?? s.granted) || 0) : 0);

export function balance(sessions, limitMin, now = Date.now()) {
  const limit = Math.max(0, limitMin) * 60;
  let used = 0;
  for (const s of Object.values(sessions || {})) if (s && s.startedAt > now - WINDOW_MS) used += charged(s);
  return { limit, used, left: Math.max(0, limit - used) };
}

async function sessionsOf(uid) { return (await db().get("voice/" + key(uid))) || {}; }

export async function voiceStatus(uid, access, now = Date.now()) {
  const b = balance(await sessionsOf(uid), access.limits.voiceMin, now);
  return { configured: voiceConfigured(), minutesLeft: Math.floor(b.left / 60), minutesLimit: Math.floor(b.limit / 60) };
}

export async function startVoice(uid, access, now = Date.now()) {
  if (!voiceConfigured()) return { status: 503, error: "not-configured" };
  if (!(access.limits.voiceMin > 0)) return { status: 402, error: "plan" };
  const sessions = await sessionsOf(uid);
  await settleOpen(uid, sessions, now);
  const b = balance(sessions, access.limits.voiceMin, now);
  if (b.left < 30) return { status: 402, error: "no-minutes" };
  const today = Object.values(sessions).filter((s) => s && s.startedAt > now - 24 * 3600 * 1000).length;
  if (today >= MAX_SESSIONS_PER_DAY) return { status: 429, error: "slow-down" };
  const granted = Math.min(MAX_CALL_S, b.left);
  const global = await take("voice/_seconds", int("VOICE_DAILY_MINUTES", 240) * 60, { amount: granted, now });
  if (!global.ok) return { status: 503, error: "busy" };

  let signedUrl = "";
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=" + encodeURIComponent(process.env.ELEVENLABS_AGENT_ID),
      { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
    if (r.ok) signedUrl = String((await r.json()).signed_url || "");
    else console.error("voice: ElevenLabs answered " + r.status);
  } catch (e) { console.error("voice: unreachable", e.message); }
  if (!/^wss:\/\//.test(signedUrl)) { await giveBack("voice/_seconds", { amount: granted, now }); return { status: 503, error: "upstream" }; }

  const id = newId("vs");
  await db().set(`voice/${key(uid)}/${id}`, { startedAt: now, granted, charged: granted, status: "open" });
  return { signedUrl, sessionId: id, maxSeconds: granted, minutesLeft: Math.floor((b.left - granted) / 60) };
}

/** Reads a conversation from ElevenLabs: { done, seconds, startS } or null. */
async function conversation(convId) {
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/convai/conversations/" + encodeURIComponent(convId), { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
    if (!r.ok) return null;
    const c = await r.json();
    if (c.agent_id !== process.env.ELEVENLABS_AGENT_ID) return { foreign: true };
    const m = c.metadata || {};
    return { done: c.status === "done" || c.status === "failed", seconds: Math.ceil(Number(m.call_duration_secs) || 0), startS: Number(m.start_time_unix_secs) || 0 };
  } catch { return null; }
}

async function settle(uid, sid, s, now) {
  if (!s || s.status !== "open" || !s.conversationId) return s;
  const c = await conversation(s.conversationId);
  if (!c || c.foreign || !c.done) {
    if (c && c.foreign) await db().update(`voice/${key(uid)}/${key(sid)}`, { status: "rejected" });
    return s;
  }
  const near = !c.startS || Math.abs(c.startS * 1000 - s.startedAt) < 10 * 60 * 1000;
  const used = near ? Math.min(s.granted, c.seconds) : s.granted;
  const back = s.granted - used;
  await db().update(`voice/${key(uid)}/${key(sid)}`, { charged: used, status: "settled", settledAt: now });
  if (back > 0) await giveBack("voice/_seconds", { amount: back, now: s.startedAt });
  return { ...s, charged: used, status: "settled" };
}

async function settleOpen(uid, sessions, now) {
  for (const [sid, s] of Object.entries(sessions)) {
    if (s && s.status === "open" && s.conversationId && now - s.startedAt > 20 * 1000) sessions[sid] = await settle(uid, sid, s, now);
  }
}

export async function endVoice(uid, sessionId, conversationId, now = Date.now()) {
  if (!/^vs[a-z0-9]{6,40}$/.test(String(sessionId || ""))) return { status: 400, error: "session" };
  const path = `voice/${key(uid)}/${sessionId}`;
  const s = await db().get(path);
  if (!s) return { status: 404, error: "session" };
  if (s.status !== "open") return { settled: true, seconds: charged(s) };
  if (!s.conversationId) {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(conversationId || ""))) return { settled: false };
    const claimed = await db().createOnce("voiceConversations/" + conversationId, { uid, sessionId, at: now });
    if (!claimed) return { status: 409, error: "conversation-used" };
    await db().update(path, { conversationId });
    s.conversationId = conversationId;
  }
  const after = await settle(uid, sessionId, s, now);
  return { settled: after.status === "settled", seconds: charged(after) };
}
