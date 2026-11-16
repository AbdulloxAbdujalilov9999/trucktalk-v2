/* Progress sync: merging two copies never loses anything, and the server keeps only sane shapes. */
import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY, merge, sanitize, streak, bestStreak, totalXp, review, dueCards, addCard, BOX_DAYS, dayKey } from "../public/js/shared/progress.js";

const T = Date.UTC(2026, 10, 10, 12);
const phone = () => ({
  ...EMPTY(),
  days: { 1: { s: { words: T, quiz: T + 5 }, done: T + 10 }, 2: { s: { words: T + 20 } } },
  videos: { 3: { seen: T, best: 60 } },
  quiz: { "day:1": { best: 4, total: 6, at: T } },
  srs: { "w:1:0": { b: 2, due: T + 86400000, u: T + 1 } },
  xp: { phone1: { [dayKey(T)]: 30 } },
  goal: { v: 50, u: T },
  set: { voice: { v: "male", u: T } },
});
const laptop = () => ({
  ...EMPTY(),
  days: { 1: { s: { words: T - 100 } }, 3: { s: { dialogue: T } } },
  videos: { 3: { seen: T - 50, best: 80 }, 4: { seen: T } },
  quiz: { "day:1": { best: 6, total: 6, at: T - 1 } },
  srs: { "w:1:0": { b: 0, due: T, u: T + 99 }, "v:3:1": { b: 1, due: T, u: T } },
  xp: { laptop1: { [dayKey(T)]: 20 }, phone1: { [dayKey(T)]: 25 } },
  goal: { v: 30, u: T - 5 },
  set: { voice: { v: "female", u: T + 1 } },
});

test("merge keeps the best of both copies", () => {
  const m = merge(phone(), laptop());
  assert.equal(m.days[1].s.words, T - 100, "first completion wins");
  assert.equal(m.days[1].done, T + 10);
  assert.ok(m.days[2] && m.days[3], "days from both");
  assert.deepEqual(m.videos[3], { seen: T - 50, best: 80 });
  assert.equal(m.quiz["day:1"].best, 6, "best score wins");
  assert.equal(m.srs["w:1:0"].u, T + 99, "latest review wins");
  assert.equal(totalXp(m), 50, "xp: max per device per day, summed over devices (30 + 20)");
  assert.equal(m.goal.v, 50);
  assert.equal(m.set.voice.v, "female");
});

test("merge is commutative and idempotent", () => {
  const a = phone(), b = laptop();
  const ab = merge(a, b), ba = merge(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(merge(ab, ab), ab);
  assert.deepEqual(merge(merge(ab, a), b), ab);
});

test("sanitize drops junk and impossible values", () => {
  const now = T + 1000;
  const s = sanitize({
    days: { 1: { s: { words: T, hack: T }, done: "yes" }, 999: { done: T }, x: {} },
    videos: { 0: { seen: T }, 51: { seen: T }, 7: { best: 500 } },
    quiz: { "day:1": { best: 9, total: 6 }, "evil:1": { best: 1, total: 1 } },
    srs: { "w:1:0": { b: 9, due: T, u: T }, "w:1:1": { b: 1, due: T, u: T } },
    xp: { dev123: { "2026-11-10": 999999, "2026-11-11": 40 } },
    goal: { v: 5000, u: T },
    set: { voice: { v: "male", u: T }, isAdmin: { v: true, u: T } },
    __proto__: { polluted: true },
  }, now);
  assert.deepEqual(s.days, { 1: { s: { words: T } } });
  assert.deepEqual(s.videos, {});
  assert.deepEqual(s.quiz, {});
  assert.deepEqual(Object.keys(s.srs), ["w:1:1"]);
  assert.deepEqual(s.xp, { dev123: { "2026-11-11": 40 } });
  assert.equal(s.goal, null);
  assert.deepEqual(Object.keys(s.set), ["voice"]);
  assert.equal(({}).polluted, undefined);
});

test("sanitize keeps homework and role-play scores beside day, grammar and video ones", () => {
  const s = sanitize({ quiz: {
    "hw:12": { best: 18, total: 20, at: T }, "hw:-3": { best: 9, total: 10, at: T }, "rp:7": { best: 80, total: 100, at: T },
    "day:1": { best: 5, total: 5, at: T }, "grammar:to-be": { best: 4, total: 6, at: T }, "video:3": { best: 7, total: 8, at: T },
    "hw:": { best: 1, total: 1, at: T }, "hw:1 2": { best: 1, total: 1, at: T }, "rp:9": { best: 3, total: 0, at: T }, "homework:1": { best: 1, total: 1, at: T },
  } }, T + 1000);
  assert.deepEqual(Object.keys(s.quiz).sort(), ["day:1", "grammar:to-be", "hw:-3", "hw:12", "rp:7", "video:3"]);
  const m = merge({ ...EMPTY(), quiz: { "hw:12": { best: 12, total: 20, at: T } } }, { ...EMPTY(), quiz: { "hw:12": { best: 18, total: 20, at: T - 5 } } });
  assert.equal(m.quiz["hw:12"].best, 18, "the best homework score wins");
});

test("sanitize rejects timestamps from the future and before 2024", () => {
  const s = sanitize({ days: { 1: { s: { words: T + 30 * 86400000 } }, 2: { s: { words: 1000 } } } }, T);
  assert.deepEqual(s.days, {});
});

test("streaks", () => {
  const day = (i) => dayKey(T - i * 86400000);
  const p = { ...EMPTY(), xp: { d1: { [day(0)]: 5, [day(1)]: 5, [day(2)]: 5, [day(5)]: 5, [day(6)]: 5, [day(7)]: 5, [day(8)]: 5 } } };
  assert.equal(streak(p, T), 3);
  assert.equal(bestStreak(p), 4);
  const notYetToday = { ...EMPTY(), xp: { d1: { [day(1)]: 5, [day(2)]: 5 } } };
  assert.equal(streak(notYetToday, T), 2, "a streak survives until the day is over");
});

test("spaced review boxes", () => {
  let c = null;
  for (let i = 1; i < BOX_DAYS.length + 2; i++) c = review(c, true, T);
  assert.equal(c.b, BOX_DAYS.length - 1, "caps at the last box");
  assert.equal(c.due, T + BOX_DAYS[BOX_DAYS.length - 1] * 86400000);
  const again = review(c, false, T);
  assert.equal(again.b, 0);
  assert.equal(again.due, T + 10 * 60 * 1000, "a miss comes back in 10 minutes");
  const p = EMPTY();
  addCard(p, "w:1:0", T); addCard(p, "w:1:1", T - 5);
  addCard(p, "w:1:0", T + 999);
  assert.deepEqual(dueCards(p, T), ["w:1:1", "w:1:0"]);
  assert.equal(p.srs["w:1:0"].u, T, "adding twice doesn't reset a card");
});
