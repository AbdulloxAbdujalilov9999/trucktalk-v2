/* Who can open what: tiers, the one free trial, the payment ledger (refunds, disputes, stacking) and Whop webhooks. */
process.env.NODE_ENV = "test";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { memoryDb, setDb, db } from "../lib/db.js";
import { accessOf, ensureUser, startTrial } from "../lib/users.js";
import { computeAccess, recordPayment, recordManual, setStatus } from "../lib/payments/ledger.js";
import { verifyWebhook, handleWebhook, readPayment } from "../lib/payments/whop.js";
import { DAY_MS, TIERS } from "../public/js/shared/plans.js";
import { setRole } from "../lib/admin.js";

const NOW = Date.UTC(2026, 10, 15, 12);
beforeEach(() => setDb(memoryDb()));

test("tiers", () => {
  assert.equal(accessOf(null).tier, "anon");
  const free = accessOf({ createdAt: NOW, email: "a@x.com", emailVerified: true }, { now: NOW });
  assert.deepEqual([free.tier, free.full, free.canStartTrial, free.limits.ai], ["free", false, true, TIERS.free.ai]);
  const paid = accessOf({ tier: "self", paidUntil: NOW + 1000 }, { now: NOW });
  assert.deepEqual([paid.tier, paid.full, paid.canStartTrial], ["self", true, false]);
  assert.equal(accessOf({ tier: "self", paidUntil: NOW - 1 }, { now: NOW }).tier, "free", "expired plan");
  assert.equal(accessOf({ tier: "gold", paidUntil: NOW + 1000 }, { now: NOW }).tier, "free", "unknown tier is not paid");
  assert.equal(accessOf({ trial: { endsAt: NOW + 1 } }, { now: NOW }).tier, "trial");
  const blocked = accessOf({ blocked: true, tier: "pro", paidUntil: NOW + 1000 }, { now: NOW });
  assert.deepEqual([blocked.tier, blocked.full, blocked.limits.ai], ["blocked", false, 0]);
  assert.equal(accessOf({ role: "teacher" }, { now: NOW }).tier, "staff");
  assert.equal(accessOf({ role: "superuser" }, { now: NOW }).role, "student", "unknown role");
  assert.equal(accessOf({}, { now: NOW, envAdmin: true }).role, "admin");
});

test("trial: once per account", async () => {
  const p = await ensureUser({ uid: "u1", email: "A@X.com", emailVerified: true, provider: "google.com" }, {}, NOW);
  assert.equal(p.email, "a@x.com", "emails are stored lowercase");
  const r1 = await startTrial("u1", p, NOW);
  assert.ok(r1.ok);
  assert.equal(r1.trial.endsAt, NOW + 3 * DAY_MS);
  const again = await startTrial("u1", await db().get("users/u1"), NOW + 1000);
  assert.deepEqual(again, { ok: false, error: "trial-used" });
  // after it ends, still used
  const later = accessOf(await db().get("users/u1"), { now: NOW + 4 * DAY_MS });
  assert.deepEqual([later.tier, later.canStartTrial, later.trialUsed], ["free", false, true]);
});

test("trial: once per email / Telegram account, even with a new account", async () => {
  const a = await ensureUser({ uid: "g1", email: "driver@x.com", emailVerified: true }, {}, NOW);
  assert.ok((await startTrial("g1", a, NOW)).ok);
  const b = await ensureUser({ uid: "e2", email: "Driver@x.com", emailVerified: true }, {}, NOW);
  assert.deepEqual(await startTrial("e2", b, NOW), { ok: false, error: "trial-used" });
  const t1 = await ensureUser({ uid: "tg1", telegramId: 555, provider: "telegram" }, {}, NOW);
  assert.ok((await startTrial("tg1", t1, NOW)).ok);
  await db().update("users/g2", { createdAt: NOW, email: "other@x.com", emailVerified: true, telegramId: 555 });
  assert.deepEqual(await startTrial("g2", await db().get("users/g2"), NOW), { ok: false, error: "trial-used" }, "same Telegram");
});

test("trial: needs a verified identity; staff and payers don't get one", async () => {
  const anon = await ensureUser({ uid: "x1", provider: "custom" }, {}, NOW);
  assert.deepEqual(await startTrial("x1", anon, NOW), { ok: false, error: "verify-first" });
  const unverified = await ensureUser({ uid: "x2", email: "u@x.com", emailVerified: false }, {}, NOW);
  assert.deepEqual(await startTrial("x2", unverified, NOW), { ok: false, error: "verify-first" });
  assert.equal(accessOf({ role: "admin", email: "a@x.com", emailVerified: true }, { now: NOW }).canStartTrial, false);
});

