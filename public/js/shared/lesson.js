/* Practice inside a course day, with no screen attached (the browser and the tests share it):
 *  - findWord: where a vocabulary word sits in its example sentence (whole words; -s, -es, -ed, -d, -ing and 's allowed)
 *  - blankRound: "fill in the blank" questions built from a day's words and their example sentences
 *  - vocabRound: word questions for quizzes and homework (what it means, how to say it, what you heard)
 *  - speakers: who talks in a dialogue, and which of them the student plays by default */
import { normalize } from "./text.js";
import { shuffle, distinctItems } from "./drills.js";

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// What may follow the word: a possessive ("the driver's"), a plural or a verb ending.
const ENDING = "(?:'s|’s|s|es|ed|d|ing)?";
// A word starts after a non-letter or an opening quote ("a 'No Trucks' sign"), and ends before a non-letter or a closing quote.
// No lookbehind, so older phones can read it.
const BEFORE = "(^|[^A-Za-z0-9'’]|(?:^|[^A-Za-z0-9])['‘])";
const AFTER = "(?=$|[^A-Za-z0-9'’]|['’](?:$|[^A-Za-z0-9]))";

/** The forms of a vocabulary entry worth looking for, the short form first: "Reefer / Dry van" -> ["Reefer", "Dry van"],
 *  "To load" -> ["load", "To load"], "Trailer (pritsep)" -> ["Trailer"]. */
export function wordForms(en) {
  const out = [];
  for (let alt of normalize(String(en || "").replace(/\([^)]*\)/g, " ")).split(/\s*\/\s*/)) {
    alt = alt.replace(/[.!?,;:]+$/, "").trim();
    if (!alt || alt.length > 40) continue;
    const bare = alt.replace(/^(to|a|an|the)\s+/i, "");
    if (bare && bare !== alt) out.push(bare);
    out.push(alt);
  }
  return [...new Set(out)];
}

/** Finds a form of the word in the sentence: { start, end (of the word itself), ending (the -s/-ed/'s... after it), form }
 *  or null. Spaces in the word also match hyphens ("Wake up call" finds "wake-up call"). */
export function findWord(sentence, word) {
  const s = String(sentence || "");
  for (const form of wordForms(word)) {
    const re = new RegExp(`${BEFORE}(${escRe(form).replace(/\s+/g, "[\\s-]+")})(${ENDING})${AFTER}`, "i");
    const m = re.exec(s);
    if (m) {
      const start = m.index + m[1].length;
      return { start, end: start + m[2].length, ending: m[3], form };
    }
  }
  return null;
}

