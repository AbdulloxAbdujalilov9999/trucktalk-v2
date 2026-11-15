/* Talking to our server. Adds the sign-in token, turns errors into ApiError with a code. */
import { getToken } from "./auth.js";

export class ApiError extends Error {
  constructor(status, code, data) { super(code || "http-" + status); this.status = status; this.code = code; this.data = data || {}; }
}

export async function api(path, { method = "GET", body, auth = true, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) { const tok = await getToken(); if (tok) headers.authorization = "Bearer " + tok; }
  let res;
  try {
    res = await fetch("/api/" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: "same-origin" });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw new ApiError(0, "network");
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || "http-" + res.status, data);
  return data;
}

let configPromise = null;
export function config() {
  return (configPromise ||= fetch("/api/config").then((r) => r.json()).catch(() => ({ demo: false, firebase: null, features: {} })));
}

const cacheKey = (k) => "tt2:c:" + k;
/** GET with an offline copy in localStorage (lessons keep working without internet). */
export async function cachedGet(path, key, { uid = "anon" } = {}) {
  const k = cacheKey(uid + ":" + key);
  try {
    const data = await api(path);
    try { localStorage.setItem(k, JSON.stringify(data)); } catch { pruneCache(); }
    return data;
  } catch (e) {
    if (e.code === "network") {
      try { const s = localStorage.getItem(k); if (s) return { ...JSON.parse(s), offline: true }; } catch { /* ignore */ }
    }
    throw e;
  }
}
function pruneCache() {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("tt2:c:"));
    keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