test("ledger: plans stack, pro wins while active, refunds stop counting", () => {
  const pays = {
    a: { tier: "self", days: 30, at: NOW, status: "paid" },
    b: { tier: "self", days: 90, at: NOW + DAY_MS, status: "paid" },
    c: { tier: "pro", days: 30, at: NOW + 2 * DAY_MS, status: "paid" },
    d: { tier: "pro", days: 30, at: NOW + 3 * DAY_MS, status: "refunded" },
  };
  const a = computeAccess(pays, NOW + 3 * DAY_MS);
  assert.equal(a.tier, "pro");
  assert.equal(a.proUntil, NOW + 32 * DAY_MS);
  assert.equal(a.selfUntil, NOW + 120 * DAY_MS, "self days add on top of each other");
  assert.equal(computeAccess(pays, NOW + 40 * DAY_MS).tier, "self");
  assert.equal(computeAccess(pays, NOW + 121 * DAY_MS).tier, null);
  assert.equal(computeAccess({ x: { tier: "self", days: 30, at: NOW, status: "paid" } }, NOW + 31 * DAY_MS).paidUntil, NOW + 30 * DAY_MS, "expired date still reported");
});

test("ledger: a payment is recorded once; status changes recompute access", async () => {
  await ensureUser({ uid: "p1", email: "p@x.com", emailVerified: true }, {}, NOW);
  assert.equal(await recordPayment("p1", "whop_1", { provider: "whop", plan: "self_month", amount: 19, currency: "USD" }, NOW), true);
  assert.equal(await recordPayment("p1", "whop_1", { provider: "whop", plan: "self_month" }, NOW + 5), false, "same id twice");
  let u = await db().get("users/p1");
  assert.deepEqual([u.tier, u.paidUntil], ["self", NOW + 30 * DAY_MS]);
  await setStatus("whop_1", "disputed", {}, NOW + 10);
  u = await db().get("users/p1");
  assert.equal(accessOf(u, { now: NOW + 20 }).tier, "free", "access pauses during a dispute");
  assert.equal((await setStatus("whop_1", "paid", { onlyFrom: ["disputed"] }, NOW + 30)).found, true);
  assert.equal(accessOf(await db().get("users/p1"), { now: NOW + 40 }).tier, "self", "won dispute restores");
  await setStatus("whop_1", "refunded", {}, NOW + 50);
  await setStatus("whop_1", "paid", { onlyFrom: ["disputed"] }, NOW + 60);
  assert.equal(accessOf(await db().get("users/p1"), { now: NOW + 70 }).tier, "free", "a refund is not undone by a late dispute event");
  await assert.rejects(recordPayment("p1", "x", { provider: "whop", plan: "free_forever" }, NOW), /unknown plan/);
});

test("manual grants", async () => {
  await ensureUser({ uid: "m1" }, {}, NOW);
  await recordManual("m1", "man_1", { tier: "pro", days: 7, amount: 100000, currency: "UZS", by: "admin1" }, NOW);
  assert.equal(accessOf(await db().get("users/m1"), { now: NOW + DAY_MS }).tier, "pro");
  await assert.rejects(recordManual("m1", "man_2", { tier: "staff", days: 7, by: "a" }, NOW));
  await assert.rejects(recordManual("m1", "man_3", { tier: "self", days: 5000, by: "a" }, NOW));
});

test("staff roles only for accounts whose sign-in proved who they are", async () => {
  await ensureUser({ uid: "anonish" }, {}, NOW);
  await ensureUser({ uid: "g1", email: "T@Example.com", emailVerified: true }, {}, NOW);
  assert.equal((await db().get("users/g1")).email, "t@example.com", "emails are stored lowercased");
  assert.deepEqual(await setRole("admin1", "anonish", "teacher", NOW), { error: "unverified" });
  assert.deepEqual(await setRole("admin1", "g1", "teacher", NOW), { ok: true });
  assert.equal(accessOf(await db().get("users/g1"), { now: NOW }).tier, "staff");
  assert.deepEqual(await setRole("admin1", "anonish", "student", NOW), { ok: true }, "anyone can be set back to student");
  const log = Object.values((await db().get("audit")) || {});
  assert.ok(log.some((e) => e.action === "role" && e.target === "g1" && e.by === "admin1"), "role changes are in the audit log with who did it");
});

