/* The signed-in person.
 *   GET  /api/me                              -> { user, access, voice }   (anonymous: { user: null, access })
 *   POST /api/me {action:"start-trial"}       -> starts the one free trial
 *   POST /api/me {action:"update", name, lang}
 *   POST /api/me {action:"telegram-login", token}  -> { customToken }   (no sign-in needed: the one-time link proves who)
 *   POST /api/me {action:"telegram-link"}     -> { url }  open it to connect Telegram to this account
 *   POST /api/me {action:"source", source}    -> remembers which video/link brought this person (first touch only) */
import { endpoint, fail, readJson, clientIp } from "../lib/http.js";
import { caller, requireActive } from "../lib/session.js";
import { db, key } from "../lib/db.js";
import { publicProfile, startTrial, ensureUser } from "../lib/users.js";
import { createCustomToken } from "../lib/firebase.js";
import { redeemLogin, createLinkCode, botUsername } from "../lib/telegram.js";
import { voiceStatus } from "../lib/voice.js";
import { memoryLimiter } from "../lib/limits.js";

const loginLimiter = memoryLimiter({ max: 20, windowMs: 10 * 60 * 1000 });

async function view(c) {
  if (!c.uid) return { user: null, access: c.access };
  const voice = c.access.limits.voiceMin > 0 ? await voiceStatus(c.uid, c.access) : null;
  return { user: publicProfile(c.uid, c.profile), access: c.access, voice };
}

export default endpoint(async (req) => {
  if (req.method === "GET") return view(await caller(req, { optional: true }));
  const body = await readJson(req);
  const action = String(body.action || "");

  if (action === "telegram-login") {
    if (!loginLimiter(clientIp(req))) fail(429, "slow-down");
    const who = await redeemLogin(String(body.token || ""));
    if (!who) fail(400, "link-expired");
    await ensureUser({ uid: who.uid, provider: "telegram", name: who.name, telegramId: who.telegramId }, { telegramUsername: who.username, lang: who.lang, phone: who.phone });
    return { customToken: createCustomToken(who.uid, { tg: who.telegramId }) };
  }

  const c = requireActive(await caller(req));
  if (action === "start-trial") {
    const r = await startTrial(c.uid, c.profile);
    if (!r.ok) fail(409, r.error);
    return view(await caller(req));
  }
  if (action === "update") {
    const patch = {};
    if (typeof body.name === "string") patch.name = body.name.replace(/\s+/g, " ").trim().slice(0, 60) || null;
    if (["uz", "ru", "en"].includes(body.lang)) patch.lang = body.lang;
    if (Object.keys(patch).length) await db().update("users/" + key(c.uid), patch);
    return view(await caller(req));
  }
  if (action === "telegram-link") {
    if (!botUsername()) fail(503, "not-configured");
    const code = await createLinkCode(c.uid);
    return { url: `https://t.me/${botUsername()}?start=link_${code}` };
  }
  if (action === "source") {
    const s = String(body.source || "");
    if (/^[a-z0-9_-]{1,40}$/i.test(s) && !c.profile.source) await db().update("users/" + key(c.uid), { source: s.toLowerCase() });
    return { ok: true };
  }
  fail(400, "action");
});
