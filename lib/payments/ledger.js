/* The payments ledger: payments/<uid>/<paymentId> = { provider, plan, tier, days, at, status, amount, currency, ... }.
 * A person's paid access is never edited by hand or incremented in place; it is recomputed from the ledger every time
 * something changes. So a refund or a dispute (status changes) takes the access away again, a duplicate webhook can't add
 * days twice (one record per payment id), and the admin can see exactly why someone has access. */
import { db, key } from "../db.js";
import { DAY_MS, planById } from "../../public/js/shared/plans.js";

export const ACTIVE = "paid";

/** Paid access from a list of payments: each tier stacks its own periods back to back; pro wins while it runs. */
export function computeAccess(payments, now = Date.now()) {
  const until = { self: 0, pro: 0 };
  const list = Object.values(payments || {}).filter((p) => p && p.status === ACTIVE && (p.tier === "self" || p.tier === "pro") && p.days > 0 && p.at > 0)
    .sort((a, b) => a.at - b.at);
  for (const p of list) {
    const start = Math.max(until[p.tier], p.at);
    until[p.tier] = start + p.days * DAY_MS;
  }
  const tier = until.pro > now ? "pro" : until.self > now ? "self" : null;
  return { tier, paidUntil: tier ? until[tier] : Math.max(until.pro, until.self) || null, proUntil: until.pro || null, selfUntil: until.self || null };
}

/** Recomputes and stores users/<uid>/{paidUntil, tier} from the ledger. */
export async function recompute(uid, now = Date.now()) {
  const d = db();
  const payments = (await d.get("payments/" + key(uid))) || {};
  const a = computeAccess(payments, now);
  await d.update("users/" + key(uid), { paidUntil: a.paidUntil, tier: a.tier, paymentsUpdatedAt: now });
  return a;
}

/** Records one payment exactly once (by its id) and recomputes access. Returns false if it was already recorded. */
export async function recordPayment(uid, paymentId, { provider, plan, amount = null, currency = null, note = null, by = null, extra = {} }, now = Date.now()) {
  const p = planById(plan);
  if (!p) throw new Error("unknown plan " + plan);
  const rec = { provider, plan: p.id, tier: p.tier, days: p.days, at: now, status: ACTIVE, amount, currency, note, by, ...extra };
  const created = await db().createOnce(`payments/${key(uid)}/${key(paymentId)}`, strip(rec));
  if (created) await db().set("paymentIndex/" + key(paymentId), { uid, at: now });
  await recompute(uid, now);
  return created;
}

/** A manual grant from the admin (cash, bank transfer, a gift): any number of days of a tier. */
export async function recordManual(uid, paymentId, { tier, days, amount = null, currency = null, note = null, by }, now = Date.now()) {
  if (!["self", "pro"].includes(tier) || !(days > 0 && days <= 800)) throw new Error("bad grant");
  const rec = { provider: "manual", plan: "manual", tier, days: Math.round(days), at: now, status: ACTIVE, amount, currency, note, by };
  const created = await db().createOnce(`payments/${key(uid)}/${key(paymentId)}`, strip(rec));
  if (created) await db().set("paymentIndex/" + key(paymentId), { uid, at: now });
  await recompute(uid, now);
  return created;
}

/** Refund, dispute, or admin revoke: the payment stops counting. Idempotent. */
export async function setStatus(paymentId, status, { by = null, reason = null, onlyFrom = null } = {}, now = Date.now()) {
  const idx = await db().get("paymentIndex/" + key(paymentId));
  if (!idx || !idx.uid) return { found: false };
  const path = `payments/${key(idx.uid)}/${key(paymentId)}`;
  const cur = await db().get(path);
  if (!cur) return { found: false };
  if (onlyFrom && !onlyFrom.includes(cur.status)) return { found: true, uid: idx.uid, unchanged: true };
  if (cur.status !== status) await db().update(path, strip({ status, statusAt: now, statusBy: by, statusReason: reason }));
  const access = await recompute(idx.uid, now);
  return { found: true, uid: idx.uid, access };
}

function strip(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)); }
