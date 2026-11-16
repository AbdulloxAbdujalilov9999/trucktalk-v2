#!/usr/bin/env node
/* End-to-end check in a real browser (Chromium via Playwright), against the app running in demo mode.
 * Walks what a student and an admin actually do, fails on any broken step, page error or server error, and saves phone-size
 * screenshots to e2e/screenshots/.
 *   npm run e2e                 (needs Playwright: npm i --no-save playwright && npx playwright install chromium)
 *   E2E_BASE=http://localhost:3000 npm run e2e    (use a server that is already running) */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch {
  console.error("Playwright is not installed. Run: npm i --no-save playwright && npx playwright install chromium");
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "e2e", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const course = JSON.parse(fs.readFileSync(path.join(ROOT, "content/course.json"), "utf8"));

// ---------------------------------------------------------------- server
let server = null, BASE = process.env.E2E_BASE;
if (!BASE) {
  const port = 4100 + Math.floor(Math.random() * 500);
  BASE = "http://127.0.0.1:" + port;
  const env = { ...process.env, DEMO_MODE: "1", PORT: String(port), DEMO_DB_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tt2e2e-")), "db.json") };
  for (const k of ["FIREBASE_SERVICE_ACCOUNT", "ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_API_KEY", "WHOP_API_KEY", "TELEGRAM_BOT_TOKEN"]) delete env[k];
  server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + "/api/config")).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------- harness
const browser = await chromium.launch();
const results = [], problems = [];
function watch(page) {
  page.on("pageerror", (e) => problems.push(`page error on ${page.url()}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console error on ${page.url()}: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
}
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(["ok", name, Date.now() - t0]); console.log("  ok   " + name); }
  catch (e) { results.push(["FAIL", name, e.message]); console.log("  FAIL " + name + "\n       " + e.message.split("\n")[0]); }
}
const shot = (page, name) => page.waitForTimeout(250).then(() => page.screenshot({ path: path.join(SHOTS, name + ".png") }));
const expectText = async (page, re, timeout = 8000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), re.source, { timeout });

// a phone: what most drivers use
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "uz-UZ" });
const page = await ctx.newPage();
watch(page);
console.log("TruckTalk e2e against " + BASE);

await step("landing page explains the app and offers the lesson-number box", async () => {
  await page.goto(BASE + "/");
  await expectText(page, /ishonch bilan gapiring/);
  await shot(page, "01-landing");
  await page.click('#langsw [data-lang="ru"]');
  await expectText(page, /Говорите уверенно/);
  await page.click('#langsw [data-lang="uz"]');
  if ((await page.$$('a[href^="/v/"]')).length < 50) throw new Error("landing should link all 50 lessons");
});

await step("typing the number from a video opens that lesson", async () => {
  await page.fill("#jumpN", "99");
  await page.click("#jumpForm button");
  await page.waitForSelector("#jumpErr:not([hidden])");
  await page.fill("#jumpN", "12");
  await page.click("#jumpForm button");
  await page.waitForURL("**/v/12");
  await expectText(page, /Traklar uchun cheklov belgilari/);
  await shot(page, "02-video-lesson");
});

await step("video lesson: self-test and add phrases to review", async () => {
  await page.click('[data-act="practice"]');
  const n = (await page.$$(".quiz-q")).length;
  for (let i = 0; i < n; i++) await page.click(`[data-act="vpick"][data-q="${i}"][data-o="0"]`);
  await page.click('[data-act="vcheck"]');
  await page.waitForSelector("#practice .result");
  await page.click('[data-act="addreview"]');
  await page.waitForSelector('[data-act="addreview"][disabled]');
});

await step("free lesson opens without an account; a paid one shows the lock", async () => {
  await page.goto(BASE + "/app/day/1");
  await page.waitForSelector(".steps");
  await page.goto(BASE + "/app/day/10");
  await expectText(page, /Tariflarni koʻrish/);
  await shot(page, "03-locked-lesson");
});

await step("sign in (demo) returns to the lesson, then the free trial unlocks it", async () => {
  await page.goto(BASE + "/app/signin?next=/app/day/10");
  await shot(page, "04-signin");
  await page.click('[data-act="demo"][data-as="student"]');
  await page.waitForURL("**/app/day/10");
  await page.click('[data-act="trial"]');
  await page.waitForSelector(".steps", { timeout: 8000 });
});

await step("a whole lesson: words, dialogue, tip, quiz (graded by the server), speaking", async () => {
  await page.goto(BASE + "/app/day/1");
  await page.waitForSelector(".steps");
  await shot(page, "05-lesson-words");
  await page.click('[data-act="finish"][data-s="words"]');
  await page.click('[data-act="finish"][data-s="dialogue"]');
  await page.click('[data-act="finish"][data-s="grammar"]');
  const answers = course.days[0].quiz.map((q) => q.a);
  for (let i = 0; i < answers.length; i++) await page.click(`[data-act="pick"][data-q="${i}"][data-o="${answers[i]}"]`);
  await page.click('[data-act="check"]');
  await page.waitForSelector(".result");
  await expectText(page, new RegExp(`${answers.length}\\s*/\\s*${answers.length}`));
  await shot(page, "06-lesson-quiz");
  await page.click('.row [data-act="step"][data-s="speak"]');
  await page.click('[data-act="finish"][data-s="speak"]');
  await page.waitForSelector(".modal");
  await shot(page, "07-lesson-complete");
  await page.click(".modal [data-close]");
});

await step("review: words from the lesson come back as cards", async () => {
  await page.goto(BASE + "/app/review");
  await page.waitForSelector(".flash");
  await page.click('[data-act="show"]');
  await page.click('[data-act="grade"][data-k="1"]');
  await shot(page, "08-review");
});

await step("AI teacher checks a sentence and counts the daily limit", async () => {
  await page.goto(BASE + "/app/teacher");
  await page.fill("#tq", "I waiting at the dock since two hours.");
  await page.click('[data-act="send"]');
  await page.waitForSelector(".card.flat .badge");
  await shot(page, "09-ai-teacher");
});

await step("practice: trucking numbers are read aloud, typed and checked", async () => {
  await page.goto(BASE + "/app/practice");
  await expectText(page, /Yoʻlda tinglash/);
  await shot(page, "14-practice");
  await page.click('a[href="/app/practice/numbers"]');
  await page.click('[data-act="kind"][data-k="time"]');
  await page.click('[data-act="start"]');
  await page.fill("#ans", "1");
  await page.click('#drillForm button[type="submit"]');
  await page.waitForSelector(".answer");
  await expectText(page, /Aytilgani/);
  await shot(page, "15-numbers");
  await page.click('[data-act="next"]');
  await page.waitForSelector("#ans:not([disabled])");
});

await step("practice: match the pairs, then build a sentence from the lesson's words", async () => {
  await page.goto(BASE + "/app/practice/match?set=day:1");
  await page.waitForSelector(".pairs");
  const ks = await page.$$eval('.pairs [data-act="l"]', (els) => els.map((e) => e.dataset.k));
  await page.click(`[data-act="l"][data-k="${ks[0]}"]`);
  await page.click(`[data-act="r"][data-k="${ks[0]}"]`);
  await page.waitForSelector(`[data-act="l"][data-k="${ks[0]}"].right`);
  await shot(page, "16-match");
  for (const k of ks.slice(1)) { await page.click(`[data-act="l"][data-k="${k}"]`); await page.click(`[data-act="r"][data-k="${k}"]`); }
  await expectText(page, /5 tadan 5 ta toʻgʻri/);
  await page.goto(BASE + "/app/practice/build?set=day:1");
  await page.waitForSelector(".tiles");
  while (await page.$('.tiles button.tile')) await page.click('.tiles button.tile >> nth=0');
  await page.click('[data-act="check"]');
  await page.waitForSelector(".answer-line.ok, .answer-line.bad");
  await shot(page, "17-build");
});

await step("listen in the truck: the hands-free player steps through a phrase", async () => {
  await page.goto(BASE + "/app/listen?set=video:1");
  await page.waitForSelector(".player");
  await expectText(page, /Haydashdan oldin/);
  await page.click('[data-act="toggle"]');
  await page.waitForSelector(".player-steps span.on");
  await shot(page, "18-listen");
  await page.click('[data-act="next"]');
  await page.waitForFunction(() => /^2 \//.test(document.querySelector(".player .muted").innerText));
  await page.click('[data-act="toggle"]');
  await page.waitForSelector('.player [data-act="toggle"] svg rect', { state: "detached" });
});

await step("conversation practice: the AI officer answers and coaches each line", async () => {
  await page.goto(BASE + "/app/talk");
  await page.waitForSelector(".scene");
  await page.click('a[href="/app/talk/police"]');
  await expectText(page, /Do you know why I stopped you/);
  await page.click('[data-act="sugg"] >> nth=0');
  await page.click('[data-act="send"]');
  await page.waitForSelector(".feedback");
  await expectText(page, /license, registration and insurance/);
  await shot(page, "19-talk");
  for (const line of ["Here is my license and registration.", "I am going to Dallas with a load of paper."]) {
    await page.fill("#msg", line);
    await page.click('[data-act="send"]');
    await page.waitForFunction((n) => document.querySelectorAll(".feedback").length >= n, line.startsWith("Here") ? 2 : 3);
  }
  await expectText(page, /Suhbat tugadi/);
});

await step("buying a plan (demo checkout) opens it at once", async () => {
  await page.goto(BASE + "/app/pricing");
  await page.waitForSelector(".plans");
  await shot(page, "10-pricing");
  await page.click('[data-act="buy"][data-plan="self_quarter"]');
  await page.click(".modal [data-act=demopay]");
  await expectText(page, /tarifi .* gacha faol/);
});

await step("profile: plan, stats, badges and settings", async () => {
  await page.goto(BASE + "/app/profile");
  await expectText(page, /Mustaqil tarifi/);
  await page.click('[data-act="goal"][data-v="50"]');
  await page.waitForSelector('[data-act="goal"][data-v="50"].on');
  await expectText(page, /Birinchi kun/);
  await shot(page, "11-profile");
});

await step("the certificate opens after the final road test", async () => {
  await page.goto(BASE + "/app/certificate");
  await expectText(page, /Sertifikat yakuniy imtihon/);
  // stands in for finishing the course: the server merges it into the account like any other progress
  const ok = await page.evaluate(async () => {
    const now = Date.now(), days = {};
    for (let n = 1; n <= 60; n++) days[n] = { s: { quiz: now }, done: now };
    const r = await fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + localStorage.getItem("tt2:demo-token") },
      body: JSON.stringify({ progress: { days } }),
    });
    return r.ok;
  });
  if (!ok) throw new Error("progress upload failed");
  await page.reload();
  await page.waitForSelector(".cert-name");
  await expectText(page, /Certificate of completion/);
  await shot(page, "13-certificate");
});

await step("progress is saved to the account (a new phone gets it back)", async () => {
  await page.goto(BASE + "/app/profile");
  await page.waitForSelector("#syncLine");
  await page.waitForFunction(() => /hisobingizga saqlanadi/.test(document.getElementById("syncLine").innerText), null, { timeout: 10000 });
  const token = await page.evaluate(() => localStorage.getItem("tt2:demo-token"));
  const phone2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phone2.addInitScript((t) => { localStorage.setItem("tt2:demo-token", t); localStorage.setItem("tt2:lang", "uz"); }, token);
  const p2 = await phone2.newPage();
  watch(p2);
  await p2.goto(BASE + "/app/course");
  await p2.waitForSelector(".drow.done", { state: "attached", timeout: 10000 });
  await phone2.close();
});

await step("works offline after the first visit", async () => {
  await page.goto(BASE + "/app");
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(async () => { await page.reload(); });
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
  await ctx.setOffline(true);
  await page.goto(BASE + "/app/videos").catch(() => {});
  await page.waitForSelector("#offline:not(.hidden)", { timeout: 10000 });
  await page.goto(BASE + "/v/3");
  await expectText(page, /Trakdagi hujjatlar/);
  await ctx.setOffline(false);
});

await step("admin: sign in, see the student, give a plan, see it in the audit log", async () => {
  await page.goto(BASE + "/app/profile");
  await page.click('[data-act="signout"]');
  await page.waitForURL("**/app");
  await page.goto(BASE + "/app/signin?next=/admin");
  await page.click('[data-act="demo"][data-as="admin"]');
  await page.waitForURL("**/admin");
  await expectText(page, /accounts/);
  await shot(page, "12-admin");
  await page.goto(BASE + "/admin/users?filter=paid");
  await page.click("tr.clickable >> nth=0");
  await page.waitForSelector("#grantForm");
  await page.selectOption('#grantForm select[name="tier"]', "pro");
  await page.selectOption('#grantForm select[name="days"]', "7");
  await page.fill('#grantForm input[name="note"]', "e2e test");
  await page.click("#grantForm button");
  await expectText(page, /manual/);
  await page.goto(BASE + "/admin/audit");
  await expectText(page, /grant/);
  await page.goto(BASE + "/admin/marketing");
  await expectText(page, /\/v\/50/);
});

await step("desktop layout", async () => {
  const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const d = await desk.newPage();
  watch(d);
  await d.goto(BASE + "/");
  await d.screenshot({ path: path.join(SHOTS, "20-desktop-landing.png") });
  await d.goto(BASE + "/app");
  await d.waitForSelector(".hero");
  await d.screenshot({ path: path.join(SHOTS, "21-desktop-home.png") });
  await desk.close();
});

await browser.close();
if (server) server.kill();

const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} steps passed, ${problems.length} page/server problems.`);
if (problems.length) console.log(problems.map((p) => "  - " + p).join("\n"));
console.log("Screenshots: " + path.relative(process.cwd(), SHOTS));
process.exit(failed.length || problems.length ? 1 : 0);
