#!/usr/bin/env node
/* Runs the whole app on one Node server: the static site from public/ plus every endpoint in api/, with the same rewrites
 * and security headers as vercel.json. Used for local development (npm run dev = demo mode, nothing to set up), for the
 * end-to-end tests, and as a production server on hosts like Render (npm start). */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const PORT = Number(process.env.PORT) || 3000;
if (process.env.DEMO_MODE === "1" && !process.env.DEMO_DB_FILE) process.env.DEMO_DB_FILE = path.join(ROOT, ".data", "demo-db.json");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
  ".mp3": "audio/mpeg", ".woff2": "font/woff2",
};

const endpoints = new Map();
for (const f of fs.readdirSync(path.join(ROOT, "api"))) if (f.endsWith(".js")) endpoints.set(f.slice(0, -3), path.join(ROOT, "api", f));

function toRegex(source) {
  return new RegExp("^" + source.replace(/[.+?^${}()|[\]\\]/g, (c) => (c === "(" || c === ")" || c === "|" ? c : "\\" + c)).replace(/:(\w+)\*/g, "(.*)").replace(/:(\w+)/g, "([^/]+)") + "$");
}
const rewrites = (vercel.rewrites || []).map((r) => ({ re: toRegex(r.source), dest: r.destination }));
const headerRules = (vercel.headers || []).map((h) => ({ re: new RegExp("^" + h.source.replace(/\\\\/g, "\\") + "$"), headers: h.headers }));

function applyHeaders(res, pathname) {
  for (const rule of headerRules) if (rule.re.test(pathname)) for (const { key, value } of rule.headers) {
    if (key === "Strict-Transport-Security" && !process.env.RENDER && !process.env.FORCE_HSTS) continue;   // not on plain http://localhost
    res.setHeader(key, value);
  }
}

function serveFile(res, file, pathname) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      const nf = path.join(PUBLIC, "404.html");
      res.statusCode = 404;
      res.setHeader("content-type", "text/html; charset=utf-8");
      return fs.createReadStream(fs.existsSync(nf) ? nf : file).on("error", () => res.end("Not found")).pipe(res);
    }
    res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
    res.setHeader("content-length", st.size);
    if (!res.getHeader("cache-control")) res.setHeader("cache-control", "no-cache");
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let url, pathname;
  try {
    url = new URL(req.url, "http://localhost");
    pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("\0")) throw new Error("nul");
  } catch { res.statusCode = 400; return res.end(); }   // malformed %-escapes must not crash the server
  applyHeaders(res, pathname);
  const api = /^\/api\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (api) {
    const file = endpoints.get(api[1]);
    if (!file) { res.statusCode = 404; res.setHeader("content-type", "application/json"); return res.end('{"error":"not-found"}'); }
    try {
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    } catch (e) {
      console.error(e); res.statusCode = 500; return res.end('{"error":"server"}');
    }
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; return res.end(); }
  for (const r of rewrites) if (r.re.test(pathname)) { pathname = r.dest; break; }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep)) { res.statusCode = 403; return res.end(); }
  if (!path.extname(file) && fs.existsSync(file + ".html")) return serveFile(res, file + ".html", pathname);
  serveFile(res, file, pathname);
});

server.listen(PORT, () => {
  const mode = process.env.DEMO_MODE === "1" && !process.env.FIREBASE_SERVICE_ACCOUNT ? "DEMO mode (in-memory data, pretend sign-in and payments)" : "production mode";
  console.log(`TruckTalk running on http://localhost:${PORT}  [${mode}]`);
});
export default server;
