/* Demo mode only (DEMO_MODE=1 and no database configured): pretend sign-in and pretend payments, so the whole app can be
 * tried with nothing set up. Answers 404 everywhere else.
 *   POST /api/dev {action:"login", as:"student"|"admin"|"teacher", name?}  -> { token }
 *   POST /api/dev {action:"pay", plan}   -> records a demo payment for the signed-in demo account */
import { endpoint, fail, readJson } from "../lib/http.js";
import { isDemo } from "../lib/env.js";
import { createDemoToken } from "../lib/firebase.js";
import { caller } from "../lib/session.js";
import { db } from "../lib/db.js";
import { recordPayment } from "../lib/payments/ledger.js";
import { newId } from "../lib/crypto.js";
import { planById } from "../public/js/shared/plans.js";

export default endpoint(async (req) => {
  if (!isDemo()) fail(404, "not-found");
  const b = await readJson(req);
  if (b.action === "login") {
    const as = ["student", "teacher", "admin"].includes(b.as) ? b.as : "student";
    const uid = as === "student" ? "demo" + String(b.id || newId()).replace(/[^a-z0-9]/gi, "").slice(-10) : "demo" + as;
    const name = String(b.name || (as === "student" ? "Demo Driver" : as === "admin" ? "Demo Admin" : "Demo Teacher")).slice(0, 40);
    const email = as === "student" ? uid + "@demo.trucktalk" : as + "@demo.trucktalk";
    const token = createDemoToken(uid, { email, name, provider: "demo" });
    if (as !== "student") {
      await db().update("users/" + uid, { role: as, name, email, emailVerified: true, provider: "demo", createdAt: Date.now() });
    }
    return { token };
  }
  if (b.action === "pay") {
    const c = await caller(req);
    const plan = planById(b.plan) ? b.plan : fail(400, "plan");
    await recordPayment(c.uid, "demo_" + newId(), { provider: "demo", plan, amount: planById(plan).usd, currency: "USD" });
    return { ok: true };
  }
  fail(400, "action");
}, { methods: ["POST"] });
