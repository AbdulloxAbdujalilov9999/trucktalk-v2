/* The database. Production: Firebase Realtime Database over REST with the service account, so every read and write goes
 * through this server and the database rules can simply deny all browser access. Demo and tests: the same API in memory
 * (optionally saved to a JSON file so a local demo survives restarts).
 *
 *   get(path) set(path, v) update(path, {rel: v}) remove(path) createOnce(path, v) transaction(path, fn) query(path, opts)
 * Keys that come from users must go through key() first. */
import fs from "node:fs";
import path from "node:path";
import { accessToken } from "./firebase.js";
import { databaseUrl, isDemo } from "./env.js";

/** A safe single path segment, or throws. */
export function key(s) {
  const v = String(s == null ? "" : s);
  if (!v || v.length > 200 || /[.#$\[\]\/\x00-\x1f\x7f]/.test(v)) throw new Error("bad key: " + JSON.stringify(v).slice(0, 60));
  return v;
}
const clean = (p) => String(p || "").split("/").filter(Boolean).join("/");

// ---------------------------------------------------------------- REST
function restDb(base) {
  async function call(method, p, { body, headers = {}, params = {} } = {}) {
    const tok = await accessToken();
    const qs = new URLSearchParams(params).toString();
    const url = `${base}/${clean(p)}.json${qs ? "?" + qs : ""}`;
    const r = await fetch(url, {
      method,
      headers: { authorization: "Bearer " + tok, "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return r;
  }
  async function ok(r, what) {
    if (r.ok) return r.status === 204 ? null : r.json();
    const t = await r.text().catch(() => "");
    throw new Error(`db ${what} ${r.status} ${t.slice(0, 200)}`);
  }
  return {
    kind: "rtdb",
    async get(p) { return ok(await call("GET", p), "get " + p); },
    async set(p, v) { await ok(await call("PUT", p, { body: v, params: { print: "silent" } }), "set " + p); },
    async update(p, v) { if (Object.keys(v).length) await ok(await call("PATCH", p, { body: v, params: { print: "silent" } }), "update " + p); },
    async remove(p) { await ok(await call("DELETE", p, { params: { print: "silent" } }), "remove " + p); },
    async createOnce(p, v) {
      const r = await call("GET", p, { headers: { "X-Firebase-ETag": "true" } });
      const cur = await ok(r, "createOnce-get " + p);
      if (cur !== null) return false;
      const w = await call("PUT", p, { body: v, headers: { "if-match": r.headers.get("etag") || "" }, params: { print: "silent" } });
      if (w.status === 412) return false;
      await ok(w, "createOnce-put " + p);
      return true;
    },
    async transaction(p, fn, tries = 8) {
      for (let i = 0; i < tries; i++) {
        const r = await call("GET", p, { headers: { "X-Firebase-ETag": "true" } });
        const cur = await ok(r, "tx-get " + p);
        const next = fn(cur);
        if (next === undefined) return { committed: false, value: cur };
        const w = await call("PUT", p, { body: next, headers: { "if-match": r.headers.get("etag") || "" }, params: { print: "silent" } });
        if (w.status === 412) continue;
        await ok(w, "tx-put " + p);
        return { committed: true, value: next };
      }
      throw new Error("db transaction contention at " + p);
    },
    async query(p, { orderBy, equalTo, startAt, endAt, limitToLast, limitToFirst } = {}) {
      const params = {};
      if (orderBy) params.orderBy = JSON.stringify(orderBy);
      if (equalTo !== undefined) params.equalTo = JSON.stringify(equalTo);
      if (startAt !== undefined) params.startAt = JSON.stringify(startAt);
      if (endAt !== undefined) params.endAt = JSON.stringify(endAt);
      if (limitToLast) params.limitToLast = String(limitToLast);
      if (limitToFirst) params.limitToFirst = String(limitToFirst);
      return (await ok(await call("GET", p, { params }), "query " + p)) || {};
    },
    async shallow(p) { return (await ok(await call("GET", p, { params: { shallow: "true" } }), "shallow " + p)) || {}; },
  };
}

// ---------------------------------------------------------------- memory (demo + tests)
export function memoryDb(file) {
  let root = {};
  if (file && fs.existsSync(file)) { try { root = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { root = {}; } }
  let saveTimer = null;
  const save = () => {
    if (!file) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(root)); }, 200);
    if (saveTimer.unref) saveTimer.unref();
  };
  const segs = (p) => clean(p).split("/").filter(Boolean);
  const copy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  function read(p) { let n = root; for (const s of segs(p)) { if (n == null || typeof n !== "object") return null; n = n[s]; } return n === undefined ? null : n; }
  function prune(obj) {
    if (obj == null || typeof obj !== "object") return obj;
    for (const k of Object.keys(obj)) { obj[k] = prune(obj[k]); if (obj[k] == null || (typeof obj[k] === "object" && !Object.keys(obj[k]).length)) delete obj[k]; }
    return obj;
  }
  function write(p, v) {
    const s = segs(p);
    if (!s.length) { root = prune(copy(v)) || {}; save(); return; }
    let n = root;
    for (const k of s.slice(0, -1)) { if (n[k] == null || typeof n[k] !== "object") n[k] = {}; n = n[k]; }
    const last = s[s.length - 1];
    if (v == null) delete n[last]; else n[last] = copy(v);
    root = prune(root) || {};
    save();
  }
  const resolve = (base, rel) => clean(base + "/" + rel);
  return {
    kind: "memory",
    _dump: () => copy(root),
    async get(p) { return copy(read(p)); },
    async set(p, v) { write(p, v); },
    async update(p, v) {
      for (const [rel, val] of Object.entries(v)) {
        if (val && typeof val === "object" && val[".sv"] && val[".sv"].increment != null) write(resolve(p, rel), (Number(read(resolve(p, rel))) || 0) + Number(val[".sv"].increment));
        else write(resolve(p, rel), val);
      }
    },
    async remove(p) { write(p, null); },
    async createOnce(p, v) { if (read(p) !== null) return false; write(p, v); return true; },
    async transaction(p, fn) {
      const cur = copy(read(p));
      const next = fn(cur);
      if (next === undefined) return { committed: false, value: cur };
      write(p, next);
      return { committed: true, value: copy(next) };
    },
    async query(p, { orderBy, equalTo, startAt, endAt, limitToLast, limitToFirst } = {}) {
      const all = read(p) || {};
      let rows = Object.entries(all);
      const val = (v) => (orderBy === "$key" ? null : orderBy === "$value" ? v : orderBy ? orderBy.split("/").reduce((o, k) => (o == null ? null : o[k]), v) : null);
      if (orderBy) {
        const kv = (r) => (orderBy === "$key" ? r[0] : val(r[1]));
        rows = rows.filter((r) => kv(r) !== null && kv(r) !== undefined);
        rows.sort((a, b) => (kv(a) < kv(b) ? -1 : kv(a) > kv(b) ? 1 : a[0] < b[0] ? -1 : 1));
        if (equalTo !== undefined) rows = rows.filter((r) => kv(r) === equalTo);
        if (startAt !== undefined) rows = rows.filter((r) => kv(r) >= startAt);
        if (endAt !== undefined) rows = rows.filter((r) => kv(r) <= endAt);
      }
      if (limitToFirst) rows = rows.slice(0, limitToFirst);
      if (limitToLast) rows = rows.slice(-limitToLast);
      return copy(Object.fromEntries(rows));
    },
    async shallow(p) { const v = read(p); return v && typeof v === "object" ? Object.fromEntries(Object.keys(v).map((k) => [k, true])) : {}; },
  };
}

let instance = null;
/** The database for this process. */
export function db() {
  if (instance) return instance;
  if (isDemo() || process.env.NODE_ENV === "test") instance = memoryDb(process.env.DEMO_DB_FILE || null);
  else {
    const url = databaseUrl();
    if (!url) throw new Error("FIREBASE_DATABASE_URL is not set");
    instance = restDb(url);
  }
  return instance;
}
/** Tests swap in a fresh database. */
export function setDb(d) { instance = d; }

/** Increment a counter atomically. */
export const inc = (n = 1) => ({ ".sv": { increment: n } });
