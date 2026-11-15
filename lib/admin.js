/* Admin and teacher tools. Teachers may look (students, progress, results); only admins change things (plans, payments,
 * roles, blocks, trials). Every change is written to the audit log with who did it. */
import { db, key } from "./db.js";
import { newId, sha256hex } from "./crypto.js";
import { accessOf, ROLES, verifiedIdentity } from "./users.js";
import { recordManual, setStatus, computeAccess } from "./payments/ledger.js";
import { totalXp, streak, daysDone } from "../public/js/shared/progress.js";
import { utcDay } from "./limits.js";

const DAY = 86400000;

export async function audit(by, action, target, details = {}, now = Date.now()) {
  await db().set("audit/" + newId(), { at: now, by, action, target: target || null, details });
}

function row(uid, p, now) {
  const a = accessOf(p, { now });
  return {
    uid, name: p.name || null, email: p.email || null, phone: p.phone || null, telegram: p.telegramUsername || (p.telegramId ? String(p.telegramId) : null),
    role: a.role, tier: a.tier, paidUntil: a.paidUntil, trialEndsAt: a.trialEndsAt, blocked: !!p.blocked,
    createdAt: p.createdAt || null, lastSeenAt: p.lastSeenAt || null, source: p.source || null, provider: p.provider || null,
  };
}

export async function stats(now = Date.now()) {
  const d = db();
  const [all, newer, paid, trials, leads, idx, usage] = await Promise.all([
    d.shallow("users"),
    d.query("users", { orderBy: "createdAt", startAt: now - 7 * DAY }),
    d.query("users", { orderBy: "paidUntil", startAt: now }),
    d.query("users", { orderBy: "trial/endsAt", startAt: now }),
    d.query("leads", { orderBy: "lastAt", startAt: now - 7 * DAY }),
    d.query("paymentIndex", { orderBy: "at", startAt: now - 30 * DAY }),
    d.get("usage/" + utcDay(now)),
  ]);
  let revenue = {}, payments = 0;
  for (const [pid, ix] of Object.entries(idx)) {
    const p = await d.get(`payments/${key(ix.uid)}/${key(pid)}`);
    if (!p || p.status !== "paid") continue;
    payments++;
    if (typeof p.amount === "number") revenue[p.currency || "USD"] = (revenue[p.currency || "USD"] || 0) + p.amount;
  }
  const bySource = {};
  for (const l of Object.values(leads)) { const s = l.firstSource || "?"; bySource[s] = (bySource[s] || 0) + 1; }
  return {
    users: Object.keys(all).length, newUsers7d: Object.keys(newer).length,
    paidActive: Object.values(paid).filter((p) => p.tier === "self" || p.tier === "pro").length,
    trialsActive: Object.keys(trials).length,
    leads7d: Object.keys(leads).length, leadsBySource: bySource,
    payments30d: payments, revenue30d: revenue,
    usageToday: {
      aiCalls: Number(usage && usage.ai && usage.ai._all) || 0,
      aiPeople: usage && usage.ai ? Object.keys(usage.ai).filter((k) => k !== "_all").length : 0,
      ttsChars: Number(usage && usage.tts && usage.tts.chars) || 0,
      voiceMinutes: Math.round((Number(usage && usage.voice && usage.voice._seconds) || 0) / 60),
    },
  };
}

