/* Firebase on the server without the Admin SDK: verify ID tokens, mint custom tokens, get an OAuth token for the
 * Realtime Database REST API. All three are plain JWT work with node:crypto.
 *
 * ID token checks follow Firebase's documented rules: RS256, kid from Google's securetoken key set, aud = project id,
 * iss = https://securetoken.google.com/<project id>, exp in the future, iat and auth_time not in the future, sub non-empty. */
import crypto from "node:crypto";
import { b64url, fromB64url, signToken, verifyToken } from "./crypto.js";
import { isDemo, projectId, serviceAccount, sessionSecret } from "./env.js";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const SKEW_S = 60;

let jwks = { keys: new Map(), until: 0 };
async function publicKey(kid) {
  const now = Date.now();
  if (now > jwks.until || !jwks.keys.has(kid)) {
    const r = await fetch(JWKS_URL);
    if (!r.ok) throw new Error("jwks " + r.status);
    const body = await r.json();
    const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
    const keys = new Map();
    for (const k of body.keys || []) if (k.kid && k.kty === "RSA") keys.set(k.kid, crypto.createPublicKey({ key: k, format: "jwk" }));
    jwks = { keys, until: now + (m ? Number(m[1]) * 1000 : 3600 * 1000) };
  }
  return jwks.keys.get(kid) || null;
}

function decode(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    return { header: JSON.parse(fromB64url(parts[0])), payload: JSON.parse(fromB64url(parts[1])), signed: parts[0] + "." + parts[1], sig: fromB64url(parts[2]) };
  } catch { return null; }
}

/** Checks the claims of a decoded Firebase ID token. Exported for tests. */
export function claimsOk(p, project, nowS) {
  return !!(p && project &&
    p.aud === project &&
    p.iss === "https://securetoken.google.com/" + project &&
    typeof p.sub === "string" && p.sub.length > 0 && p.sub.length <= 128 &&
    typeof p.exp === "number" && p.exp > nowS - SKEW_S &&
    typeof p.iat === "number" && p.iat <= nowS + SKEW_S &&
    (p.auth_time == null || (typeof p.auth_time === "number" && p.auth_time <= nowS + SKEW_S)));
}

function identityFrom(p) {
  const fb = p.firebase || {};
  return {
    uid: p.sub,
    email: typeof p.email === "string" ? p.email.toLowerCase() : null,
    emailVerified: p.email_verified === true,
    name: typeof p.name === "string" ? p.name.slice(0, 80) : null,
    provider: typeof fb.sign_in_provider === "string" ? fb.sign_in_provider : "unknown",
    telegramId: typeof p.tg === "number" ? p.tg : null,    // set by our own custom tokens
    demo: false,
  };
}

/** A verified identity for a Firebase ID token (or a demo token in demo mode), else null. */
export async function verifyIdToken(token, now = Date.now()) {
  if (!token || token.length > 4096) return null;
  if (isDemo()) return verifyDemoToken(token, now);
  const d = decode(token);
  if (!d || d.header.alg !== "RS256" || typeof d.header.kid !== "string") return null;
  if (!claimsOk(d.payload, projectId(), Math.floor(now / 1000))) return null;
  let key;
  try { key = await publicKey(d.header.kid); } catch (e) { console.error("auth: could not load Google keys", e.message); return null; }
  if (!key) return null;
  const ok = crypto.verify("RSA-SHA256", Buffer.from(d.signed), key, d.sig);
  return ok ? identityFrom(d.payload) : null;
}

/** A Firebase custom token (the browser exchanges it with signInWithCustomToken). claims become token claims. */
export function createCustomToken(uid, claims = {}, now = Date.now()) {
  if (isDemo()) return createDemoToken(uid, claims, now);
  const sa = serviceAccount();
  if (!sa) throw new Error("no service account");
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat, exp: iat + 3600, uid, claims,
  }));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(header + "." + payload), sa.private_key);
  return header + "." + payload + "." + b64url(sig);
}

// ---------------------------------------------------------------- service-account OAuth token (database access)
let access = { token: "", until: 0 };
export async function accessToken(now = Date.now()) {
  if (access.token && access.until > now + 60_000) return access.token;
  const sa = serviceAccount();
  if (!sa) throw new Error("no service account");
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
  }));
  const assertion = header + "." + claim + "." + b64url(crypto.sign("RSA-SHA256", Buffer.from(header + "." + claim), sa.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!r.ok) throw new Error("oauth " + r.status);
  const j = await r.json();
  access = { token: j.access_token, until: now + (Number(j.expires_in) || 3600) * 1000 };
  return access.token;
}

// ---------------------------------------------------------------- demo mode (no Firebase at all)
export function createDemoToken(uid, claims = {}, now = Date.now()) {
  return "demo." + signToken({ uid, ...claims, exp: now + 7 * 24 * 3600 * 1000 }, sessionSecret());
}
function verifyDemoToken(token, now) {
  if (!token.startsWith("demo.")) return null;
  const p = verifyToken(token.slice(5), sessionSecret(), now);
  if (!p || typeof p.uid !== "string") return null;
  return {
    uid: p.uid, email: p.email || null, emailVerified: !!p.email, name: p.name || null,
    provider: p.provider || "demo", telegramId: typeof p.tg === "number" ? p.tg : null, demo: true,
  };
}
