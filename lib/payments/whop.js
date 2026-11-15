/* Whop: checkout links for one signed-in account, and the webhook that turns payments, refunds and disputes into access.
 *
 * Env: WHOP_API_KEY, WHOP_WEBHOOK_SECRET, and one Whop plan id per app plan:
 *   WHOP_PLAN_SELF_MONTH, WHOP_PLAN_SELF_QUARTER, WHOP_PLAN_PRO_MONTH, WHOP_PLAN_PRO_QUARTER
 * Webhook events to enable: payment.succeeded, payment.refunded, refund.created, refund.updated, dispute.created,
 * dispute.updated, membership.activated (see docs/SETUP.md).
 * Signature scheme: Standard Webhooks (webhook-id / webhook-timestamp / webhook-signature, HMAC-SHA256 over
 * "id.timestamp.body", base64, "v1,<sig>"), 5 minute replay window. */
import crypto from "node:crypto";
import { db, key } from "../db.js";
import { PLANS, planById } from "../../public/js/shared/plans.js";
import { recordPayment, setStatus } from "./ledger.js";

const TOLERANCE_S = 5 * 60;

/** app plan id -> Whop plan id, from env. Only these Whop plans ever grant access. */
export function whopPlans(env = process.env) {
  const out = {};
  for (const p of PLANS) { const v = env["WHOP_PLAN_" + p.id.toUpperCase()]; if (v) out[p.id] = v; }
  return out;
}
export const whopConfigured = (env = process.env) => !!(env.WHOP_API_KEY && Object.keys(whopPlans(env)).length);

function secretKeys(secret) {
  const keys = [Buffer.from(secret, "utf8")];
  const m = /^(?:ws|whsec)_(.+)$/.exec(secret);
  if (m && /^[A-Za-z0-9+/=_-]+$/.test(m[1])) { try { const b = Buffer.from(m[1], "base64"); if (b.length >= 16) keys.push(b); } catch { /* ignore */ } }
  return keys;
}

/** Standard Webhooks signature check. headers: plain object with lower-case names. */
export function verifyWebhook(headers, body, secret, nowS = Math.floor(Date.now() / 1000)) {
  const id = headers["webhook-id"] || "", ts = headers["webhook-timestamp"] || "", sigs = headers["webhook-signature"] || "";
  if (!secret || !id || !/^\d+$/.test(ts) || !sigs) return false;
  if (Math.abs(nowS - Number(ts)) > TOLERANCE_S) return false;
  const signed = Buffer.from(id + "." + ts + "." + body, "utf8");
  const given = String(sigs).split(" ").map((s) => s.split(",")).filter((p) => p[0] === "v1" && p[1]).map((p) => Buffer.from(p[1], "base64"));
  for (const k of secretKeys(secret)) {
    const want = crypto.createHmac("sha256", k).update(signed).digest();
    if (given.some((g) => g.length === want.length && crypto.timingSafeEqual(g, want))) return true;
  }
  return false;
}

/** A checkout for this account and plan; the uid rides along in metadata so the webhook knows whose access to open. */
export async function createCheckout({ uid, plan, redirectUrl, env = process.env }) {
  const ids = whopPlans(env);
  if (!planById(plan) || !ids[plan]) return { error: "plan" };
  const r = await fetch("https://api.whop.com/api/v1/checkout_configurations", {
    method: "POST",
    headers: { authorization: "Bearer " + env.WHOP_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ plan_id: ids[plan], variant_id: ids[plan], mode: "payment", metadata: { uid, plan, app: "trucktalk-v2" }, redirect_url: redirectUrl }),
  });
  if (!r.ok) { console.error("whop checkout " + r.status + " " + (await r.text().catch(() => "")).slice(0, 300)); return { error: "upstream-" + r.status }; }
  let url = "";
  try { url = String((await r.json()).purchase_url || ""); } catch { /* ignore */ }
  if (url.startsWith("/")) url = "https://whop.com" + url;
  if (!/^https:\/\/([a-z0-9-]+\.)*whop\.com\//i.test(url)) return { error: "bad-link" };
  return { url };
}

const safe = (s) => (typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : null);
const pick = (...xs) => xs.find((x) => x != null && x !== "");

export function readPayment(d) {
  const membership = d.membership && typeof d.membership === "object" ? d.membership : {};
  const plan = d.plan && typeof d.plan === "object" ? d.plan : {};
  const user = d.user && typeof d.user === "object" ? d.user : {};
  const meta = Object.assign({}, membership.metadata || {}, (d.checkout_configuration && d.checkout_configuration.metadata) || {}, d.metadata || {});
  return {
    id: safe(d.id),
    uid: safe(meta.uid),
    meta,
    membershipId: safe(pick(d.membership_id, membership.id, typeof d.membership === "string" ? d.membership : null)),
    whopUserId: safe(pick(d.user_id, user.id)),
    whopPlanId: pick(d.plan_id, plan.id, typeof d.plan === "string" ? d.plan : null) || null,
    paymentRef: safe(pick(d.payment_id, d.payment && d.payment.id)),
    amount: pick(d.final_amount, d.total, d.amount, d.subtotal, d.usd_total) ?? null,
    currency: pick(d.currency, d.currency_code) || null,
    status: d.status || null,
    email: typeof user.email === "string" ? user.email.slice(0, 200) : null,
    whopUsername: typeof user.username === "string" ? user.username.slice(0, 80) : null,
  };
}

