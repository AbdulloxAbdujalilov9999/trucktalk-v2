/* POST /api/quiz {kind:"day"|"grammar", id, answers:[optionIndex|null...]}  -> { score, total, results:[{correct, answer}] }
 * Graded here: the answers never travel to the browser before the student answers. A signed-in student's best result is
 * kept in results/<uid> (that is what teachers see, not anything the browser claims). */
import { endpoint, fail, readJson, clientIp } from "../lib/http.js";
import { caller } from "../lib/session.js";
import { grade, mayOpen } from "../lib/content.js";
import { db, key } from "../lib/db.js";
import { memoryLimiter } from "../lib/limits.js";

const limiter = memoryLimiter({ max: 60, windowMs: 10 * 60 * 1000 });

export default endpoint(async (req) => {
  const b = await readJson(req, 8 * 1024);
  const kind = b.kind === "day" || b.kind === "grammar" ? b.kind : fail(400, "kind");
  const id = kind === "day" ? (Number.isInteger(b.id) ? b.id : fail(400, "id")) : (/^[a-z0-9-]{1,40}$/.test(String(b.id)) ? String(b.id) : fail(400, "id"));
  const c = await caller(req, { optional: true });
  if (c.access.blocked) fail(403, "blocked");
  if (!limiter(c.uid || clientIp(req))) fail(429, "slow-down");
  if (!mayOpen(c.access, kind, id)) fail(c.uid ? 402 : 401, c.uid ? "locked" : "sign-in");
  const r = grade(kind, id, b.answers);
  if (!r) fail(404, "not-found");
  if (r.error) fail(400, r.error);
  if (c.uid) {
    const now = Date.now();
    await db().transaction(`results/${key(c.uid)}/${kind}:${id}`, (cur) => ({
      best: Math.max((cur && cur.best) || 0, r.score), last: r.score, total: r.total, attempts: ((cur && cur.attempts) || 0) + 1, at: now,
      first: (cur && cur.first) || now,
    }));
  }
  return r;
}, { methods: ["POST"] });
