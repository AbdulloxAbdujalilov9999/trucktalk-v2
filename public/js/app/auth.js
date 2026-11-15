/* Sign-in. Real mode: Firebase Authentication (Google, email link, and our Telegram custom tokens). Demo mode: a token from
 * /api/dev kept in localStorage. Either way the server verifies every token itself; nothing here is trusted. */
import { config } from "./api.js";

const FB = "https://www.gstatic.com/firebasejs/12.19.0/";
const DEMO_KEY = "tt2:demo-token";
const EMAIL_KEY = "tt2:email-for-signin";

let fb = null;            // { auth, m }
let demo = false;
let user = null;          // { uid, name, email, provider }
const listeners = new Set();
let readyResolve;
export const ready = new Promise((r) => { readyResolve = r; });

function emit() { for (const fn of listeners) { try { fn(user); } catch (e) { console.error(e); } } }
export function onUser(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function currentUser() { return user; }

function decodeDemo(tok) {
  try {
    const body = tok.slice(5).split(".")[0];
    const p = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    if (p.exp < Date.now()) return null;
    return { uid: p.uid, name: p.name || null, email: p.email || null, provider: "demo" };
  } catch { return null; }
}

export async function initAuth() {
  const cfg = await config();
  if (cfg.demo) {
    demo = true;
    let tok = null;
    try { tok = localStorage.getItem(DEMO_KEY); } catch { /* ignore */ }
    user = tok ? decodeDemo(tok) : null;
    if (!user) { try { localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ } }
    readyResolve(); emit();
    return;
  }
  if (!cfg.firebase) { readyResolve(); emit(); return; }
  try {
    const [appMod, m] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js")]);
    const app = appMod.initializeApp(cfg.firebase);
    const auth = m.getAuth(app);
    fb = { auth, m };
    let first = true;
    m.onAuthStateChanged(auth, (u) => {
      user = u ? { uid: u.uid, name: u.displayName || null, email: u.email || null, provider: (u.providerData[0] && u.providerData[0].providerId) || "custom" } : null;
      if (first) { first = false; readyResolve(); }
      emit();
    });
    m.getRedirectResult(auth).catch(() => {});
  } catch (e) {
    console.error("auth: Firebase failed to load", e);
    readyResolve(); emit();
  }
}

export async function getToken() {
  if (demo) { try { return localStorage.getItem(DEMO_KEY); } catch { return null; } }
  if (!fb || !fb.auth.currentUser) return null;
  try { return await fb.auth.currentUser.getIdToken(); } catch { return null; }
}

export async function signInGoogle() {
  const { auth, m } = fb;
  const provider = new m.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try { await m.signInWithPopup(auth, provider); }
  catch (e) {
    if (e && /popup-blocked|operation-not-supported|popup-closed-by-user|cancelled-popup/.test(e.code || "")) {
      if (/popup-closed-by-user|cancelled-popup/.test(e.code)) throw e;
      await m.signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

export async function sendEmailLink(email) {
  const { auth, m } = fb;
  await m.sendSignInLinkToEmail(auth, email, { url: location.origin + "/app/signin?finish=1", handleCodeInApp: true });
  try { localStorage.setItem(EMAIL_KEY, email); } catch { /* ignore */ }
}
export function isEmailLink() { return !!(fb && fb.m.isSignInWithEmailLink(fb.auth, location.href)); }
export function savedEmail() { try { return localStorage.getItem(EMAIL_KEY) || ""; } catch { return ""; } }
export async function finishEmailLink(email) {
  const { auth, m } = fb;
  await m.signInWithEmailLink(auth, email, location.href);
  try { localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
}

/** A custom token from our server (Telegram login) or a demo token. */
export async function signInWithToken(token) {
  if (demo) {
    try { localStorage.setItem(DEMO_KEY, token); } catch { /* ignore */ }
    user = decodeDemo(token); emit();
    return;
  }
  await fb.m.signInWithCustomToken(fb.auth, token);
}

export async function signOut() {
  if (demo) { try { localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ } user = null; emit(); return; }
  if (fb) await fb.m.signOut(fb.auth);
}

export const isDemo = () => demo;
export const firebaseReady = () => !!fb;
