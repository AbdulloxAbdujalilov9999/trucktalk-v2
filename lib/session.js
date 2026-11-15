/* Who is calling: a verified Firebase ID token (demo token in demo mode) -> identity, profile and access. */
import { bearer, fail } from "./http.js";
import { verifyIdToken } from "./firebase.js";
import { accessOf, ensureUser, isEnvAdmin } from "./users.js";

const cache = new Map();   // token -> { identity, until }   (saves the signature check on bursts of calls)

export async function identify(req, now = Date.now()) {
  const token = bearer(req);
  if (!token) return null;
  const hit = cache.get(token);
  if (hit && hit.until > now) return hit.identity;
  const identity = await verifyIdToken(token, now);
  if (identity) {
    cache.set(token, { identity, until: now + 5 * 60 * 1000 });
    if (cache.size > 5000) cache.clear();
  }
  return identity;
}

/** { identity, uid, profile, access } for a signed-in caller, or null when nobody is signed in (optional = true). */
export async function caller(req, { optional = false, now = Date.now() } = {}) {
  const identity = await identify(req, now);
  if (!identity) {
    if (bearer(req) && !optional) fail(401, "sign-in");
    if (!optional) fail(401, "sign-in");
    return { identity: null, uid: null, profile: null, access: accessOf(null) };
  }
  const profile = await ensureUser(identity, {}, now);
  const access = accessOf(profile, { now, envAdmin: isEnvAdmin(identity) });
  return { identity, uid: identity.uid, profile, access };
}

export function requireActive(c) {
  if (!c || !c.uid) fail(401, "sign-in");
  if (c.access.blocked) fail(403, "blocked");
  return c;
}
export function requireStaff(c, roles = ["teacher", "admin"]) {
  requireActive(c);
  if (!roles.includes(c.access.role)) fail(403, "not-allowed");
  return c;
}
