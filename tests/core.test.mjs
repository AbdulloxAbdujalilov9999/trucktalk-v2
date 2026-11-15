/* Tokens, ID-token claim checks, the in-memory database and the shared text helpers. */
process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, safeEqual, newId, sha256hex } from "../lib/crypto.js";
import { claimsOk } from "../lib/firebase.js";
import { memoryDb, key, setDb, db } from "../lib/db.js";
import { housekeeping } from "../lib/admin.js";
import { normalize, ttsQuery, spoken, looseEqual } from "../public/js/shared/text.js";

test("signed tokens: round trip, tampering, expiry", () => {
  const secret = "x".repeat(40), now = Date.now();
  const tok = signToken({ a: 1, exp: now + 1000 }, secret);
  assert.deepEqual(verifyToken(tok, secret, now).a, 1);
  assert.equal(verifyToken(tok, "y".repeat(40), now), null, "other secret");
  const [body, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ a: 2, exp: now + 1000 })).toString("base64url") + "." + sig;
  assert.equal(verifyToken(forged, secret, now), null, "changed payload");
  assert.equal(verifyToken(body + ".", secret, now), null, "no signature");
  assert.equal(verifyToken(tok, secret, now + 2000), null, "expired");
  assert.equal(verifyToken(signToken({ a: 1 }, secret), secret, now), null, "tokens must expire");
});

test("safeEqual and ids", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "abcd"));
  assert.ok(!safeEqual("", undefined));
  const a = newId(), b = newId();
  assert.notEqual(a, b);
  assert.match(a, /^[a-z0-9]+$/);
  assert.equal(sha256hex("x").length, 64);
});

test("Firebase ID token claims", () => {
  const now = 1_800_000_000, project = "trucktalk-v2";
  const good = { aud: project, iss: "https://securetoken.google.com/" + project, sub: "u1", exp: now + 600, iat: now - 10, auth_time: now - 10 };
  assert.ok(claimsOk(good, project, now));
  assert.ok(!claimsOk({ ...good, aud: "other" }, project, now), "audience");
  assert.ok(!claimsOk({ ...good, iss: "https://securetoken.google.com/other" }, project, now), "issuer");
  assert.ok(!claimsOk({ ...good, exp: now - 3600 }, project, now), "expired");
  assert.ok(!claimsOk({ ...good, iat: now + 3600 }, project, now), "issued in the future");
  assert.ok(!claimsOk({ ...good, sub: "" }, project, now), "no subject");
  assert.ok(!claimsOk(good, "", now), "no project configured");
});

test("memory database: paths, multi-path update, createOnce, transaction, increment", async () => {
  const d = memoryDb();
  await d.set("users/a", { name: "A", n: 1 });
  await d.update("", { "users/a/role": "student", "users/b/name": "B" });
  assert.deepEqual(await d.get("users/a"), { name: "A", n: 1, role: "student" });
  await d.update("users/a", { n: { ".sv": { increment: 2 } }, "deep/x": 5 });
  assert.equal(await d.get("users/a/n"), 3);
  assert.equal(await d.get("users/a/deep/x"), 5);
  assert.equal(await d.createOnce("once/k", { v: 1 }), true);
  assert.equal(await d.createOnce("once/k", { v: 2 }), false);
  assert.deepEqual(await d.get("once/k"), { v: 1 });
  const t1 = await d.transaction("count", (c) => (c || 0) + 1);
  const t2 = await d.transaction("count", () => undefined);
  assert.deepEqual([t1.committed, t1.value, t2.committed, t2.value], [true, 1, false, 1]);
  await d.update("users/b", { name: null });
  assert.equal(await d.get("users/b"), null, "empty parents are pruned like the real database");
  assert.deepEqual(await d.shallow("users"), { a: true });
});

test("memory database: queries behave like the Realtime Database", async () => {
  const d = memoryDb();
  for (const [id, at, email] of [["u1", 30, "a@x.com"], ["u2", 10, "b@x.com"], ["u3", 20, "a@x.com"], ["u4", null, "c@x.com"]]) {
    await d.set("users/" + id, { createdAt: at, email, trial: at ? { endsAt: at * 2 } : null });
  }
  assert.deepEqual(Object.keys(await d.query("users", { orderBy: "createdAt", limitToLast: 2 })), ["u3", "u1"]);
  assert.deepEqual(Object.keys(await d.query("users", { orderBy: "createdAt", startAt: 15 })).sort(), ["u1", "u3"]);
  assert.deepEqual(Object.keys(await d.query("users", { orderBy: "email", equalTo: "a@x.com" })).sort(), ["u1", "u3"]);
  assert.deepEqual(Object.keys(await d.query("users", { orderBy: "trial/endsAt", startAt: 50 })), ["u1"]);
});

test("key() refuses anything that could escape its path", () => {
  for (const bad of ["", "a/b", "a.b", "a#", "$x", "[x]", "a\u0000", "x".repeat(201)]) assert.throws(() => key(bad), /bad key/);
  assert.equal(key("demo_abc-1"), "demo_abc-1");
});

test("text helpers: normalize, spoken form, canonical voice query", () => {
  assert.equal(normalize("  Hello   there...  "), "Hello there");
  assert.equal(spoken("Hello / Hi"), "Hello, Hi");
  assert.equal(ttsQuery("Hi there", { gender: "male" }), "g=male&t=Hi%20there&v=1");
  assert.equal(ttsQuery("Salom", { lang: "uz" }), "l=uz&t=Salom&v=1");
  assert.ok(looseEqual("I'm here!", "i’m  HERE"));
  assert.ok(!looseEqual("I'm here", "I am there"));
});

test("housekeeping: old counters, used tokens and old webhook ids go; everything else stays; once a day", async () => {
  setDb(memoryDb());
  const NOW = Date.UTC(2026, 10, 15, 12), DAY = 86400000;
  await db().update("", {
    "usage/2026-09-01/ai/u1": 3, "usage/2026-11-14/ai/u1": 2,
    "loginTokens/old": { at: NOW - 3 * DAY, exp: NOW - 3 * DAY }, "loginTokens/fresh": { at: NOW, exp: NOW + 600000 },
    "telegramLinks/oldcode1": { uid: "u1", exp: NOW - 2 * DAY }, "telegramLinks/newcode1": { uid: "u1", exp: NOW + 600000 },
    "whop/events/e1": { at: NOW - 40 * DAY }, "whop/events/e2": { at: NOW - DAY },
    "users/u1": { createdAt: NOW - 90 * DAY }, "payments/u1/p1": { at: NOW - 90 * DAY, status: "paid" },
  });
  assert.deepEqual(await housekeeping(NOW), { usage: 1, loginTokens: 1, telegramLinks: 1, whopEvents: 1 });
  assert.deepEqual(Object.keys(await db().get("usage")), ["2026-11-14"]);
  assert.deepEqual(Object.keys(await db().get("loginTokens")), ["fresh"]);
  assert.deepEqual(Object.keys(await db().get("telegramLinks")), ["newcode1"]);
  assert.deepEqual(Object.keys(await db().get("whop/events")), ["e2"]);
  assert.ok(await db().get("users/u1") && await db().get("payments/u1/p1"), "accounts and payments are never touched");
  assert.deepEqual(await housekeeping(NOW + 1000), { skipped: true }, "at most once a day");
});

