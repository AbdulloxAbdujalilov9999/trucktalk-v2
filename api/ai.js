/* The AI teacher.
 *   POST /api/ai {action:"check", text, day?, lang}   -> checks the student's English sentence
 *   POST /api/ai {action:"ask", text, lang}           -> a short answer to a question about English
 *   POST /api/ai {action:"roleplay", scene, history, text, lang, convo?}
 *                                                     -> conversation practice: feedback on the line + the next line
 *   POST /api/ai {action:"voice-start"}               -> { signedUrl, sessionId, maxSeconds }  live voice teacher (paid)
 *   POST /api/ai {action:"voice-end", sessionId, conversationId}
 * Limits per plan (public/js/shared/plans.js) and global daily budgets live in the database. */
import { endpoint, fail, readJson } from "../lib/http.js";
import { caller, requireActive } from "../lib/session.js";
import { tutor, roleplay } from "../lib/tutor.js";
import { startVoice, endVoice } from "../lib/voice.js";

export default endpoint(async (req) => {
  const b = await readJson(req, 16 * 1024);
  const c = requireActive(await caller(req));
  const action = String(b.action || "");
  let r;
  if (action === "check" || action === "ask") r = await tutor({ uid: c.uid, access: c.access, kind: action, text: b.text, day: Number.isInteger(b.day) ? b.day : null, lang: b.lang });
  else if (action === "roleplay") r = await roleplay({ uid: c.uid, access: c.access, scene: b.scene, history: b.history, text: b.text, lang: b.lang, convo: b.convo });
  else if (action === "voice-start") r = await startVoice(c.uid, c.access);
  else if (action === "voice-end") r = await endVoice(c.uid, b.sessionId, b.conversationId);
  else fail(400, "action");
  if (r.status) fail(r.status, r.error, r.limit ? { limit: r.limit } : undefined);
  return r;
}, { methods: ["POST"] });
