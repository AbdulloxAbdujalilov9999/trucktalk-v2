/* The phrases of a video lesson as one list (dialogue lines, recap phrases, word cards), each phrase once.
 * Review cards are named v:<lesson>:<index in this list>, so this order must stay stable. */
import { normalize } from "./text.js";

export function videoItems(v) {
  const seen = new Set(), out = [];
  const add = (x, kind) => {
    if (!x || !x.en || !x.uz) return;
    const k = normalize(x.en).toLowerCase();
    if (seen.has(k)) { const prev = out.find((o) => normalize(o.en).toLowerCase() === k); if (prev && x.note && !prev.note) prev.note = x.note; return; }
    seen.add(k);
    out.push({ en: x.en, uz: x.uz, say: x.say || null, note: x.note || null, who: x.who || null, kind });
  };
  (v.lines || []).forEach((l) => l.who !== "narrator" && add(l, "line"));
  (v.recap || []).forEach((r) => add(r, "recap"));
  (v.cards || []).forEach((c) => add(c, "card"));
  return out;
}

/** A short multiple-choice practice: English phrase -> pick the Uzbek meaning (3 options from the same lesson). */
export function practiceQuestions(v, count = 8, rnd = Math.random) {
  const items = videoItems(v);
  const pool = shuffle(items.slice(), rnd).slice(0, Math.min(count, items.length));
  return pool.map((it) => {
    const others = shuffle(items.filter((x) => x.uz !== it.uz), rnd).slice(0, 2).map((x) => x.uz);
    const opts = shuffle([it.uz, ...others], rnd);
    return { en: it.en, say: it.say, opts, a: opts.indexOf(it.uz) };
  });
}

function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
