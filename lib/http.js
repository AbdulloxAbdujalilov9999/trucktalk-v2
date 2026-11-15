/* Request/response plumbing shared by every endpoint. Works on Vercel (Node runtime) and in server.mjs. */

export class HttpError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra || null; }
}
export const fail = (status, code, extra) => { throw new HttpError(status, code, extra); };

export function query(req) {
  if (req.query && typeof req.query === "object") return req.query;
  return Object.fromEntries(new URL(req.url || "/", "http://x").searchParams);
}
export function rawQueryString(req) {
  const u = String(req.url || "");
  const i = u.indexOf("?");
  return i < 0 ? "" : u.slice(i + 1);
}

/** The request body's exact bytes (webhooks need them for signatures). Never touches req.body unless the stream is gone. */
export async function readRaw(req, limit = 128 * 1024) {
  if (req.rawBody != null) return Buffer.from(req.rawBody);
  if (req.readableEnded) {
    const b = req.body;
    if (b == null) return Buffer.alloc(0);
    return Buffer.isBuffer(b) ? b : Buffer.from(typeof b === "string" ? b : JSON.stringify(b));
  }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; reject(new HttpError(413, "too-large")); return; }
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", (e) => { if (!done) { done = true; reject(e); } });
  });
}

export async function readJson(req, limit) {
  const raw = await readRaw(req, limit);
  if (!raw.length) return {};
  try {
    const v = JSON.parse(raw.toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : fail(400, "json");
  } catch (e) { if (e instanceof HttpError) throw e; return fail(400, "json"); }
}

export function header(req, name) {
  const h = req.headers || {};
  const v = h[name.toLowerCase()] ?? h[name];
  return Array.isArray(v) ? String(v[0]) : v == null ? "" : String(v);
}

export function bearer(req) {
  const a = header(req, "authorization");
  return a.startsWith("Bearer ") ? a.slice(7).trim() : "";
}

export function clientIp(req) {
  return (header(req, "x-forwarded-for").split(",")[0] || header(req, "x-real-ip") || (req.socket && req.socket.remoteAddress) || "?").trim();
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  const h = { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers };
  for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
  if (Buffer.isBuffer(body) || typeof body === "string") return res.end(body);
  if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** Wraps an endpoint: (req, ctx) => result. A plain object becomes JSON 200; { status, body, headers } is sent as is. */
export function endpoint(fn, { methods = ["GET", "POST"] } = {}) {
  return async function handler(req, res) {
    try {
      if (!methods.includes(req.method)) fail(405, "method");
      const out = await fn(req, res);
      if (res.writableEnded) return;
      if (out && out.__raw) return send(res, out.status || 200, out.body, out.headers);
      send(res, 200, out == null ? { ok: true } : out);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, ...(e.extra || {}) });
      console.error("[api] " + (req.url || "") + " failed:", e && e.stack ? e.stack : e);
      send(res, 500, { error: "server" });
    }
  };
}

export const raw = (body, status = 200, headers = {}) => ({ __raw: true, body, status, headers });
