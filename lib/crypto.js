/* Small crypto helpers on node:crypto (no dependencies). */
import crypto from "node:crypto";

export const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
export const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function sha256hex(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }

/** Random id: time-ordered prefix + randomness, safe as a database key. */
export function newId(prefix = "") {
  return prefix + Date.now().toString(36) + crypto.randomBytes(6).toString("hex");
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Our own signed token: base64url(json) + "." + base64url(HMAC-SHA256). Always carries exp (ms). */
export function signToken(payload, secret) {
  if (!secret) throw new Error("no secret");
  const body = b64url(JSON.stringify(payload));
  return body + "." + b64url(crypto.createHmac("sha256", secret).update(body).digest());
}

/** The payload if the signature is right and it hasn't expired, else null. */
export function verifyToken(token, secret, now = Date.now()) {
  if (!secret || typeof token !== "string" || token.length > 2000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  if (!safeEqual(sig, want)) return null;
  try {
    const p = JSON.parse(fromB64url(body).toString("utf8"));
    if (!p || typeof p.exp !== "number" || p.exp < now) return null;
    return p;
  } catch { return null; }
}
