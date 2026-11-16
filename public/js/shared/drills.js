/* Practice logic with no screen attached, so the browser and the tests use the same code:
 *  - trucking numbers and spelling read aloud (load and PO numbers, phone numbers, times, weights, heights, money,
 *    mile markers, reefer temperatures, the phonetic alphabet) and a forgiving check of what the student typed
 *  - comparing what speech recognition heard with the phrase the student was asked to say
 *  - word tiles for "build the sentence", and rounds for "match the pairs" and "listen and choose" */
import { normalize } from "./text.js";

export function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi, rnd) => lo + Math.floor(rnd() * (hi - lo + 1));

// ---------------------------------------------------------------- numbers as Americans say them
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 80000 -> "eighty thousand", 127 -> "one hundred twenty-seven", -10 -> "minus ten". */
export function numberWords(n) {
  n = Math.round(Number(n));
  if (n < 0) return "minus " + numberWords(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + numberWords(n % 100) : "");
  if (n < 1e6) return numberWords(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? " " + numberWords(n % 1000) : "");
  return numberWords(Math.floor(n / 1e6)) + " million" + (n % 1e6 ? " " + numberWords(n % 1e6) : "");
}

/** Two digits the way they are read in times and addresses: 5 -> "oh five", 30 -> "thirty". */
const pair = (n) => (n < 10 ? "oh " + ONES[n] : numberWords(n));

/** A street number: 1450 -> "fourteen fifty", 405 -> "four oh five", 1900 -> "nineteen hundred". */
export function streetNumber(n) {
  if (n < 100) return numberWords(n);
  if (n < 1000) return n % 100 === 0 ? numberWords(n) : ONES[Math.floor(n / 100)] + " " + pair(n % 100);
  if (n < 10000) {
    if (n % 1000 === 0) return numberWords(n);
    if (n % 100 === 0) return numberWords(n / 100) + " hundred";
    return numberWords(Math.floor(n / 100)) + " " + pair(n % 100);
  }
  return digitsSpoken(String(n));
}

/** "482715" -> "four eight two, seven one five" (groups of three, so it sounds like a dispatcher reading it). */
export function digitsSpoken(s, { oh = false, groups } = {}) {
  const d = String(s).replace(/\D/g, "").split("").map((c) => (c === "0" && oh ? "oh" : ONES[+c]));
  const sizes = groups || (d.length <= 4 ? [d.length] : d.length === 7 ? [3, 4] : d.length === 10 ? [3, 3, 4] : null);
  if (!sizes) { const out = []; for (let i = 0; i < d.length; i += 3) out.push(d.slice(i, i + 3).join(" ")); return out.join(", "); }
  const out = []; let i = 0;
  for (const n of sizes) { out.push(d.slice(i, i + n).join(" ")); i += n; }
  return out.join(", ");
}

/** 14:30 -> "two thirty PM", 9:05 -> "nine oh five AM", 6:00 -> "six AM". */
export function timeSpoken(h24, m) {
  const pm = h24 >= 12, h = h24 % 12 || 12;
  return `${numberWords(h)}${m ? " " + pair(m) : ""} ${pm ? "PM" : "AM"}`;
}

export const PHONETIC = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike",
  "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "X-ray", "Yankee", "Zulu"];
/** "KARIMOV" -> "Kilo, Alpha, Romeo, India, Mike, Oscar, Victor"; digits are read as numbers. */
export function phoneticSpoken(s) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]/g, "").split("").map((c) => (/\d/.test(c) ? ONES[+c] : PHONETIC[c.charCodeAt(0) - 65])).join(", ");
}

// ---------------------------------------------------------------- the drills
/** Kinds of trucking numbers, in the order the practice screen offers them. */
export const DRILL_KINDS = ["load", "phone", "time", "weight", "height", "money", "mile", "temp", "spell"];

const NAMES = ["KARIMOV", "YUSUPOV", "RAHIMOV", "SAIDOV", "NAZAROV", "ALIYEV", "TOSHEV", "ISMOILOV", "UMAROV", "SOBIROV", "QODIROV", "MIRZAYEV",
  "IVANOV", "PETROV", "SMIRNOV", "KOZLOV"];
const STREETS = ["West Commerce Street", "North Industrial Boulevard", "East 5th Street", "South Airport Road", "Warehouse Drive", "Distribution Way",
  "Freight Lane", "Main Street"];
