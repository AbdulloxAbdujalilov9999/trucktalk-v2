/* Spending limits that hold across every server instance (they live in the database, not in memory):
 * per-person daily counts and global daily budgets for the paid AI services. Plus a best-effort in-memory limiter for
 * anonymous endpoints. */
import { db, key } from "./db.js";

/** "YYYY-MM-DD" in UTC: the day a budget belongs to. */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Takes `amount` from a daily budget if it fits. { ok, used, limit } */
export async function take(name, limit, { amount = 1, now = Date.now() } = {}) {
  if (!(limit > 0)) return { ok: false, used: 0, limit };
  const path = "usage/" + utcDay(now) + "/" + name.split("/").map(key).join("/");
  const r = await db().transaction(path, (cur) => {
    const used = Number(cur) || 0;
    return used + amount > limit ? undefined : used + amount;
  });
  return { ok: r.committed, used: Number(r.value) || 0, limit };
}

/** Gives back what was taken (an upstream failure shouldn't cost the student a try). */
export async function giveBack(name, { amount = 1, now = Date.now() } = {}) {
  const path = "usage/" + utcDay(now) + "/" + name.split("/").map(key).join("/");
  await db().transaction(path, (cur) => Math.max(0, (Number(cur) || 0) - amount));
}

export async function used(name, now = Date.now()) {
  return Number(await db().get("usage/" + utcDay(now) + "/" + name.split("/").map(key).join("/"))) || 0;
}

/** In-memory sliding window (per server instance). For cheap abuse protection on anonymous endpoints. */
export function memoryLimiter({ max, windowMs }) {
  const hits = new Map();
  return (id, now = Date.now()) => {
    const list = (hits.get(id) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) { hits.set(id, list); return false; }
    list.push(now); hits.set(id, list);
    if (hits.size > 10000) hits.clear();
    return true;
  };
}
