/* The real HTTP server in demo mode, end to end: sign in, free/locked lessons, quiz grading, trial, payment, admin rules,
 * and the things that must never be reachable from outside. */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DBFILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tt2-")), "db.json");
let server;
const course = JSON.parse(fs.readFileSync("content/course.json", "utf8"));

before(async () => {
  const env = { ...process.env, DEMO_MODE: "1", PORT: String(PORT), DEMO_DB_FILE: DBFILE, NODE_ENV: "production" };
  for (const k of ["FIREBASE_SERVICE_ACCOUNT", "WHOP_WEBHOOK_SECRET", "TELEGRAM_BOT_TOKEN", "ELEVENLABS_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ADMIN_EMAILS"]) delete env[k];
  server = spawn(process.execPath, ["server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + "/api/config")).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});
after(() => { if (server) server.kill(); });

async function call(p, { method = "GET", body, token, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (token) h.authorization = "Bearer " + token;
  const r = await fetch(BASE + "/api/" + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  return { status: r.status, data, headers: r.headers };
}
const login = async (as, id) => (await call("dev", { method: "POST", body: { action: "login", as, id } })).data.token;

test("config and anonymous access", async () => {
  const c = await call("config");
  assert.equal(c.data.demo, true);
  assert.equal(c.data.firebase, null);
  const me = await call("me");
  assert.equal(me.data.user, null);
  assert.equal(me.data.access.tier, "anon");
  const free = await call("content?kind=day&id=1");
  assert.equal(free.status, 200);
  assert.ok(free.data.item.quiz.every((q) => !("a" in q)));
  assert.match(free.headers.get("cache-control"), /public/);
  assert.equal((await call("content?kind=day&id=10")).status, 401);
  assert.equal((await call("content?kind=day&id=10", { token: "demo.forged.token" })).status, 401);
  assert.equal((await call("content?kind=day&id=abc")).status, 400);
});

test("student journey: free → trial → paid", async () => {
  const tok = await login("student", "journey1");
  let me = await call("me", { token: tok });
  assert.equal(me.data.access.tier, "free");
  assert.equal(me.data.access.canStartTrial, true);
  assert.equal((await call("content?kind=day&id=10", { token: tok })).status, 402);

  // quiz: graded on the server, answers only come back after answering
  const d1 = course.days[0];
  const q = await call("quiz", { method: "POST", token: tok, body: { kind: "day", id: 1, answers: d1.quiz.map((x) => x.a) } });
  assert.equal(q.data.score, d1.quiz.length);
  assert.equal((await call("quiz", { method: "POST", token: tok, body: { kind: "day", id: 10, answers: course.days[9].quiz.map(() => 0) } })).status, 402, "can't grade a locked quiz to learn its answers");

  // progress sync round trip
  const now = Date.now();
  const p = await call("progress", { method: "POST", token: tok, body: { progress: { days: { 1: { s: { words: now }, done: now } }, xp: { dev12345: { "2026-11-15": 20 } } } } });
  assert.equal(p.data.progress.days[1].done, now);
  assert.equal((await call("progress", { token: tok })).data.progress.days[1].done, now);

  // trial
  const t = await call("me", { method: "POST", token: tok, body: { action: "start-trial" } });
  assert.equal(t.data.access.tier, "trial");
  assert.equal((await call("content?kind=day&id=10", { token: tok })).status, 200);
  const t2 = await call("me", { method: "POST", token: tok, body: { action: "start-trial" } });
  assert.deepEqual([t2.status, t2.data.error], [409, "trial-used"]);

  // checkout (demo) and payment
  const pay = await call("pay", { method: "POST", token: tok, body: { plan: "self_quarter" } });
  assert.equal(pay.data.demo, true);
  assert.match(pay.data.url, /demo_checkout=self_quarter/);
  assert.equal((await call("pay", { method: "POST", token: tok, body: { plan: "lifetime_free" } })).status, 400);
  await call("dev", { method: "POST", token: tok, body: { action: "pay", plan: "self_quarter" } });
  me = await call("me", { token: tok });
  assert.equal(me.data.access.tier, "self");
  assert.ok(me.data.access.paidUntil > Date.now() + 80 * 86400000);
  assert.equal(me.data.voice.minutesLeft, 30);
});

test("AI teacher: signed-in only, daily limit counts down", async () => {
  assert.equal((await call("ai", { method: "POST", body: { action: "check", text: "I go to dock" } })).status, 401);
  const tok = await login("student", "ai1");
  const r1 = await call("ai", { method: "POST", token: tok, body: { action: "check", text: "I waiting since two hours", lang: "uz" } });
  assert.equal(r1.status, 200);
  assert.ok(r1.data.verdict);
  const r2 = await call("ai", { method: "POST", token: tok, body: { action: "check", text: "Second try", lang: "uz" } });
  assert.equal(r2.data.left, r1.data.left - 1);
  assert.equal((await call("ai", { method: "POST", token: tok, body: { action: "check", text: "x".repeat(401) } })).status, 400);
  // free tier: 3 a day
  await call("ai", { method: "POST", token: tok, body: { action: "check", text: "Third", lang: "uz" } });
  const r4 = await call("ai", { method: "POST", token: tok, body: { action: "check", text: "Fourth", lang: "uz" } });
  assert.deepEqual([r4.status, r4.data.error], [429, "daily-limit"]);
});

test("voice teacher needs a paid plan and a configured agent", async () => {
  const tok = await login("student", "voice1");
  const r = await call("ai", { method: "POST", token: tok, body: { action: "voice-start" } });
  assert.ok([402, 503].includes(r.status), "free plan or not configured");
});

test("admin: students are refused, admins can manage, nobody can change their own role", async () => {
  const student = await login("student", "adm1");
  assert.equal((await call("admin?view=stats", { token: student })).status, 403);
  const admin = await login("admin");
  const s = await call("admin?view=stats", { token: admin });
  assert.equal(s.status, 200);
  assert.ok(s.data.users >= 1);
  const me = (await call("me", { token: student })).data.user;
  const g = await call("admin", { method: "POST", token: admin, body: { action: "grant", uid: me.uid, tier: "pro", days: 7, note: "test" } });
  assert.equal(g.status, 200);
  assert.equal((await call("me", { token: student })).data.access.tier, "pro");
  const detail = await call("admin?view=user&uid=" + encodeURIComponent(me.uid), { token: admin });
  const manual = detail.data.payments.find((p) => p.provider === "manual");
  assert.ok(manual);
  await call("admin", { method: "POST", token: admin, body: { action: "revoke", paymentId: manual.id, reason: "test" } });
  assert.equal((await call("me", { token: student })).data.access.tier, "free");
  assert.equal((await call("admin", { method: "POST", token: admin, body: { action: "role", uid: "demoadmin", role: "student" } })).status, 400);
  const teacher = await login("teacher");
  assert.equal((await call("admin?view=users", { token: teacher })).status, 200, "teachers can look");
  assert.equal((await call("admin", { method: "POST", token: teacher, body: { action: "grant", uid: me.uid, tier: "pro", days: 7 } })).status, 403, "only admins change things");
  assert.equal((await call("admin?view=payments", { token: teacher })).status, 403);
});

test("webhooks and voice files refuse anything unsigned or off-list", async () => {
  assert.equal((await call("webhooks?src=whop", { method: "POST", body: { type: "payment.succeeded" } })).status, 503, "no secret set: refuse");
  assert.equal((await call("webhooks?src=telegram", { method: "POST", body: {} })).status, 503);
  assert.equal((await call("webhooks?src=other", { method: "POST", body: {} })).status, 404);
  const tts = await call("tts?g=female&t=Hello&v=1&cachebust=1");
  assert.equal(tts.status, 400);
  assert.doesNotMatch(tts.headers.get("cache-control") || "", /immutable|max-age=[1-9]/);
  assert.equal((await call("dev", { method: "POST", body: { action: "pay", plan: "self_month" } })).status, 401, "demo payments still need an account");
});

test("server files are never served; security headers are set", async () => {
  for (const p of ["/content/course.json", "/lib/env.js", "/server.mjs", "/.env", "/package.json", "/api/../server.mjs", "/%2e%2e/server.mjs", "/data/../../server.mjs"]) {
    const r = await fetch(BASE + p);
    assert.ok(r.status === 404 || r.status === 400, p + " -> " + r.status);
  }
  for (const p of ["/%E0%A4%A", "/v/%", "/app/%00"]) assert.equal((await fetch(BASE + p)).status, 400, p + " is refused, not a crash");
  const home = await fetch(BASE + "/");
  assert.equal(home.status, 200, "server still up after malformed URLs");
  assert.match(home.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  for (const p of ["/app", "/app/day/12", "/v/7", "/admin/users"]) assert.equal((await fetch(BASE + p)).status, 200, p);
  assert.equal((await fetch(BASE + "/no-such-page")).status, 404);
});