/** Does a gap after this text start a sentence? Nothing but quotes before it, or a full stop, "!" or "?". */
const startsSentence = (before) => /^[\s"'‘“(]*$/.test(before) || /[.!?]["'’”)]?\s+["'‘“(]*$/.test(before);

/** Letters, acronyms and codes: "A", "DOT", "GPS coordinates", "W-2", "U-turn". */
const acronym = (w) => /^[A-Z0-9]$/.test(w) || /^[A-Z0-9]{2,}\b/.test(w) || /^[A-Z][-\d]/.test(w);
/** Always written with a capital: acronyms, "I ..." phrases ("I need help") and names inside the phrase ("Alpha, Bravo,
 *  Charlie", "No U-turn", "Social Security number"). */
const keepsCapital = (w) => acronym(w) || /^I(?:\s|'|’|$)/.test(w) || /[\s,][A-Z]/.test(w);
/** Wrong options of the same kind as the answer are picked first: acronyms with acronyms, "I ..." phrases together. */
const kind = (w) => (/^I(?:\s|'|’)/.test(w) ? "i" : acronym(w) ? "acr" : "word");

/** A wrong option written to fit the gap: capitalised at the start of a sentence, else lower-case, unless it is always
 *  written with a capital (keepsCapital) or up is set: the option is a name ("Interstate", which its own example writes
 *  with a capital), or the answer is, and then every option gets a capital so the capital never gives the answer away. */
function fit(word, atStart, up) {
  if (keepsCapital(word)) return word;
  return (atStart || up ? word.charAt(0).toUpperCase() : word.charAt(0).toLowerCase()) + word.slice(1);
}

/** Where a word sits in its own example: the sentence, the match, and whether the gap starts a sentence, or the example
 *  writes the word with a capital mid-sentence (a name, a sign, an acronym). */
function locate(w) {
  const s = normalize(w.ex);
  const h = findWord(s, w.en);
  if (!h) return null;
  const atStart = startsSentence(s.slice(0, h.start));
  return { s, h, atStart, name: !atStart && /^[A-Z]/.test(s.slice(h.start, h.end)) };
}

/**
 * "Fill in the blank" from a day's words. words: [{ id, en, ex (the example sentence), tr (its translation) }].
 * Returns up to count questions: [{ id, before, after, answer (as the sentence writes it), opts: [3-4 words], a (index
 * of the answer), tr }], only for words found in their own example, each with 2-3 other words of the day as wrong options.
 */
export function blankRound(words, count = 6, rnd = Math.random) {
  const usable = [];
  const seen = new Set();
  for (const w of words || []) {
    const forms = wordForms(w.en);
    if (!forms.length) continue;
    const key = forms[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const at = locate(w);
    usable.push({ w, label: forms[0], at, name: !!(at && at.name) });
  }
  const pool = usable.filter((u) => u.at);
  if (pool.length < 2 || usable.length < 3) return [];
  return shuffle(pool.slice(), rnd).slice(0, count).map((u) => {
    const { s, h, atStart, name } = u.at;
    const answer = s.slice(h.start, h.end);
    // Wrong options written the way the gap needs; those that look like the answer (same capital, same kind) first.
    const cap = (w) => /^\p{Lu}/u.test(w), same = kind(answer);
    const far = (o) => (cap(o.txt) !== cap(answer)) * 2 + (kind(o.label) !== same);
    const rest = shuffle(usable.filter((x) => x !== u), rnd).map((o) => ({ label: o.label, txt: fit(o.label, atStart, name || o.name) }));
    rest.sort((x, y) => far(x) - far(y));
    const others = [];
    for (const { txt } of rest) {
      if (txt.toLowerCase() !== answer.toLowerCase() && !others.some((x) => x.toLowerCase() === txt.toLowerCase())) others.push(txt);
      if (others.length >= 3) break;
    }
    const opts = shuffle([answer, ...others], rnd);
    return { id: u.w.id, before: s.slice(0, h.start), after: s.slice(h.end), answer, opts, a: opts.indexOf(answer), tr: u.w.tr || "" };
  }).filter((q) => q.opts.length >= 3);
}

/**
 * Word questions, each word asked once. items: [{ id, en, tr }]. Returns up to count questions:
 * [{ id, kind, en, tr, opts, a }] where kind is
 *   "meaning"  what does <en> mean?            -> pick the translation
 *   "reverse"  how do you say <tr> in English? -> pick the English
 *   "listen"   (hear <en>) what did you hear?  -> pick the English
 * The kinds take turns. Wrong options are other words of the same list; no two options read the same, in either language,
 * so every question has exactly one right answer. Needs at least 3 different words (then each question has 3-4 options).
 */
export function vocabRound(items, count = 8, rnd = Math.random, kinds = ["meaning", "reverse", "listen"]) {
  const pool = distinctItems((items || []).filter((x) => x && normalize(x.en) && normalize(x.tr)), 2000, rnd);
  if (pool.length < 3 || !kinds.length) return [];
  return pool.slice(0, Math.max(0, count)).map((item, i) => {
    const kind = kinds[i % kinds.length];
    const side = kind === "meaning" ? "tr" : "en";
    const others = shuffle(pool.filter((x) => x !== item), rnd).slice(0, 3).map((x) => x[side]);
    const opts = shuffle([item[side], ...others], rnd);
    return { id: item.id, kind, en: item.en, tr: item.tr, opts, a: opts.indexOf(item[side]) };
  });
}

/** The people in a dialogue, in the order they first speak. */
export function speakers(dialogue) {
  return [...new Set((dialogue || []).map((l) => String(l.who || "").trim()).filter(Boolean))];
}

/** Who the student plays unless they choose: the driver ("Driver", else the first "Driver …"), else the second speaker. */
export function defaultSpeaker(dialogue) {
  const all = speakers(dialogue);
  return all.find((w) => /^driver$/i.test(w)) || all.find((w) => /driver|haydovchi/i.test(w)) || all[1] || all[0] || "";
}
