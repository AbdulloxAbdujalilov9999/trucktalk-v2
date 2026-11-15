#!/usr/bin/env node
/* Writes ready-to-paste video descriptions for all 50 lessons, with links that open that exact lesson in the app.
 *   APP_URL=https://your-domain TELEGRAM_BOT_USERNAME=YourBot npm run marketing            (links work for any channel)
 *   APP_URL=https://your-domain npm run marketing -- --src yt                              (links remember "YouTube, lesson N")
 * Output (marketing/):
 *   captions.md       one block per lesson: title, lesson link, Telegram link, caption text to copy
 *   links.csv         lesson number, titles, app link, Telegram link (for spreadsheets / schedulers)
 *   end-card.md       what to say and show at the end of new videos instead of "DM TRUCK"
 * The admin panel (/admin/marketing) shows the same links and captions with copy buttons. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "marketing");
const args = process.argv.slice(2);
const srcArg = args.includes("--src") ? args[args.indexOf("--src") + 1] : "";
if (srcArg && !/^[a-z]{2,10}$/.test(srcArg)) { console.error("--src must be a short channel code like yt, ig, tt or fb"); process.exit(2); }

const base = (process.env.APP_URL || "").replace(/\/+$/, "");
if (!base) console.warn("APP_URL is not set: writing links for https://YOUR-DOMAIN (set APP_URL to your real address).");
const site = base || "https://YOUR-DOMAIN";
const bot = (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
const videos = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/videos.json"), "utf8"));

const appLink = (n) => `${site}/v/${n}${srcArg ? `?src=${srcArg}-v${n}` : ""}`;
const tgLink = (n) => (bot ? `https://t.me/${bot}?start=v${n}` : "");
// keep in step with the caption in public/js/admin/admin.js (viewMarketing)
const caption = (v) => `📚 ${v.n}-dars: ${v.title.uz} (${v.title.en}).\n\nToʻliq dars — har bir gap ovozi va tarjimasi bilan, test ham bor (bepul):\n👉 ${appLink(v.n)}` +
  (tgLink(v.n) ? `\n\nYoki Telegram botimizga yozing: ${tgLink(v.n)}` : "") + `\n\n#trakchi #truckdriver #inglizTili #CDL #Amerika`;
const csv = (s) => `"${String(s).replace(/"/g, '""')}"`;

fs.mkdirSync(OUT, { recursive: true });

const md = [`# TruckTalk video descriptions\n`,
  `Generated for ${site}${srcArg ? ` (channel: ${srcArg})` : ""}. Paste each block into that video's description and pinned comment.\n`,
  `The lesson link opens that lesson straight away, with no sign-up. Free lessons stay free; the app offers the full course after.\n`];
for (const v of videos) {
  md.push(`## ${v.n}. ${v.title.uz} · ${v.title.en}\n`);
  md.push(`- App: ${appLink(v.n)}`);
  if (tgLink(v.n)) md.push(`- Telegram: ${tgLink(v.n)}`);
  md.push("", "```text", caption(v), "```", "");
}
fs.writeFileSync(path.join(OUT, "captions.md"), md.join("\n"));

const rows = [["n", "title_uz", "title_en", "app_link", "telegram_link"].join(",")];
for (const v of videos) rows.push([v.n, csv(v.title.uz), csv(v.title.en), csv(appLink(v.n)), csv(tgLink(v.n))].join(","));
fs.writeFileSync(path.join(OUT, "links.csv"), rows.join("\n") + "\n");

const host = site.replace(/^https?:\/\//, "");
fs.writeFileSync(path.join(OUT, "end-card.md"), `# End of each new video

The old videos end with "Bizga DM yozing: TRUCK". Nothing answered that, so viewers who wanted more had nowhere to go.
For new videos, end with the lesson number and the site instead. Viewers type the number on the home page and land in
that exact lesson, with the audio for every line, the translation and a short test.

**Say (narrator, Uzbek):**

> Bu darsni ilovada takrorlang: ${host} saytiga kiring va dars raqamini yozing — {N}. Bepul.

**Show on the end card:**

\`\`\`text
${host}
Dars raqami: {N}
\`\`\`

**Pinned comment / description:** use the block for that lesson in captions.md.
${bot ? `\n**Telegram:** viewers can also open https://t.me/${bot}?start=v{N}, or write the lesson number (or TRUCK) to @${bot}; the bot answers with the lesson's key phrases and its link.\n` : ""}`);

console.log(`marketing: wrote captions.md, links.csv and end-card.md for ${videos.length} lessons -> ${path.relative(process.cwd(), OUT) || "."}`);
