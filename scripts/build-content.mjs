#!/usr/bin/env node
/* Builds every content file the app uses from the sources in sources/:
 *   sources/v1/*.js            the current TruckTalk course (60 days + 5 orientation days, 33 grammar units, Uzbek and
 *                              Russian translations), loaded exactly as the old app loads them
 *   sources/video-scripts/*.txt the 50 published video lessons
 * Writes:
 *   content/course.json        full days incl. quiz answers         (server only: never served as a file)
 *   content/grammar.json       full grammar units incl. answers     (server only)
 *   content/phrases-en.json    { phrase: spokenText } natural-voice allowlist (English, incl. the conversation openings)
 *   content/phrases-uz.json    { phrase: 1 } natural-voice allowlist (Uzbek: the narrator lines of the video lessons and
 *                              the translations the "Listen in the truck" player reads out)
 *   public/data/catalog.json   titles, order and free/locked flags (public)
 *   public/data/videos.json    the 50 video lessons (public: they are free)
 *   public/index.html          the landing page: the lesson list and plan cards, and its Uzbek text from public/js/app/i18n.js
 * Run: npm run build:content   (check mode: node scripts/build-content.mjs --check  fails if the files are out of date) */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { normalize, spoken } from "../public/js/shared/text.js";
import { dayIsFree, freeGrammarIds, PLANS, FEATURES } from "../public/js/shared/plans.js";
import { parseVideoScript, checkVideo, uzQuotes } from "./lib/video-script.mjs";
import { videoItems } from "../public/js/shared/videos.js";
import { SCENES } from "../public/js/shared/scenes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "sources");
const CHECK = process.argv.includes("--check");

// ---------------------------------------------------------------- load the v1 course exactly as the old app does
function loadV1() {
  const read = (f) => fs.readFileSync(path.join(SRC, "v1", f), "utf8");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(read("curriculum.js").replace(/^const CURRICULUM/m, "this.CURRICULUM").replace(/^const ORIENTATION/m, "this.ORIENTATION"), ctx);
  vm.runInContext(read("grammar.js").replace(/^const GRAMMAR/m, "this.GRAMMAR"), ctx);
  vm.runInContext(read("content-uz.js"), ctx);
  vm.runInContext(read("content-ru.js"), ctx);
  // week titles and grammar categories in uz/ru live in the old interface strings (const CONTENT = {...};)
  const i18n = read("i18n.js");
  const a = i18n.indexOf("const CONTENT = {"), b = i18n.indexOf("\n};", a);
  const labels = vm.runInNewContext("(" + i18n.slice(a + "const CONTENT = ".length, b + 2) + ")");
  return { days: ctx.CURRICULUM, orientation: ctx.ORIENTATION, grammar: ctx.GRAMMAR, uz: ctx.window.TT_CONTENT.uz, ru: ctx.window.TT_CONTENT.ru, labels };
}

const tri = (en, uz, ru) => ({ en: en || "", uz: uz || "", ru: ru || "" });
const label = (labels, s) => tri(s, labels[s] && labels[s].uz, labels[s] && labels[s].ru);

function buildDay(d, uz, ru, labels) {
  const U = uz.days[d.d] || {}, R = ru.days[d.d] || {};
  const day = {
    n: d.d,
    week: d.w,
    weekTitle: label(labels, d.wt),
    title: tri(d.t, d.tu, R.t),
    review: !!d.rev,
    final: !!d.final,
    words: (d.v || []).map((v, i) => ({ id: `w:${d.d}:${i}`, en: v[0], uz: v[1], ru: (R.v || [])[i] || "", ex: tri(v[2], (U.x || [])[i], (R.x || [])[i]) })),
    dialogue: (d.dl || []).map((l, i) => ({ who: l[0], en: l[1], uz: l[2], ru: (R.dl || [])[i] || "" })),
    tip: d.g ? { title: tri(d.g[0], U.g && U.g[0], R.g && R.g[0]), text: tri(d.g[1], U.g && U.g[1], R.g && R.g[1]) } : null,
    grammarId: d.gu || null,
    quiz: (d.qz || []).map((q, i) => ({ q: tri(q[0], (U.q || [])[i], (R.q || [])[i]), opts: q[1], a: q[2] })),
    speak: d.sp ? tri(d.sp[0], d.sp[1], typeof R.sp === "string" ? R.sp : "") : null,
  };
  return day;
}