export async function listUsers({ q = "", filter = "", limit = 100 } = {}, now = Date.now()) {
  const d = db();
  let found = {};
  q = String(q || "").trim();
  if (q) {
    const lower = q.toLowerCase();
    const tries = [];
    if (/^[A-Za-z0-9_-]{6,128}$/.test(q)) tries.push(d.get("users/" + q).then((p) => (p ? { [q]: p } : {})));
    if (q.includes("@") && !q.startsWith("@")) tries.push(d.query("users", { orderBy: "email", equalTo: lower }));
    if (/^\d{5,15}$/.test(q)) tries.push(d.query("users", { orderBy: "telegramId", equalTo: Number(q) }));
    for (const r of await Promise.all(tries)) Object.assign(found, r);
    if (!Object.keys(found).length) {
      // fall back to a scan of recent accounts (names, usernames, phone digits)
      const recent = await d.query("users", { orderBy: "createdAt", limitToLast: 2000 });
      const digits = q.replace(/\D/g, "");
      for (const [uid, p] of Object.entries(recent)) {
        const hay = [p.name, p.email, p.telegramUsername, uid].filter(Boolean).join(" ").toLowerCase();
        if (hay.includes(lower.replace(/^@/, "")) || (digits.length >= 4 && String(p.phone || "").replace(/\D/g, "").includes(digits))) found[uid] = p;
      }
    }
  } else if (filter === "paid") found = await d.query("users", { orderBy: "paidUntil", startAt: now });
  else if (filter === "trial") found = await d.query("users", { orderBy: "trial/endsAt", startAt: now });
  else found = await d.query("users", { orderBy: "createdAt", limitToLast: Math.min(limit, 500) });
  let rows = Object.entries(found).map(([uid, p]) => row(uid, p, now));
  if (filter === "staff") rows = rows.filter((r) => r.role !== "student");
  if (filter === "blocked") rows = rows.filter((r) => r.blocked);
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
}

export async function userDetail(uid, now = Date.now()) {
  const d = db();
  const [p, payments, results, progress, voice] = await Promise.all([
    d.get("users/" + key(uid)), d.get("payments/" + key(uid)), d.get("results/" + key(uid)), d.get("progress/" + key(uid)), d.get("voice/" + key(uid)),
  ]);
  if (!p) return null;
  return {
    user: { ...row(uid, p, now), note: p.note || "", lang: p.lang || null, trial: p.trial || null },
    access: accessOf(p, { now }),
    ledger: computeAccess(payments || {}, now),
    payments: Object.entries(payments || {}).map(([id, x]) => ({ id, ...x })).sort((a, b) => b.at - a.at),
    results: results || {},
    progress: progress ? { daysDone: daysDone(progress), xp: totalXp(progress), streak: streak(progress, now), videos: Object.keys(progress.videos || {}).length, review: Object.keys(progress.srs || {}).length } : null,
    voice: Object.entries(voice || {}).map(([id, s]) => ({ id, ...s })).sort((a, b) => b.startedAt - a.startedAt).slice(0, 20),
  };
}

export async function grant(by, uid, { tier, days, amount, currency, note }, now = Date.now()) {
  if (!(await db().get("users/" + key(uid)))) return { error: "no-user" };
  const id = "man_" + newId();
  await recordManual(uid, id, { tier, days: Number(days), amount: amount === "" || amount == null ? null : Number(amount), currency: currency || "USD", note: note ? String(note).slice(0, 200) : null, by }, now);
  await audit(by, "grant", uid, { id, tier, days: Number(days), amount: amount ?? null }, now);
  return { ok: true, id };
}

export async function revoke(by, paymentId, reason, now = Date.now()) {
  const r = await setStatus(paymentId, "revoked", { by, reason: reason ? String(reason).slice(0, 200) : "admin" }, now);
  if (!r.found) return { error: "no-payment" };
  await audit(by, "revoke", r.uid, { paymentId, reason: reason || null }, now);
  return { ok: true };
}

export async function setRole(by, uid, role, now = Date.now()) {
  if (!ROLES.includes(role)) return { error: "role" };
  const profile = await db().get("users/" + key(uid));
  if (!profile) return { error: "no-user" };
  // staff can see every student: only accounts whose sign-in proved who they are (Google, email link, Telegram)
  if (role !== "student" && !verifiedIdentity(profile)) return { error: "unverified" };
  await db().update("users/" + key(uid), { role });
  await audit(by, "role", uid, { role }, now);
  return { ok: true };
}

export async function setBlocked(by, uid, blocked, now = Date.now()) {
  if (!(await db().get("users/" + key(uid)))) return { error: "no-user" };
  await db().update("users/" + key(uid), { blocked: !!blocked });
  await audit(by, blocked ? "block" : "unblock", uid, {}, now);
  return { ok: true };
}

