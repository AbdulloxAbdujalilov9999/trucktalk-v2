/* Admin and teacher API (role checked on every call; changes are admin-only and audited).
 *   GET  /api/admin?view=stats|users|user|payments|leads|audit|unmatched [&q=&filter=&uid=]
 *   POST /api/admin {action:"grant"|"revoke"|"role"|"block"|"note"|"reset-trial", ...} */
import { endpoint, fail, query, readJson } from "../lib/http.js";
import { caller, requireStaff } from "../lib/session.js";
import * as A from "../lib/admin.js";

export default endpoint(async (req) => {
  const c = requireStaff(await caller(req));
  const isAdmin = c.access.role === "admin";
  if (req.method === "GET") {
    const q = query(req);
    switch (q.view) {
      case "stats": { if (isAdmin) await A.housekeeping().catch((e) => console.error("housekeeping:", e.message)); return A.stats(); }
      case "users": return { users: await A.listUsers({ q: q.q, filter: q.filter }) };
      case "user": { const d = await A.userDetail(String(q.uid || "")); return d || fail(404, "no-user"); }
      case "payments": if (!isAdmin) fail(403, "admin-only"); return { payments: await A.recentPayments() };
      case "leads": return { leads: await A.recentLeads() };
      case "audit": if (!isAdmin) fail(403, "admin-only"); return { audit: await A.auditLog() };
      case "unmatched": if (!isAdmin) fail(403, "admin-only"); return { unmatched: await A.unmatchedPayments() };
      default: fail(400, "view");
    }
  }
  if (!isAdmin) fail(403, "admin-only");
  const b = await readJson(req);
  const by = c.uid;
  const uid = String(b.uid || "");
  let r;
  switch (b.action) {
    case "grant": r = await A.grant(by, uid, b); break;
    case "revoke": r = await A.revoke(by, String(b.paymentId || ""), b.reason); break;
    case "role": if (uid === by) fail(400, "own-role"); r = await A.setRole(by, uid, String(b.role || "")); break;
    case "block": if (uid === by) fail(400, "own-block"); r = await A.setBlocked(by, uid, !!b.blocked); break;
    case "note": r = await A.setNote(by, uid, b.note); break;
    case "reset-trial": r = await A.resetTrial(by, uid); break;
    default: fail(400, "action");
  }
  if (r.error) fail(400, r.error);
  return r;
});