function buildGrammar(g, uz, ru, labels) {
  const U = uz.grammar[g.id] || {}, R = ru.grammar[g.id] || {};
  return {
    id: g.id,
    cat: label(labels, g.cat),
    title: tri(g.title, g.titleUz, R.title),
    rule: tri("", g.ruleUz, R.rule),
    explain: { en: g.explain || [], uz: U.explain || [], ru: R.explain || [] },
    examples: (g.examples || []).map((e, i) => ({ en: e[0], uz: e[1], ru: (R.ex || [])[i] || "" })),
    mistake: { wrong: g.mistakeWrong || "", right: g.mistakeRight || "", why: tri(g.mistakeWhy, U.why, R.why) },
    quiz: (g.quiz || []).map((q, i) => ({ q: tri(q[0], (U.q || [])[i], (R.q || [])[i]), opts: q[1], a: q[2] })),
    teach: g.teach || [],
  };
}

// ---------------------------------------------------------------- the 50 video lessons
// Facts the published videos got slightly wrong; the app shows the corrected text (see docs/DIFFERENCES.md).
const CORRECTIONS = {
  33: (v) => {
    for (const it of v.recap) if (/good for two years/i.test(it.en)) {
      it.note = "Tibbiy karta koʻpi bilan 2 yilga beriladi. Qon bosimi yoki boshqa holat boʻlsa, shifokor 1 yil yoki undan qisqa muddat berishi mumkin. Nusxasini doim kabinada saqlang.";
    }
  },
  37: (v) => {
    for (const c of v.cards) if (/sleeper berth split/i.test(c.en)) {
      c.note = "10 soatlik dam olishni ikkiga boʻlish mumkin: 8 + 2 yoki 7 + 3 soat. Uzunroq qismi (kamida 7 soat) sleeperda boʻlishi shart, ikkalasi birga kamida 10 soat.";
    }
  },
};

function loadVideos() {
  const dir = path.join(SRC, "video-scripts");
  const files = fs.readdirSync(dir).filter((f) => /^\d{2}\.txt$/.test(f)).sort();
  const videos = files.map((f) => {
    const n = Number(f.slice(0, 2));
    const v = parseVideoScript(fs.readFileSync(path.join(dir, f), "utf8"), n);
    if (CORRECTIONS[n]) CORRECTIONS[n](v);
    const errs = checkVideo(v);
    if (errs.length) throw new Error(`video ${n}: ${errs.join("; ")}`);
    return v;
  });
  if (videos.length !== 50) throw new Error("expected 50 video scripts, found " + videos.length);
  videos.forEach((v, i) => { if (v.n !== i + 1) throw new Error("video numbering gap at " + (i + 1)); });
  return videos;
}

// Which course days teach the same things as a video (shared English words, rarer words weigh more).
const STOP = new Set("a an the i you he she it we they me my your our their is are am was were be been to of in on at for and or but do does did not no yes this that these those with from by as have has had will would can could should please what where when how who why which there here so if then just get got go going come".split(" "));
function words(s) { return String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)); }
function relateVideos(videos, days) {
  const docs = days.map((d) => new Set(words([d.title.en, ...d.words.map((w) => w.en + " " + w.ex.en), ...d.dialogue.map((l) => l.en)].join(" "))));
  const df = new Map();
  for (const s of docs) for (const w of s) df.set(w, (df.get(w) || 0) + 1);
  for (const v of videos) {
    const vw = new Set(words([v.title.en, ...v.lines.map((l) => l.en || ""), ...v.recap.map((r) => r.en), ...v.cards.map((c) => c.en)].join(" ")));
    const scored = days.map((d, i) => {
      let s = 0;
      for (const w of vw) if (docs[i].has(w)) s += Math.log(days.length / df.get(w));
      return { n: d.n, s };
    }).filter((x) => x.n >= 1).sort((a, b) => b.s - a.s);
    v.relatedDays = scored.slice(0, 3).filter((x) => x.s > 0).map((x) => x.n);
  }
}

// ---------------------------------------------------------------- natural-voice allowlists
function phrasesEn(course, grammar, videos) {
  const out = {};
  const add = (t, say) => { const k = normalize(t); if (k && k.length <= 300) out[k] = spoken(say || t); };
  for (const d of [...course.orientation, ...course.days]) {
    d.words.forEach((w) => { add(w.en); add(w.ex.en); });
    d.dialogue.forEach((l) => add(l.en));
  }
  for (const g of grammar) { g.examples.forEach((e) => add(e.en)); if (g.mistake.right) add(g.mistake.right); }
  for (const v of videos) {
    v.lines.forEach((l) => l.en && add(l.en, l.say));
    v.recap.forEach((r) => add(r.en, r.say));
    v.cards.forEach((c) => add(c.en, c.say));
  }
  for (const sc of SCENES) add(sc.opening.en);   // the first line of each conversation practice
  return sortObj(out);
}
function phrasesUz(course, videos) {
  const out = {};
  const add = (t) => { const k = normalize(t); if (k && k.length <= 600) out[k] = 1; };
  for (const v of videos) { add(v.intro); add(v.outro); v.recap.forEach((r) => r.note && add(r.note)); v.cards.forEach((c) => c.note && add(c.note)); }
  // the meanings the "Listen in the truck" player reads out after each English phrase (see public/js/app/items.js)
  for (const v of videos) videoItems(v).forEach((it) => add(it.uz));
  for (const d of [...course.orientation, ...course.days]) d.words.forEach((w) => { add(w.uz); add(w.ex.uz); });
  return sortObj(out);
}
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