export async function setNote(by, uid, note, now = Date.now()) {
  if (!(await db().get("users/" + key(uid)))) return { error: "no-user" };
  await db().update("users/" + key(uid), { note: String(note || "").slice(0, 1000) });
  await audit(by, "note", uid, {}, now);
  return { ok: true };
}

/** Lets someone start a trial again (removes their trial and the identity keys that point at them). */
export async function resetTrial(by, uid, now = Date.now()) {
  const p = await db().get("users/" + key(uid));
  if (!p) return { error: "no-user" };
  const ids = [];
  if (p.email) ids.push("e:" + p.email.toLowerCase());
  if (p.telegramId) ids.push("t:" + p.telegramId);
  if (p.phone) ids.push("p:" + String(p.phone).replace(/\D/g, ""));
  const updates = { [`users/${key(uid)}/trial`]: null };
  for (const id of ids) {
    const k = "trialKeys/" + sha256hex("trucktalk:" + id).slice(0, 40);
    const owner = await db().get(k);
    if (owner && owner.uid === uid) updates[k] = null;
  }
  await db().update("", updates);
  await audit(by, "reset-trial", uid, {}, now);
  return { ok: true };
}

export async function recentPayments(limit = 100) {
  const idx = await db().query("paymentIndex", { orderBy: "at", limitToLast: limit });
  const out = [];
  for (const [id, ix] of Object.entries(idx)) {
    const p = await db().get(`payments/${key(ix.uid)}/${key(id)}`);
    if (p) out.push({ id, uid: ix.uid, ...p });
  }
  return out.sort((a, b) => b.at - a.at);
}

export async function recentLeads(limit = 200) {
  const leads = await db().query("leads", { orderBy: "lastAt", limitToLast: limit });
  return Object.entries(leads).map(([id, l]) => ({ id, ...l })).sort((a, b) => b.lastAt - a.lastAt);
}

export async function auditLog(limit = 100) {
  const a = await db().query("audit", { orderBy: "at", limitToLast: limit });
  return Object.entries(a).map(([id, x]) => ({ id, ...x })).sort((a2, b) => b.at - a2.at);
}

export async function unmatchedPayments() {
  const u = (await db().get("whop/unmatched")) || {};
  return Object.entries(u).map(([id, x]) => ({ id, ...x }));
}

/** Deletes records that are only needed for a while: daily usage counters after 40 days, redeemed one-time sign-in
 *  tokens and account-link codes once expired, and webhook ids after 30 days (Whop only retries for a few days).
 *  Runs at most once a day (the admin overview starts it), in batches so one request never gets too big. */
export async function housekeeping(now = Date.now()) {
  const d = db();
  if (!(await d.createOnce("housekeeping/" + utcDay(now), { at: now }))) return { skipped: true };
  const old = (days) => utcDay(now - days * DAY);
  const del = {}, count = { usage: 0, loginTokens: 0, telegramLinks: 0, whopEvents: 0 };
  for (const k of Object.keys(await d.shallow("usage"))) if (k < old(40)) { del["usage/" + k] = null; count.usage++; }
  for (const k of Object.keys(await d.shallow("housekeeping"))) if (k < old(40)) del["housekeeping/" + k] = null;
  for (const k of Object.keys(await d.query("loginTokens", { orderBy: "exp", endAt: now - DAY, limitToFirst: 2000 }))) { del["loginTokens/" + k] = null; count.loginTokens++; }
  for (const k of Object.keys(await d.query("telegramLinks", { orderBy: "exp", endAt: now - DAY, limitToFirst: 2000 }))) { del["telegramLinks/" + k] = null; count.telegramLinks++; }
  for (const k of Object.keys(await d.query("whop/events", { orderBy: "at", endAt: now - 30 * DAY, limitToFirst: 2000 }))) { del["whop/events/" + k] = null; count.whopEvents++; }
  const paths = Object.keys(del);
  for (let i = 0; i < paths.length; i += 400) await d.update("", Object.fromEntries(paths.slice(i, i + 400).map((k) => [k, null])));
  return count;
}

