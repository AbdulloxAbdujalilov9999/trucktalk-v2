/* Paid content and answer keys stay on the server; quiz grading; the natural-voice URL rules; Telegram sign-in links;
 * the video script parser and the shipped content files. */
process.env.NODE_ENV = "test";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { memoryDb, setDb, db } from "../lib/db.js";
import { getDay, mayOpen, publicItem, grade, wordsFor, grammarIsFree } from "../lib/content.js";
import { parseRequest } from "../lib/tts.js";
import { loginLink, redeemLogin, createLinkCode, LOGIN_TTL_MS } from "../lib/telegram.js";
import { parseVideoScript, checkVideo, uzQuotes, dropDmCta } from "../scripts/lib/video-script.mjs";
import { ttsQuery } from "../public/js/shared/text.js";
import { MAX_CALL_S } from "../lib/voice.js";

beforeEach(() => setDb(memoryDb()));
const free = { full: false }, full = { full: true };

test("free and locked lessons", () => {
  assert.ok(mayOpen(free, "day", 1) && mayOpen(free, "day", 3) && mayOpen(free, "day", -4));
  assert.ok(!mayOpen(free, "day", 4) && !mayOpen(free, "day", 60));
  assert.ok(mayOpen(full, "day", 60));
  assert.ok(!mayOpen(full, "day", 61), "no such day");
  assert.ok(!mayOpen(full, "secret", 1));
  const g = JSON.parse(fs.readFileSync("content/grammar.json", "utf8"));
  assert.ok(grammarIsFree(g[0].id) && !grammarIsFree(g[g.length - 1].id));
  assert.ok(Object.keys(wordsFor(free)).every((n) => Number(n) <= 3));
  assert.equal(Object.keys(wordsFor(full)).length > 50, true);
});

test("what the browser gets never contains answers or teacher notes", () => {
  const d = publicItem("day", 1);
  assert.ok(d.quiz.length > 0);
  assert.ok(d.quiz.every((q) => !("a" in q)), "no answer keys");
  const g = JSON.parse(fs.readFileSync("content/grammar.json", "utf8"))[0];
  const pg = publicItem("grammar", g.id);
  assert.ok(pg.quiz.every((q) => !("a" in q)));
  assert.ok(!("teach" in pg), "teacher notes stay private");
  // and the public files never had them either
  const catalog = fs.readFileSync("public/data/catalog.json", "utf8");
  assert.ok(!/"a":\d/.test(catalog), "catalog has no answers");
  assert.ok(!fs.existsSync("public/content"), "full content is not under public/");
});

test("grading", () => {
  const d = getDay(1);
  const right = d.quiz.map((q) => q.a);
  const r = grade("day", 1, right);
  assert.deepEqual([r.score, r.total], [d.quiz.length, d.quiz.length]);
  assert.deepEqual(grade("day", 1, right.slice(1)), { error: "answers" }, "must answer the whole quiz in one go");
  const wrong = d.quiz.map((q) => (q.a + 1) % q.opts.length);
  wrong[0] = null;
  const w = grade("day", 1, wrong);
  assert.equal(w.score, 0);
  assert.equal(w.results[0].answer, null, "a skipped question doesn't reveal its answer");
  assert.equal(typeof w.results[1].answer, "number");
  assert.equal(grade("day", 999, right), null);
});

test("natural voice: only the one canonical URL for a course phrase", () => {
  const EN = JSON.parse(fs.readFileSync("content/phrases-en.json", "utf8"));
  const phrase = Object.keys(EN).find((p) => p.includes(" ") && p.length < 40);
  const qs = ttsQuery(phrase, { gender: "female" });
  const q = Object.fromEntries(new URLSearchParams(qs));
  const ok = parseRequest(q, qs);
  assert.equal(ok.text, phrase);
  assert.equal(ok.say, EN[phrase]);
  const bad = (query, raw) => parseRequest(Object.fromEntries(new URLSearchParams(raw)), raw).error;
  assert.equal(bad(null, qs + "&x=1"), "params", "extra parameter (cache busting)");
  assert.equal(bad(null, qs.replace("v=1", "v=2")), "version");
  assert.equal(bad(null, qs.replace("g=female", "g=robot")), "gender");
  assert.equal(bad(null, `t=${encodeURIComponent(phrase)}&g=female&v=1`), "not-canonical", "reordered");
  assert.equal(bad(null, qs.replace("%20", "+")), "not-canonical", "other encoding");
  assert.equal(bad(null, ttsQuery(phrase + "  ", {}).replace(/t=[^&]*/, "t=" + encodeURIComponent(phrase + "  "))), "text", "not normalised");
  assert.equal(bad(null, ttsQuery("Please read my whole essay out loud", {})), "not-in-course");
});