// ---------------------------------------------------------------- catalog (public)
function catalog(course, grammar, videos, freeGrammar) {
  const dayRow = (d) => ({
    n: d.n, week: d.week, title: d.title, review: d.review, final: d.final, free: dayIsFree(d.n),
    words: d.words.length, lines: d.dialogue.length, quiz: d.quiz.length, grammarId: d.grammarId,
  });
  const weeks = [];
  for (const d of course.days) {
    let w = weeks.find((x) => x.week === d.week);
    if (!w) { w = { week: d.week, title: d.weekTitle, days: [] }; weeks.push(w); }
    w.days.push(d.n);
  }
  return {
    version: 2,
    orientation: { title: course.orientation[0].weekTitle, days: course.orientation.map(dayRow) },
    weeks,
    days: course.days.map(dayRow),
    grammar: grammar.map((g) => ({ id: g.id, cat: g.cat, title: g.title, free: freeGrammar.has(g.id), quiz: g.quiz.length })),
    videos: videos.map((v) => ({ n: v.n, bundle: v.bundle, title: v.title, format: v.format, items: v.lines.filter((l) => l.who !== "narrator").length + v.recap.length + v.cards.length })),
    bundles: [...new Map(videos.map((v) => [v.bundle, { bundle: v.bundle, title: v.bundleTitle }])).values()],
  };
}


// ---------------------------------------------------------------- landing page (public/index.html)
// The page is plain HTML (fast, readable without JavaScript, findable by search engines). Elements carry data-k="<i18n key>";
// this fills in the Uzbek text from the app's dictionary, and landing.js switches to Russian or English in the browser.
function i18nStrings() {
  const src = fs.readFileSync(path.join(ROOT, "public/js/app/i18n.js"), "utf8");
  const m = /const D = (\{[\s\S]*?\n\});/.exec(src);
  if (!m) throw new Error("i18n.js: dictionary not found");
  return vm.runInNewContext("(" + m[1] + ")");
}
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CHECK_SVG = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>';

function landingVideos(videos) {
  const bundles = [...new Map(videos.map((v) => [v.bundle, v.bundleTitle])).entries()];
  return "\n      <div class=\"bundle-list\">\n" + bundles.map(([b, title]) =>
    `        <div><h3><span data-k="land.bundle"></span> ${b} · ${escHtml(title)}</h3><ol>\n` +
    videos.filter((v) => v.bundle === b).map((v) => `          <li value="${v.n}"><a href="/v/${v.n}">${escHtml(v.title.uz)}</a> <span class="faint">· ${escHtml(v.title.en)}</span></li>\n`).join("") +
    "        </ol></div>\n").join("") + "      </div>\n      ";
}

function landingPlans() {
  const by = (tier, per) => PLANS.find((p) => p.tier === tier && p.per === per);
  const li = (k) => `<li>${CHECK_SVG}<span data-k="${k}"></span></li>`;
  const card = (tier, best) => {
    const m = by(tier, "month"), q = by(tier, "3months");
    return `        <div class="card plan${best ? " best" : ""}">${best ? '<span class="ribbon" data-k="pricing.best"></span>' : ""}
          <h3 data-k="plan.${tier}"></h3>
          <div class="price">$${m.usd} <small>/ <span data-k="pricing.month"></span></small></div>
          <div class="small"><span data-k="land.or"></span> <b>$${q.usd}</b> / <span data-k="pricing.3months"></span></div>
          <ul>${FEATURES[tier].map(li).join("")}</ul>
          <a class="btn ${best ? "primary" : "dark"} block" style="margin-top:auto" href="/app/pricing" data-k="land.choose"></a>
        </div>
`;
  };
  const free = `        <div class="card plan">
          <h3 data-k="plan.free"></h3>
          <div class="price">$0</div>
          <div class="small muted" data-k="land.freeSub"></div>
          <ul>${["pricing.freeF1", "pricing.freeF2", "pricing.freeF3"].map(li).join("")}</ul>
          <a class="btn ghost block" style="margin-top:auto" href="/app" data-k="land.start"></a>
        </div>
`;
  return "\n      <div class=\"plans\">\n" + free + card("self", true) + card("pro", false) + "      </div>\n      ";
}

