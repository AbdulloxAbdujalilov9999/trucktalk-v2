/* Accounts, roles, trials and what each person may open. The browser never writes any of this: profiles are created and
 * changed only here (sign-in, trial start, payments, admin actions). */
import { db, key } from "./db.js";
import { sha256hex } from "./crypto.js";
import { adminEmails } from "./env.js";
import { TIERS, TRIAL_DAYS, DAY_MS } from "../public/js/shared/plans.js";

export const ROLES = ["student", "teacher", "admin"];

/** Is this identity one of the owner's admin emails? Only a verified email counts. */
export function isEnvAdmin(identity) {
  return !!(identity && identity.email && identity.emailVerified && adminEmails().has(identity.email));
}

/** Identity proven by the sign-in method (Google, email link, Telegram). Needed for a trial. */
export function verifiedIdentity(profile) {
  return !!(profile && ((profile.email && profile.emailVerified) || profile.telegramId));
}

/** Everything the app and the server need to know about what this person may do right now. */
export function accessOf(profile, { now = Date.now(), envAdmin = false } = {}) {
  if (!profile) return { role: "anon", tier: "anon", full: false, staff: false, signedIn: false, limits: { ai: 0, voiceMin: 0 }, canStartTrial: false };
  const role = envAdmin ? "admin" : ROLES.includes(profile.role) ? profile.role : "student";
  const staff = role !== "student";
  const blocked = !!profile.blocked && !envAdmin;
  const paid = typeof profile.paidUntil === "number" && profile.paidUntil > now && (profile.tier === "self" || profile.tier === "pro");
  const trialEndsAt = profile.trial && typeof profile.trial.endsAt === "number" ? profile.trial.endsAt : null;
  const trialActive = !!trialEndsAt && trialEndsAt > now;
  const tier = blocked ? "blocked" : staff ? "staff" : paid ? profile.tier : trialActive ? "trial" : "free";
  return {
    role, tier, staff, blocked, signedIn: true,
    full: !blocked && (staff || paid || trialActive),
    paidUntil: paid ? profile.paidUntil : null,
    trialEndsAt,
    trialUsed: !!profile.trial,
    canStartTrial: !blocked && !staff && !paid && !profile.trial && verifiedIdentity(profile),
    limits: blocked ? { ai: 0, voiceMin: 0 } : { ...(TIERS[tier] || TIERS.free) },
  };
}

/** The stored profile, created on first sign-in. Keeps name/email fresh and lastSeenAt roughly current. */
export async function ensureUser(identity, extra = {}, now = Date.now()) {
  const uid = key(identity.uid);
  const d = db();
  let profile = await d.get("users/" + uid);
  if (!profile) {
    const fresh = clean({
      createdAt: now, lastSeenAt: now, role: "student",
      name: identity.name || extra.name || null,
      email: identity.email ? String(identity.email).toLowerCase() : null, emailVerified: !!identity.emailVerified,
      provider: identity.provider || "unknown",
      telegramId: identity.telegramId || extra.telegramId || null,
      telegramUsername: extra.telegramUsername || null,
      phone: extra.phone || null,
      lang: extra.lang || null,
      source: extra.source || null,
    });
    await d.createOnce("users/" + uid, fresh);
    profile = await d.get("users/" + uid);
    return profile || fresh;
  }
  const patch = {};
  if (identity.email && String(identity.email).toLowerCase() !== profile.email) patch.email = String(identity.email).toLowerCase();
  if (identity.emailVerified && !profile.emailVerified) patch.emailVerified = true;
  if (identity.name && !profile.name) patch.name = identity.name;
  if (!profile.lastSeenAt || now - profile.lastSeenAt > 60 * 60 * 1000) patch.lastSeenAt = now;
  if (Object.keys(patch).length) { await d.update("users/" + uid, patch); Object.assign(profile, patch); }
  return profile;
}

/** Starts the one free trial. One per account AND one per verified email / Telegram account / phone, so making new
 *  accounts doesn't give new trials. */
export async function startTrial(uid, profile, now = Date.now()) {
  const access = accessOf(profile, { now });
  if (!access.canStartTrial) return { ok: false, error: profile && profile.trial ? "trial-used" : !verifiedIdentity(profile) ? "verify-first" : "not-eligible" };
  const d = db();
  const ids = [];
  if (profile.email && profile.emailVerified) ids.push("e:" + profile.email.toLowerCase());
  if (profile.telegramId) ids.push("t:" + profile.telegramId);
  if (profile.phone) ids.push("p:" + String(profile.phone).replace(/\D/g, ""));
  for (const id of ids) {
    const k = "trialKeys/" + sha256hex("trucktalk:" + id).slice(0, 40);
    const created = await d.createOnce(k, { uid, at: now });
    if (!created) {
      const owner = await d.get(k);
      if (!owner || owner.uid !== uid) return { ok: false, error: "trial-used" };
    }
  }
  const trial = { startedAt: now, endsAt: now + TRIAL_DAYS * DAY_MS };
  const created = await d.createOnce("users/" + key(uid) + "/trial", trial);
  if (!created) return { ok: false, error: "trial-used" };
  return { ok: true, trial };
}

/** What the browser may see of a profile. */
export function publicProfile(uid, profile) {
  if (!profile) return null;
  return {
    uid,
    name: profile.name || null,
    email: profile.email || null,
    telegram: profile.telegramId ? { id: profile.telegramId, username: profile.telegramUsername || null } : null,
    phone: profile.phone ? String(profile.phone).replace(/\d(?=\d{4})/g, "•") : null,
    lang: profile.lang || null,
    createdAt: profile.createdAt || null,
  };
}

function clean(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)); }