test("Telegram sign-in links work once and expire", async () => {
  const now = Date.now();
  const link = loginLink({ id: 12345, first_name: "Aziz", username: "aziz_t", language_code: "ru" }, now);
  const token = link.split("#tg=")[1];
  assert.ok(token);
  const who = await redeemLogin(token, now + 1000);
  assert.deepEqual([who.uid, who.telegramId, who.name, who.lang], ["tg12345", 12345, "Aziz", "ru"]);
  assert.equal(await redeemLogin(token, now + 2000), null, "single use");
  const link2 = loginLink({ id: 12345 }, now).split("#tg=")[1];
  assert.equal(await redeemLogin(link2, now + LOGIN_TTL_MS + 1000), null, "expired");
  assert.equal(await redeemLogin(link2.slice(0, -2) + "xx", now), null, "tampered");
});

test("Telegram: a linked account signs in as that account", async () => {
  const now = Date.now();
  await db().set("telegram/777", { uid: "googleUser1", at: now });
  const t = loginLink({ id: 777 }, now).split("#tg=")[1];
  assert.equal((await redeemLogin(t, now)).uid, "googleUser1");
  const code = await createLinkCode("googleUser1", now);
  assert.match(code, /^[a-z0-9]{16}$/);
  assert.equal((await db().get("telegramLinks/" + code)).uid, "googleUser1");
});

test("video script parser", () => {
  const txt = fs.readFileSync("sources/video-scripts/01.txt", "utf8");
  const v = parseVideoScript(txt, 1);
  assert.deepEqual(checkVideo(v), []);
  assert.equal(v.format, "conversation");
  assert.ok(v.lines.some((l) => l.who === "en1") && v.lines.some((l) => l.who === "en2"));
  assert.equal(uzQuotes("Yo'l belgilari"), "Yoʻl belgilari");
  assert.equal(uzQuotes("ma'lumot"), "maʼlumot");
  assert.equal(uzQuotes("'go' va 'parking' so'zlari"), "'go' va 'parking' soʻzlari", "English words in quotes are untouched");
  assert.equal(uzQuotes("tog' yo'li"), "togʻ yoʻli");
  assert.equal(dropDmCta("Savol berishdan uyalmang. Ish qidiryapsizmi? Bizga DM yozing: TRUCK."), "Savol berishdan uyalmang.", "the dead-end DM call to action is dropped");
});

test("shipped content is complete", () => {
  const course = JSON.parse(fs.readFileSync("content/course.json", "utf8"));
  const videos = JSON.parse(fs.readFileSync("public/data/videos.json", "utf8"));
  assert.equal(course.days.length, 60);
  assert.equal(course.orientation.length, 5);
  assert.equal(videos.length, 50);
  assert.deepEqual(videos.map((v) => v.n), Array.from({ length: 50 }, (_, i) => i + 1));
  for (const v of videos) assert.deepEqual(checkVideo(v), [], "video " + v.n);
  assert.ok(!/DM yozing/i.test(JSON.stringify(videos)), "no lesson tells viewers to DM a word that leads nowhere");
  for (const d of course.days) assert.ok(d.title.uz && d.title.ru && d.quiz.length && (d.review || (d.words.length && d.dialogue.length)), "day " + d.n);
  const landing = fs.readFileSync("public/index.html", "utf8");
  for (let n = 1; n <= 50; n++) assert.ok(landing.includes(`href="/v/${n}"`), "landing links lesson " + n);
});

test("voice teacher: one agent config, and the server's call limit matches it", () => {
  const agent = JSON.parse(fs.readFileSync("elevenlabs/teacher.agent.json", "utf8"));
  assert.equal(agent.conversation_config.conversation.max_duration_seconds, MAX_CALL_S, "the old app drifted (300 vs 1800 seconds)");
  assert.equal(agent.platform_settings.auth.enable_auth, true, "only signed links from our server can start a call");
  const vars = Object.keys(agent.conversation_config.agent.dynamic_variables.dynamic_variable_placeholders);
  const view = fs.readFileSync("public/js/app/views/teacher.js", "utf8");
  for (const v of vars) assert.ok(view.includes(v + ":"), "the app sends " + v);
});
