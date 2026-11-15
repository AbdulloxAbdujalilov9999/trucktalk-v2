/* GET /api/content?kind=day&id=12   GET /api/content?kind=grammar&id=to-be
 * The lesson without its quiz answers. Free lessons for everyone; the rest for trial, paid and staff accounts.
 * GET /api/content?kind=words  -> the words of every day this person may open (for review and the phrasebook). */
import { endpoint, fail, query, raw } from "../lib/http.js";
import { caller } from "../lib/session.js";
import { isFree, mayOpen, publicItem, teacherNotes, wordsFor } from "../lib/content.js";

export default endpoint(async (req) => {
  const q = query(req);
  if (q.kind === "words") {
    const c = await caller(req, { optional: true });
    return raw({ words: wordsFor(c.access), full: !!c.access.full }, 200, { "cache-control": "private, no-store" });
  }
  const kind = q.kind === "day" || q.kind === "grammar" ? q.kind : fail(400, "kind");
  const id = kind === "day" ? (/^-?\d{1,3}$/.test(String(q.id)) ? Number(q.id) : fail(400, "id")) : (/^[a-z0-9-]{1,40}$/.test(String(q.id)) ? String(q.id) : fail(400, "id"));
  const free = isFree(kind, id);
  const c = free ? { access: { full: false } } : await caller(req, { optional: true });
  const item = publicItem(kind, id);
  if (!item) fail(404, "not-found");
  if (!free && !mayOpen(c.access, kind, id)) fail(c.uid ? 402 : 401, c.uid ? "locked" : "sign-in");
  const out = { kind, id, free, item };
  if (kind === "grammar" && c.access && c.access.staff) out.teach = teacherNotes(id);
  return raw(out, 200, { "cache-control": free ? "public, max-age=600, s-maxage=3600" : "private, no-store" });
}, { methods: ["GET"] });