const HIGHWAYS = [["I-40", "I forty"], ["I-80", "I eighty"], ["I-10", "I ten"], ["I-35", "I thirty-five"], ["I-70", "I seventy"], ["I-95", "I ninety-five"]];
const DIRS = ["eastbound", "westbound", "northbound", "southbound"];

/**
 * One drill: { kind, say (what the voice reads), shown (the sentence, displayed after answering), answer (canonical),
 * field (what to type: "digits" | "time" | "height" | "number" | "letters") }.
 */
export function makeDrill(kind, rnd = Math.random) {
  switch (kind) {
    case "load": {
      const len = pick([6, 7, 8], rnd), n = String(int(1, 9, rnd)) + Array.from({ length: len - 1 }, () => int(0, 9, rnd)).join("");
      const what = pick(["Your pickup number is", "The PO number is", "Your load number is", "The reference number is", "The seal number is"], rnd);
      return { kind, field: "digits", answer: n, say: `${what} ${digitsSpoken(n)}.`, shown: `${what} ${n}.` };
    }
    case "phone": {
      const n = `${int(2, 9, rnd)}${int(0, 9, rnd)}${int(0, 9, rnd)}${int(2, 9, rnd)}${int(0, 9, rnd)}${int(0, 9, rnd)}${String(int(0, 9999, rnd)).padStart(4, "0")}`;
      const oh = rnd() < 0.5;
      return { kind, field: "digits", answer: n, say: `Call me back at ${digitsSpoken(n, { oh })}.`, shown: `Call me back at (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}.` };
    }
    case "time": {
      const h = int(1, 23, rnd), m = pick([0, 0, 5, 10, 15, 20, 30, 30, 45, 50], rnd);
      const what = pick(["Your appointment is at", "The dock opens at", "Please be here by", "Your pickup window starts at", "We close at"], rnd);
      const ampm = `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
      return { kind, field: "time", answer: ampm, say: `${what} ${timeSpoken(h, m)}.`, shown: `${what} ${ampm}.` };
    }
    case "weight": {
      const n = pick([80000, 79800, 78500, 76200, 45000, 42500, 34000, 33500, 12000, 36800, 44000], rnd);
      const what = pick(["Your gross weight is", "The load weighs", "Your drive axles are at", "Your trailer axles are at", "The scale shows"], rnd);
      return { kind, field: "number", answer: String(n), say: `${what} ${numberWords(n)} pounds.`, shown: `${what} ${n.toLocaleString("en-US")} lbs.` };
    }
    case "height": {
      const ft = pick([12, 13, 13, 13, 14, 15], rnd), inch = pick([0, 2, 4, 6, 6, 9, 10], rnd);
      const casual = rnd() < 0.5 && inch;
      const spoken = casual ? `${numberWords(ft)} ${numberWords(inch)}` : `${numberWords(ft)} feet${inch ? " " + numberWords(inch) + " inches" : ""}`;
      const what = pick(["The bridge clearance is", "Low clearance ahead:", "Your trailer is", "The overpass is"], rnd);
      return { kind, field: "height", answer: `${ft}'${inch}"`, say: `${what} ${spoken}.`, shown: `${what} ${ft}'${inch}".` };
    }
    case "money": {
      if (rnd() < 0.5) {
        const n = pick([1850, 2350, 2900, 3150, 1475, 4200, 950, 1200], rnd);
        return { kind, field: "number", answer: String(n), say: `The rate is ${numberWords(n)} dollars.`, shown: `The rate is $${n.toLocaleString("en-US")}.` };
      }
      const d = pick([1, 2, 2, 3], rnd), c = pick([25, 50, 75, 10, 85, 40], rnd);
      return { kind, field: "number", answer: `${d}.${c}`, say: `They pay ${numberWords(d)} ${numberWords(c)} a mile.`, shown: `They pay $${d}.${c} a mile.` };
    }
    case "mile": {
      const mm = int(3, 389, rnd), [hw, hwSay] = pick(HIGHWAYS, rnd), dir = pick(DIRS, rnd);
      return { kind, field: "number", answer: String(mm), say: `I'm on ${hwSay} ${dir}, at mile marker ${numberWords(mm)}.`, shown: `I'm on ${hw} ${dir}, at mile marker ${mm}.` };
    }
    case "temp": {
      const n = pick([34, 36, 38, 35, 0, -10, -5, 28, 33], rnd);
      return { kind, field: "number", answer: String(n), say: `Set the reefer to ${numberWords(n)} degrees.`, shown: `Set the reefer to ${n}°F.` };
    }
    case "spell": {
      if (rnd() < 0.5) {
        const name = pick(NAMES, rnd);
        return { kind, field: "letters", answer: name, say: `My last name is ${name.charAt(0) + name.slice(1).toLowerCase()}. ${phoneticSpoken(name)}.`, shown: `My last name is ${name}.` };
      }
      const id = String.fromCharCode(65 + int(0, 25, rnd)) + String.fromCharCode(65 + int(0, 25, rnd)) + int(100, 9999, rnd);
      const what = pick(["The trailer number is", "My truck number is", "The unit number is"], rnd);
      return { kind, field: "letters", answer: id, say: `${what} ${phoneticSpoken(id)}.`, shown: `${what} ${id}.` };
    }
    case "address": default: {
      const n = pick([1450, 405, 2210, 1900, 830, 3175, 615, 1205], rnd), st = pick(STREETS, rnd);
      return { kind: "address", field: "number", answer: String(n), say: `The address is ${streetNumber(n)} ${st}.`, shown: `The address is ${n} ${st}.` };
    }
  }
}