function buildLanding(videos) {
  let html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const D = i18nStrings();
  const uz = (k) => { if (!D[k]) throw new Error("index.html uses a missing string: " + k); return D[k][0]; };
  html = html.replace(/(<!--videos:start-->)[\s\S]*?(<!--videos:end-->)/, (m, a, b) => a + landingVideos(videos) + b);
  html = html.replace(/(<!--plans:start-->)[\s\S]*?(<!--plans:end-->)/, (m, a, b) => a + landingPlans() + b);
  html = html.replace(/(<([a-z][a-z0-9]*)\b[^>]*?\sdata-k="([a-zA-Z0-9.]+)"[^>]*>)[^<]*(<\/\2>)/g, (m, open, tag, k, close) => open + escHtml(uz(k)) + close);
  html = html.replace(/\sdata-k-(placeholder|content|aria-label)="([a-zA-Z0-9.]+)"(?:\s\1="[^"]*")?/g, (m, attr, k) => ` data-k-${attr}="${k}" ${attr}="${escHtml(uz(k))}"`);
  return html;
}

/** Every "uz" field (a string or a list of strings), anywhere in the tree, gets proper Uzbek apostrophes. */
function fixUzbek(node) {
  if (Array.isArray(node)) { node.forEach(fixUzbek); return; }
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (k === "uz" && typeof v === "string") node[k] = uzQuotes(v);
    else if (k === "uz" && Array.isArray(v) && v.every((x) => typeof x === "string")) node[k] = v.map(uzQuotes);
    else fixUzbek(v);
  }
}

// ---------------------------------------------------------------- main
function main() {
  const v1 = loadV1();
  const course = {
    orientation: v1.orientation.map((d) => buildDay(d, v1.uz, v1.ru, v1.labels)),
    days: v1.days.map((d) => buildDay(d, v1.uz, v1.ru, v1.labels)),
  };
  const grammar = v1.grammar.map((g) => buildGrammar(g, v1.uz, v1.ru, v1.labels));
  // the old course writes Uzbek with plain apostrophes (O'zingizni); use the proper letters (Oʻzingizni) everywhere
  fixUzbek(course); fixUzbek(grammar);
  const videos = loadVideos();
  relateVideos(videos, course.days);

  // sanity: answers in range, ids unique
  for (const d of [...course.orientation, ...course.days]) {
    d.quiz.forEach((q, i) => { if (!(q.a >= 0 && q.a < q.opts.length)) throw new Error(`day ${d.n} quiz ${i}: bad answer index`); });
  }
  for (const g of grammar) g.quiz.forEach((q, i) => { if (!(q.a >= 0 && q.a < q.opts.length)) throw new Error(`grammar ${g.id} quiz ${i}: bad answer index`); });
  if (course.days.length !== 60) throw new Error("expected 60 course days");

  const freeDayGrammar = course.days.filter((d) => dayIsFree(d.n)).map((d) => d.grammarId);
  const freeGrammar = freeGrammarIds(grammar.map((g) => g.id), freeDayGrammar);

  const files = {
    "content/course.json": course,
    "content/grammar.json": grammar,
    "content/phrases-en.json": phrasesEn(course, grammar, videos),
    "content/phrases-uz.json": phrasesUz(course, videos),
    "public/data/catalog.json": catalog(course, grammar, videos, freeGrammar),
    "public/data/videos.json": videos,
  };
  let stale = [];
  for (const [rel, data] of Object.entries(files)) {
    const file = path.join(ROOT, rel);
    const text = JSON.stringify(data) + "\n";
    const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (old === text) continue;
    if (CHECK) { stale.push(rel); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log("wrote " + rel + " (" + Math.round(text.length / 1024) + " KB)");
  }
  const landing = buildLanding(videos);
  const landingFile = path.join(ROOT, "public/index.html");
  if (fs.readFileSync(landingFile, "utf8") !== landing) {
    if (CHECK) stale.push("public/index.html");
    else { fs.writeFileSync(landingFile, landing); console.log("wrote public/index.html"); }
  }
  if (CHECK && stale.length) { console.error("content is out of date, run npm run build:content: " + stale.join(", ")); process.exit(1); }
  const en = Object.keys(files["content/phrases-en.json"]).length, uzN = Object.keys(files["content/phrases-uz.json"]).length;
  console.log(`course: ${course.orientation.length} orientation + ${course.days.length} days, grammar: ${grammar.length}, videos: ${videos.length}, voice phrases: ${en} en / ${uzN} uz`);
}

main();
