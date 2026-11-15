#!/usr/bin/env node
/* Fast checks that catch the mistakes tests don't: run by `npm run check` and in CI.
 *  - every file the app needs offline is in the service worker's list, and every listed file exists
 *  - no inline scripts or inline event handlers in the pages (the Content-Security-Policy would block them)
 *  - every relative import in the browser code points at a real file, and browser code never imports server code
 *  - every interface string the code asks for exists, in all three languages
 *  - at most 12 server functions (the Vercel Hobby limit) and every one of them exports a handler
 *  - nothing public carries quiz answers, and server-only folders are not under public/ */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const problems = [];
const bad = (msg) => problems.push(msg);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

function walk(dir, ext) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (!ext || p.endsWith(ext)) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------ offline list
const sw = read("public/sw.js");
const shellSrc = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
if (!shellSrc) bad("public/sw.js: SHELL list not found");
const shell = new Set(shellSrc ? [...shellSrc[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []);
for (const u of shell) {
  const file = path.join(PUB, u === "/" ? "index.html" : u);
  if (!fs.existsSync(file)) bad(`sw.js lists ${u}, which does not exist`);
}
const needed = [
  ...walk(path.join(PUB, "js/app"), ".js"),
  ...walk(path.join(PUB, "js/shared"), ".js"),
  path.join(PUB, "js/landing.js"),
  path.join(PUB, "app.html"),
  path.join(PUB, "css/app.css"),
];
for (const f of needed) {
  const u = "/" + path.relative(PUB, f).split(path.sep).join("/");
  if (!shell.has(u)) bad(`sw.js SHELL is missing ${u} (the app would break offline)`);
}

// ------------------------------------------------------------ pages: CSP-safe
for (const f of walk(PUB, ".html")) {
  const html = fs.readFileSync(f, "utf8");
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\ssrc=/.test(m[1]) && !/type="application\/(ld\+)?json"/.test(m[1])) bad(`${rel(f)}: inline <script> (blocked by the CSP)`);
  }
  const handler = /<[a-z][^>]*\s(on[a-z]+)=["']/i.exec(html);
  if (handler) bad(`${rel(f)}: inline event handler ${handler[1]}= (blocked by the CSP)`);
  if (/javascript:/i.test(html)) bad(`${rel(f)}: javascript: URL (blocked by the CSP)`);
}

// ------------------------------------------------------------ browser imports
const browserJs = walk(path.join(PUB, "js"), ".js").concat([path.join(PUB, "sw.js")]);
for (const f of browserJs) {
  const src = fs.readFileSync(f, "utf8");
  const specs = [...src.matchAll(/(?:^|[\s;])import\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm), ...src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  for (const s of specs) {
    if (/^https:\/\//.test(s)) continue;
    if (!s.startsWith(".") && !s.startsWith("/")) { bad(`${rel(f)}: bare import "${s}" (no bundler: browsers can't resolve it)`); continue; }
    const target = s.startsWith("/") ? path.join(PUB, s) : path.resolve(path.dirname(f), s);
    if (!target.startsWith(PUB + path.sep)) { bad(`${rel(f)}: imports "${s}" from outside public/ (server code must never ship to browsers)`); continue; }
    if (!fs.existsSync(target)) bad(`${rel(f)}: imports "${s}", which does not exist`);
  }
}

// ------------------------------------------------------------ interface strings
const i18n = read("public/js/app/i18n.js");
const dm = /const D = (\{[\s\S]*?\n\});/.exec(i18n);
let D = {};
if (!dm) bad("i18n.js: dictionary not found");
else {
  D = vm.runInNewContext("(" + dm[1] + ")");
  for (const [k, v] of Object.entries(D)) {
    if (!Array.isArray(v) || v.length !== 3 || v.some((s) => typeof s !== "string" || !s.trim())) bad(`i18n.js: "${k}" needs three non-empty strings [uz, ru, en]`);
  }
}
const used = new Map();
for (const f of walk(path.join(PUB, "js"), ".js")) {
  const src = fs.readFileSync(f, "utf8");
  // whole literal keys only: t("a.b") or t("a.b", vars), not t("plan." + id)
  for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"\s*(?=[,)])/g)) if (!used.has(m[1])) used.set(m[1], rel(f));
}
for (const f of walk(PUB, ".html")) {
  const html = fs.readFileSync(f, "utf8");
  for (const m of html.matchAll(/data-k(?:-[a-z-]+)?="([a-zA-Z0-9_.]+)"/g)) if (!used.has(m[1])) used.set(m[1], rel(f));
}
for (const [k, where] of used) if (!(k in D)) bad(`${where}: uses the interface string "${k}", which is not in i18n.js`);

// ------------------------------------------------------------ server functions
const api = fs.readdirSync(path.join(ROOT, "api")).filter((f) => f.endsWith(".js"));
if (api.length > 12) bad(`api/ has ${api.length} functions; the Vercel Hobby plan allows 12`);
for (const f of api) if (!/export\s+default\s+/.test(read("api/" + f))) bad(`api/${f}: no default export (Vercel needs a handler)`);
const vercel = JSON.parse(read("vercel.json"));
for (const r of vercel.rewrites || []) if (!fs.existsSync(path.join(PUB, r.destination))) bad(`vercel.json rewrites to ${r.destination}, which does not exist`);

// ------------------------------------------------------------ nothing secret is public
for (const f of walk(path.join(PUB, "data"), ".json")) {
  const txt = fs.readFileSync(f, "utf8");
  if (/"a"\s*:\s*\d/.test(txt)) bad(`${rel(f)}: looks like it contains quiz answers ("a": n)`);
  if (/"teach"\s*:/.test(txt)) bad(`${rel(f)}: contains teacher notes`);
}
for (const d of ["content", "lib", "api", "sources"]) if (fs.existsSync(path.join(PUB, d))) bad(`public/${d} must not exist (server-only files would be served)`);

if (problems.length) {
  console.error(`check: ${problems.length} problem(s)\n` + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}
console.log(`check: ok (${shell.size} offline files, ${used.size} interface strings, ${api.length} server functions)`);
