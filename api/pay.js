/* POST /api/pay {plan}  -> { url }  a checkout for this signed-in account (Whop), or the demo checkout in demo mode.
 * Access opens when the payment provider's webhook says the payment went through (api/webhooks.js), never because the
 * browser came back from checkout. */
import { endpoint, fail, readJson } from "../lib/http.js";
import { caller, requireActive } from "../lib/session.js";
import { createCheckout, whopConfigured } from "../lib/payments/whop.js";
import { planById } from "../public/js/shared/plans.js";
import { appUrl, isDemo } from "../lib/env.js";
import { memoryLimiter } from "../lib/limits.js";

const limiter = memoryLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

export default endpoint(async (req) => {
  const b = await readJson(req);
  const plan = planById(b.plan) ? b.plan : fail(400, "plan");
  const c = requireActive(await caller(req));
  if (c.access.staff) fail(400, "staff");
  if (!limiter(c.uid)) fail(429, "slow-down");
  if (isDemo()) return { url: "/app/pricing?demo_checkout=" + encodeURIComponent(plan), demo: true };
  if (!whopConfigured()) fail(503, "not-configured");
  const r = await createCheckout({ uid: c.uid, plan, redirectUrl: appUrl() + "/app/pricing?paid=1" });
  if (r.error) fail(r.error === "plan" ? 400 : 503, r.error);
  return { url: r.url };
}, { methods: ["POST"] });
