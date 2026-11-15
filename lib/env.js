/* Configuration read from environment variables (never from the repo). See docs/SETUP.md for every variable. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const e = () => process.env;

let saCache = null, saRaw = null;
/** The Firebase service account (FIREBASE_SERVICE_ACCOUNT: the JSON file's contents, raw or base64). */
export function serviceAccount() {
  const raw = e().FIREBASE_SERVICE_ACCOUNT || "";
  if (!raw) return null;
  if (raw === saRaw) return saCache;
  saRaw = raw;
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const sa = JSON.parse(text);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    saCache = sa.client_email && sa.private_key && sa.project_id ? sa : null;
  } catch { saCache = null; }
  return saCache;
}

/** Demo mode: everything runs in memory with pretend sign-in and checkout. Only when asked for AND no real database is set,
 *  so a production deploy can never fall into it by accident. */
export function isDemo() { return e().DEMO_MODE === "1" && !e().FIREBASE_SERVICE_ACCOUNT; }

export function projectId() { return e().FIREBASE_PROJECT_ID || (serviceAccount() || {}).project_id || (isDemo() ? "demo-trucktalk" : ""); }
export function databaseUrl() { return (e().FIREBASE_DATABASE_URL || "").replace(/\/+$/, ""); }
export function appUrl() { return (e().APP_URL || "http://localhost:3000").replace(/\/+$/, ""); }

/** Secret for our own short-lived signed links (Telegram login, account linking). Required in production. */
export function sessionSecret() {
  const s = e().SESSION_SECRET || "";
  if (s.length >= 32) return s;
  if (isDemo() || e().NODE_ENV === "test") return "demo-only-secret-demo-only-secret-0000";
  return "";
}

/** Emails that are always admins (verified Google/email sign-ins only), e.g. the owner. */
export function adminEmails() {
  return new Set(String(e().ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** The public Firebase web config the browser needs (not secret). */
export function firebaseWebConfig() {
  const raw = e().FIREBASE_WEB_CONFIG;
  if (raw) { try { return JSON.parse(raw); } catch { /* fall through */ } }
  if (!e().FIREBASE_API_KEY) return null;
  return {
    apiKey: e().FIREBASE_API_KEY,
    authDomain: e().FIREBASE_AUTH_DOMAIN || projectId() + ".firebaseapp.com",
    projectId: projectId(),
    appId: e().FIREBASE_APP_ID || undefined,
  };
}

export function int(name, fallback) {
  const v = Number(e()[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