// ---------------------------------------------------------------- Whop
const SECRET = "ws_" + Buffer.from("super-secret-signing-key").toString("base64");
function sign(id, ts, body, secret = SECRET) {
  const key = Buffer.from(secret.replace(/^(ws_|whsec_)/, ""), "base64");
  return "v1," + crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

test("Whop webhook signatures (Standard Webhooks)", () => {
  const ts = Math.floor(NOW / 1000), body = '{"type":"payment.succeeded"}';
  const h = { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": sign("msg_1", ts, body) };
  assert.ok(verifyWebhook(h, body, SECRET, ts));
  assert.ok(verifyWebhook({ ...h, "webhook-signature": "v1,AAAA " + h["webhook-signature"] }, body, SECRET, ts), "one of several signatures");
  assert.ok(!verifyWebhook(h, body + " ", SECRET, ts), "body changed");
  assert.ok(!verifyWebhook(h, body, SECRET, ts + 3600), "too old");
  assert.ok(!verifyWebhook({ ...h, "webhook-id": "msg_2" }, body, SECRET, ts), "other id");
  assert.ok(!verifyWebhook(h, body, "", ts), "no secret configured");
  assert.ok(!verifyWebhook(h, body, "ws_" + Buffer.from("other").toString("base64"), ts));
});

const ENV = { WHOP_API_KEY: "k", WHOP_PLAN_SELF_MONTH: "plan_S1", WHOP_PLAN_PRO_QUARTER: "plan_P3" };
const payment = (over = {}) => ({ id: "pay_1", plan_id: "plan_S1", user_id: "user_9", membership_id: "mem_9", final_amount: 19, currency: "usd", metadata: { uid: "w1", plan: "self_month" }, ...over });

test("Whop: payment opens access exactly once; refund takes it away", async () => {
  await ensureUser({ uid: "w1", email: "w@x.com", emailVerified: true }, {}, NOW);
  assert.equal(await handleWebhook("evt_1", { type: "payment.succeeded", data: payment() }, ENV, NOW), "applied");
  assert.equal(await handleWebhook("evt_1", { type: "payment.succeeded", data: payment() }, ENV, NOW), "duplicate-delivery");
  assert.equal(await handleWebhook("evt_2", { type: "payment.succeeded", data: payment() }, ENV, NOW), "duplicate", "same payment, new delivery");
  assert.equal(accessOf(await db().get("users/w1"), { now: NOW + DAY_MS }).tier, "self");
  assert.equal(await handleWebhook("evt_3", { type: "refund.created", data: { id: "r1", payment: { id: "pay_1" }, status: "pending" } }, ENV, NOW), "refund-pending");
  assert.equal(await handleWebhook("evt_4", { type: "refund.updated", data: { id: "r1", payment: { id: "pay_1" }, status: "succeeded" } }, ENV, NOW), "refunded");
  assert.equal(accessOf(await db().get("users/w1"), { now: NOW + DAY_MS }).tier, "free");
});

test("Whop: the plan comes from Whop's plan id, not from metadata the buyer could edit", async () => {
  await ensureUser({ uid: "w1" }, {}, NOW);
  const r = await handleWebhook("evt_9", { type: "payment.succeeded", data: payment({ plan_id: "plan_SOMETHING_ELSE", metadata: { uid: "w1", plan: "pro_quarter" } }) }, ENV, NOW);
  assert.equal(r, "not-ours");
  assert.equal(accessOf(await db().get("users/w1"), { now: NOW }).tier, "free");
  const r2 = await handleWebhook("evt_10", { type: "payment.succeeded", data: payment({ id: "pay_2", plan_id: "plan_S1", metadata: { uid: "w1", plan: "pro_quarter" } }) }, ENV, NOW);
  assert.equal(r2, "applied");
  assert.equal(accessOf(await db().get("users/w1"), { now: NOW }).tier, "self", "paid for self, gets self");
});

test("Whop: a payment with no account waits, then attaches when the membership names the account", async () => {
  await ensureUser({ uid: "w2" }, {}, NOW);
  const r = await handleWebhook("evt_20", { type: "payment.succeeded", data: payment({ id: "pay_20", metadata: {}, membership_id: "mem_20", user: { id: "user_20", email: "buyer@x.com" } }) }, ENV, NOW);
  assert.equal(r, "unmatched");
  const waiting = await db().get("whop/unmatched/pay_20");
  assert.equal(waiting.email, "buyer@x.com");
  const m = await handleWebhook("evt_21", { type: "membership.activated", data: { id: "mem_20", user_id: "user_20", metadata: { uid: "w2" } } }, ENV, NOW);
  assert.equal(m, "settled-1");
  assert.equal(accessOf(await db().get("users/w2"), { now: NOW }).tier, "self");
  assert.equal(await db().get("whop/unmatched/pay_20"), null);
});

test("Whop: payment parser reads the fields we need", () => {
  const p = readPayment({ id: "pay_x", plan: { id: "plan_S1" }, membership: { id: "mem_x", metadata: { uid: "u" } }, user: { id: "user_x", username: "bob" }, total: 49, currency: "usd" });
  assert.deepEqual([p.id, p.whopPlanId, p.membershipId, p.whopUserId, p.uid, p.amount, p.whopUsername], ["pay_x", "plan_S1", "mem_x", "user_x", "u", 49, "bob"]);
});
