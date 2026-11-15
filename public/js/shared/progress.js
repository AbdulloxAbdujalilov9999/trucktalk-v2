/* A student's progress, and how two copies of it are merged (phone + laptop, or this device + the cloud).
 * merge() is commutative and idempotent, so syncing in any order, any number of times, never loses anything:
 *   first completion times win (min), best scores win (max), spaced-review cards keep the most recent update,
 *   XP is counted per device per day (each device only ever raises its own counter, the total is the sum).
 * The browser and the server use this same file. */

export const EMPTY = () => ({ v: 2, days: {}, grammar: {}, videos: {}, quiz: {}, srs: {}, xp: {}, goal: null, set: {} });

const minT = (a, b) => (a && b ? Math.min(a, b) : a || b || undefined);
const maxN = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));
const lww = (a, b) => (!a ? b : !b ? a : (b.u || 0) > (a.u || 0) ? b : a);

function mergeMap(a = {}, b = {}, f) {
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const v = a && a[k] != null ? (b && b[k] != null ? f(a[k], b[k]) : a[k]) : b[k];
    if (v != null) out[k] = v;
  }
  return out;
}
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function merge(a, b) {
  a = a || EMPTY(); b = b || EMPTY();
  return {
    v: 2,
    days: mergeMap(a.days, b.days, (x, y) => compact({ s: mergeMap(x.s, y.s, minT), done: minT(x.done, y.done) })),
    grammar: mergeMap(a.grammar, b.grammar, (x, y) => compact({ read: minT(x.read, y.read) })),
    videos: mergeMap(a.videos, b.videos, (x, y) => compact({ seen: minT(x.seen, y.seen), best: maxN(x.best, y.best) })),
    quiz: mergeMap(a.quiz, b.quiz, (x, y) => ((y.best || 0) > (x.best || 0) ? { ...y, at: maxN(x.at, y.at) } : { ...x, at: maxN(x.at, y.at) })),
    srs: mergeMap(a.srs, b.srs, (x, y) => ((y.u || 0) > (x.u || 0) ? y : x)),
    xp: mergeMap(a.xp, b.xp, (x, y) => mergeMap(x, y, maxN)),
    goal: lww(a.goal, b.goal) || null,
    set: mergeMap(a.set, b.set, lww),
  };
}

// ---------------------------------------------------------------- validation (the server keeps only sane shapes)
const MIN_T = Date.UTC(2024, 0, 1);
const isT = (t, now) => typeof t === "number" && Number.isFinite(t) && t >= MIN_T && t <= now + 2 * 86400000;
const num = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;

function pickMap(obj, max, keyOk, valFn) {
  const out = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (n >= max) break;
    if (!keyOk(k)) continue;
    const c = valFn(v);
    if (c != null) { out[k] = c; n++; }
  }
  return out;
}

export function sanitize(p, now = Date.now()) {
  if (!p || typeof p !== "object") return EMPTY();
  const t = (x) => (isT(x, now) ? x : undefined);
  const steps = new Set(["words", "dialogue", "grammar", "quiz", "speak"]);
  const settingKeys = new Set(["voice", "showUz", "lang", "rate"]);
  return {
    v: 2,
    days: pickMap(p.days, 120, (k) => /^-?\d{1,3}$/.test(k) && +k >= -10 && +k <= 100, (v) => {
      if (!v || typeof v !== "object") return null;
      const s = pickMap(v.s, 5, (k) => steps.has(k), (x) => t(x) ?? null);
      const r = compact({ s, done: t(v.done) });
      return Object.keys(s).length || r.done ? r : null;
    }),
    grammar: pickMap(p.grammar, 100, (k) => /^[a-z0-9-]{1,40}$/.test(k), (v) => (v && t(v.read) ? { read: v.read } : null)),
    videos: pickMap(p.videos, 60, (k) => /^\d{1,2}$/.test(k) && +k >= 1 && +k <= 50, (v) => {
      if (!v || typeof v !== "object") return null;
      const r = compact({ seen: t(v.seen), best: num(v.best, 0, 100) ? Math.round(v.best) : undefined });
      return Object.keys(r).length ? r : null;
    }),
    quiz: pickMap(p.quiz, 300, (k) => /^(day|grammar|video):-?[a-z0-9-]{1,40}$/.test(k), (v) => {
      if (!v || !num(v.best, 0, 100) || !num(v.total, 1, 100) || v.best > v.total) return null;
      return compact({ best: v.best, total: v.total, at: t(v.at) });
    }),
    srs: pickMap(p.srs, 8000, (k) => /^[wv]:-?\d{1,3}:\d{1,3}$/.test(k), (v) => {
      if (!v || !num(v.b, 0, 6) || !isT(v.due, now + 400 * 86400000) || !t(v.u)) return null;
      return { b: Math.round(v.b), due: v.due, u: v.u };
    }),
    xp: pickMap(p.xp, 30, (k) => /^[a-z0-9]{6,24}$/.test(k), (dev) => {
      const m = pickMap(dev, 800, (k) => /^\d{4}-\d{2}-\d{2}$/.test(k), (n) => (num(n, 0, 5000) ? Math.round(n) : null));
      return Object.keys(m).length ? m : null;
    }),
    goal: p.goal && num(p.goal.v, 10, 500) && t(p.goal.u) ? { v: Math.round(p.goal.v), u: p.goal.u } : null,
    set: pickMap(p.set, 10, (k) => settingKeys.has(k), (v) => (v && t(v.u) && ["string", "number", "boolean"].includes(typeof v.v) && String(v.v).length <= 20 ? { v: v.v, u: v.u } : null)),
  };
}

// ---------------------------------------------------------------- derived numbers
export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export function xpByDay(p) {
  const out = {};
  for (const dev of Object.values((p && p.xp) || {})) for (const [k, n] of Object.entries(dev || {})) out[k] = (out[k] || 0) + n;
  return out;
}
export function totalXp(p) { return Object.values(xpByDay(p)).reduce((a, b) => a + b, 0); }
export function streak(p, now = Date.now()) {
  const by = xpByDay(p);
  let n = 0, t = now;
  if (!by[dayKey(t)]) t -= 86400000;           // today not started yet: the streak can still be alive from yesterday
  while (by[dayKey(t)] > 0) { n++; t -= 86400000; }
  return n;
}
export function daysDone(p) { return Object.values((p && p.days) || {}).filter((d) => d && d.done).length; }
/** The longest run of consecutive days with any XP, ever (badges use it, so a badge never disappears). */
export function bestStreak(p) {
  const keys = Object.entries(xpByDay(p)).filter(([, n]) => n > 0).map(([k]) => k).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const t = Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
    run = prev !== null && t - prev === 86400000 ? run + 1 : 1;
    if (run > best) best = run;
    prev = t;
  }
  return best;
}

// ---------------------------------------------------------------- spaced review (Leitner boxes)
export const BOX_DAYS = [0, 1, 3, 7, 14, 30, 60];
export function review(card, knew, now = Date.now()) {
  const b = knew ? Math.min((card ? card.b : 0) + 1, BOX_DAYS.length - 1) : 0;
  const due = knew ? now + BOX_DAYS[b] * 86400000 : now + 10 * 60 * 1000;
  return { b, due, u: now };
}
export function addCard(p, id, now = Date.now()) {
  if (!p.srs[id]) p.srs[id] = { b: 0, due: now, u: now };
  return p;
}
export function dueCards(p, now = Date.now()) {
  return Object.entries((p && p.srs) || {}).filter(([, c]) => c.due <= now).sort((a, b) => a[1].due - b[1].due).map(([id]) => id);
}