/** Which app plan a Whop payment is for. A Whop plan id that isn't one of ours means "not ours": ignored. */
export function planFor(p, env = process.env) {
  const ids = whopPlans(env);
  if (p.whopPlanId) return Object.keys(ids).find((k) => ids[k] === p.whopPlanId) || null;
  return planById(p.meta && p.meta.plan) && ids[p.meta.plan] ? p.meta.plan : null;
}

async function ownerOf(p) {
  if (p.uid && (await db().get("users/" + key(p.uid)))) return p.uid;
  if (p.membershipId) { const u = safe(await db().get("whop/memberships/" + key(p.membershipId))); if (u) return u; }
  if (p.whopUserId) { const u = safe(await db().get("whop/users/" + key(p.whopUserId))); if (u) return u; }
  return null;
}

async function onPayment(d, env, now) {
  const p = readPayment(d);
  if (!p.id) return "ignored";
  const plan = planFor(p, env);
  if (!plan) return "not-ours";
  const uid = await ownerOf(p);
  if (!uid) {
    await db().set("whop/unmatched/" + key(p.id), strip({ plan, membership: p.membershipId, whopUser: p.whopUserId, email: p.email, username: p.whopUsername, amount: p.amount, currency: p.currency, at: now }));
    return "unmatched";
  }
  const links = {};
  if (p.membershipId) links["whop/memberships/" + p.membershipId] = uid;
  if (p.whopUserId) links["whop/users/" + p.whopUserId] = uid;
  if (Object.keys(links).length) await db().update("", links);
  const created = await recordPayment(uid, "whop_" + p.id, { provider: "whop", plan, amount: p.amount, currency: p.currency, extra: strip({ membership: p.membershipId }) }, now);
  await db().remove("whop/unmatched/" + key(p.id));
  return created ? "applied" : "duplicate";
}

// payment.refunded carries the payment itself; refund.* and dispute.* objects point at their payment.
async function onRefund(d, isPayment, now) {
  const p = readPayment(d);
  const payId = isPayment ? p.id : p.paymentRef;
  if (!payId) return "ignored";
  const st = String(d.status || "").toLowerCase();
  if (!isPayment && st && !/succeed|complete|refunded|approved/.test(st)) return "refund-" + st;   // pending / failed / canceled
  const r = await setStatus("whop_" + payId, "refunded", { reason: "whop-refund" }, now);
  return r.found ? "refunded" : "unknown-payment";
}

async function onDispute(d, now) {
  const p = readPayment(d);
  if (!p.paymentRef) return "ignored";
  const st = String(d.status || "").toLowerCase();
  const status = /won/.test(st) ? "paid" : "disputed";        // access pauses while a dispute is open, returns if we win
  const r = await setStatus("whop_" + p.paymentRef, status, { reason: "whop-dispute-" + (st || "open"), onlyFrom: status === "paid" ? ["disputed"] : null }, now);
  return r.found ? (status === "paid" ? "dispute-won" : "disputed") : "unknown-payment";
}

async function onMembership(d, env, now) {
  const m = readPayment(d);
  const membershipId = safe(d.id) || m.membershipId;
  const uid = m.uid && (await db().get("users/" + key(m.uid))) ? m.uid : membershipId ? safe(await db().get("whop/memberships/" + key(membershipId))) : null;
  if (!uid) return "ignored";
  const links = {};
  if (membershipId) links["whop/memberships/" + membershipId] = uid;
  if (m.whopUserId) links["whop/users/" + m.whopUserId] = uid;
  if (Object.keys(links).length) await db().update("", links);
  const waiting = (await db().get("whop/unmatched")) || {};
  let settled = 0;
  for (const [payId, w] of Object.entries(waiting)) {
    if (!w || !((membershipId && w.membership === membershipId) || (m.whopUserId && w.whopUser === m.whopUserId))) continue;
    if (await recordPayment(uid, "whop_" + payId, { provider: "whop", plan: w.plan, amount: w.amount ?? null, currency: w.currency ?? null }, now)) settled++;
    await db().remove("whop/unmatched/" + key(payId));
  }
  return settled ? "settled-" + settled : "linked";
}

/** Handles one verified webhook delivery exactly once (by webhook-id). */
export async function handleWebhook(webhookId, event, env = process.env, now = Date.now()) {
  const first = await db().createOnce("whop/events/" + key(safe(webhookId) || "x"), { at: now, type: String(event && event.type || "").slice(0, 60) });
  if (!first) return "duplicate-delivery";
  const type = String((event && event.type) || "").replace(/_/g, ".");
  const data = event && event.data && typeof event.data === "object" ? event.data : {};
  try {
    if (type === "payment.succeeded") return await onPayment(data, env, now);
    if (type === "payment.refunded") return await onRefund(data, true, now);
    if (type === "refund.created" || type === "refund.updated") return await onRefund(data, false, now);
    if (type === "dispute.created" || type === "dispute.updated") return await onDispute(data, now);
    if (type === "membership.activated" || type === "membership.went.valid") return await onMembership(data, env, now);
    return "ignored";
  } catch (e) {
    await db().remove("whop/events/" + key(safe(webhookId) || "x"));   // let Whop's retry try again
    throw e;
  }
}

function strip(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)); }
