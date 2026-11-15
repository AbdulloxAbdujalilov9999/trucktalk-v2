/* GET /api/progress -> the stored progress.   POST /api/progress {progress} -> merged with what's stored, saved, returned.
 * This is what makes a new phone show your progress (the old app never loaded it back). */
import { endpoint, readJson } from "../lib/http.js";
import { caller, requireActive } from "../lib/session.js";
import { db, key } from "../lib/db.js";
import { merge, sanitize } from "../public/js/shared/progress.js";

export default endpoint(async (req) => {
  const c = requireActive(await caller(req));
  const path = "progress/" + key(c.uid);
  if (req.method === "GET") return { progress: sanitize(await db().get(path)) };
  const b = await readJson(req, 512 * 1024);
  const incoming = sanitize(b.progress);
  const r = await db().transaction(path, (cur) => sanitize(merge(sanitize(cur), incoming)));
  return { progress: r.value };
});