/** A practice round: count drills of the chosen kinds ("all" = every kind), never the same answer twice in a row. */
export function drillRound(kinds = "all", count = 10, rnd = Math.random) {
  const list = kinds === "all" ? DRILL_KINDS.concat("address") : [].concat(kinds);
  const order = [];
  while (order.length < count) order.push(...shuffle(list.slice(), rnd));   // every kind comes up before any repeats
  const out = [];
  for (let i = 0; out.length < count && i < count * 4; i++) {
    const d = makeDrill(order[out.length], rnd);
    if (!out.length || out[out.length - 1].answer !== d.answer) out.push(d);
  }
  return out;
}

const numOf = (s) => {
  const m = /^(-|minus\s*)?\$?\s*([\d,]*\.?\d+)\s*(k)?\s*(lbs?|pounds?|dollars?|degrees?|°f?|f|a mile|per mile|\/mi)?\.?$/i.exec(String(s).trim());
  if (!m) return null;
  let n = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (m[3]) n *= 1000;
  return m[1] ? -n : n;
};

/** Is what the student typed the same as the drill's answer? Forgiving about spaces, dashes, commas, units and case. */
export function checkDrill(drill, input) {
  const s = String(input == null ? "" : input).trim();
  if (!s) return false;
  switch (drill.field) {
    case "digits": return s.replace(/\D/g, "") === drill.answer;
    case "letters": return s.toUpperCase().replace(/[^A-Z0-9]/g, "") === drill.answer;
    case "number": { const n = numOf(s); return n !== null && Math.abs(n - Number(drill.answer)) < 1e-9; }
    case "height": {
      const [, ft, inch] = /^(\d+)'(\d+)"$/.exec(drill.answer);
      const m = /^(\d{1,2})\s*(?:'|ft|feet|foot|-|\.|\s)\s*(\d{1,2})?\s*(?:"|''|in|inch|inches)?\.?$/i.exec(s) || /^(\d{1,2})\s*(?:'|ft|feet|foot)?$/i.exec(s);
      return !!m && +m[1] === +ft && +(m[2] || 0) === +inch;
    }
    case "time": {
      const [, h, mi, ap] = /^(\d+):(\d+) (AM|PM)$/.exec(drill.answer);
      const want24 = (+h % 12) + (ap === "PM" ? 12 : 0);
      const m = /^(\d{1,2})(?:[:.\s]?(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)?$/i.exec(s.replace(/\s+/g, " "));
      if (!m) return false;
      let hh = +m[1]; const mm = +(m[2] || 0);
      if (mm !== +mi) return false;
      if (m[3]) { if (hh < 1 || hh > 12) return false; hh = (hh % 12) + (/^p/i.test(m[3]) ? 12 : 0); return hh === want24; }
      return hh === want24;   // without AM/PM it is read as a 24-hour time: 14:30 is right, 2:30 for "two thirty PM" is not
    }
    default: return normalize(s).toLowerCase() === normalize(drill.answer).toLowerCase();
  }
}

// ---------------------------------------------------------------- saying a phrase: what the phone heard vs the phrase
const NUMWORD = Object.fromEntries([...ONES.map((w, i) => [w, String(i)]), ["oh", "0"], ...TENS.slice(2).map((w, i) => [w, String((i + 2) * 10)])]);
const CONTRACTIONS = { "i'm": "i am", "you're": "you are", "we're": "we are", "they're": "they are", "it's": "it is", "that's": "that is",
  "what's": "what is", "there's": "there is", "here's": "here is", "don't": "do not", "doesn't": "does not", "didn't": "did not",
  "can't": "can not", "cannot": "can not", "won't": "will not", "isn't": "is not", "aren't": "are not", "wasn't": "was not",
  "i'll": "i will", "we'll": "we will", "you'll": "you will", "i've": "i have", "we've": "we have", "i'd": "i would", "let's": "let us" };

export function speechWords(s) {
  const out = [];
  for (let w of normalize(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9' -]+/g, " ").split(/[\s-]+/)) {
    w = w.replace(/^'+|'+$/g, "");
    if (!w) continue;
    const ex = CONTRACTIONS[w];
    if (ex) out.push(...ex.split(" ")); else out.push(NUMWORD[w] || w);
  }
  return out;
}

/** Word-by-word comparison (longest common subsequence). Returns { score 0-100, words: [{ w, ok }] } for the target. */
export function compareSpeech(target, heard) {
  const shownWords = normalize(target).split(/\s+/).filter(Boolean);
  const t = speechWords(target), h = speechWords(heard);
  const L = Array.from({ length: t.length + 1 }, () => new Array(h.length + 1).fill(0));
  for (let i = t.length - 1; i >= 0; i--) for (let j = h.length - 1; j >= 0; j--) L[i][j] = t[i] === h[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ok = new Array(t.length).fill(false);
  for (let i = 0, j = 0; i < t.length && j < h.length;) {
    if (t[i] === h[j]) { ok[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const score = t.length ? Math.round((ok.filter(Boolean).length / t.length) * 100) : 0;
  // map back onto the words as written (a contraction or "13'6" may stand for several spoken words)
  let k = 0;
  const words = shownWords.map((w) => {
    const n = speechWords(w).length || 1;
    const good = ok.slice(k, k + n).every(Boolean);
    k += n;
    return { w, ok: good };
  });
  return { score, words };
}

// ---------------------------------------------------------------- build the sentence, match the pairs, listen and choose
const bare = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

/** Sentences that make a good tile puzzle: 3 to 10 words, no slashes or brackets. */
export const tileable = (s) => { const n = normalize(s).split(/\s+/).length; return n >= 3 && n <= 10 && !/[/()[\]…]/.test(s) && !/\.\.\./.test(s); };

/** { tiles: shuffled words, answer: words in order }. The shuffle never equals the answer (when that is possible). */
export function sentenceTiles(sentence, rnd = Math.random) {
  const answer = normalize(sentence).split(/\s+/).filter(Boolean);
  let tiles = answer.slice();
  const distinct = new Set(answer.map(bare)).size > 1;
  for (let i = 0; i < 8; i++) { shuffle(tiles, rnd); if (!distinct || tiles.map(bare).join(" ") !== answer.map(bare).join(" ")) break; }
  return { tiles, answer };
}
/** Same words in the same order (punctuation and capitals don't count). */
export const sameSentence = (built, answer) => built.map(bare).join(" ") === answer.map(bare).join(" ");

/** n items with different English and different translations (so each pair has one right answer). */
export function distinctItems(items, n, rnd = Math.random) {
  const out = [], en = new Set(), tr = new Set();
  for (const it of shuffle(items.slice(), rnd)) {
    const a = normalize(it.en).toLowerCase(), b = normalize(it.tr).toLowerCase();
    if (!a || !b || en.has(a) || tr.has(b)) continue;
    en.add(a); tr.add(b); out.push(it);
    if (out.length >= n) break;
  }
  return out;
}

/** "Listen and choose": hear item.en, pick it among 4 English phrases. Returns [{ item, opts: [en...], a }]. */
export function listenRound(items, count = 8, rnd = Math.random) {
  const pool = distinctItems(items, Math.max(count, 4) + 6, rnd);
  if (pool.length < 4) return [];
  return pool.slice(0, Math.min(count, pool.length)).map((item) => {
    const others = shuffle(pool.filter((x) => x !== item), rnd).slice(0, 3).map((x) => x.en);
    const opts = shuffle([item.en, ...others], rnd);
    return { item, opts, a: opts.indexOf(item.en) };
  });
}
