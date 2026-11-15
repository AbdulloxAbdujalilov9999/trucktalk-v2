/* Course content, kept on the server. Lessons are sent only to people who may open them, and quiz answers are never sent
 * before an answer is given (grading happens here, see grade()). */
import { readJson } from "./env.js";
import { dayIsFree, freeGrammarIds } from "../public/js/shared/plans.js";

let cache = null;
function load() {
  if (cache) return cache;
  const course = readJson("content/course.json");
  const grammar = readJson("content/grammar.json");
  const days = new Map([...course.orientation, ...course.days].map((d) => [d.n, d]));
  const units = new Map(grammar.map((g) => [g.id, g]));
  const freeG = freeGrammarIds(grammar.map((g) => g.id), course.days.filter((d) => dayIsFree(d.n)).map((d) => d.grammarId));
  cache = { days, units, freeG };
  return cache;
}

export function getDay(n) { return load().days.get(Number(n)) || null; }
export function getGrammar(id) { return load().units.get(String(id)) || null; }
export function grammarIsFree(id) { return load().freeG.has(String(id)); }

/** May this access open this item? Free items: everyone, even without an account. */
export function mayOpen(access, kind, id) {
  if (kind === "day") return !!getDay(id) && (dayIsFree(id) || !!access.full);
  if (kind === "grammar") return !!getGrammar(id) && (grammarIsFree(id) || !!access.full);
  return false;
}
export function isFree(kind, id) { return kind === "day" ? dayIsFree(id) : kind === "grammar" ? grammarIsFree(id) : false; }

const stripQuiz = (quiz) => quiz.map(({ q, opts }) => ({ q, opts }));

/** The lesson as the browser gets it: everything except the quiz answers. */
export function publicItem(kind, id) {
  if (kind === "day") {
    const d = getDay(id);
    return d && { ...d, quiz: stripQuiz(d.quiz) };
  }
  const g = getGrammar(id);
  if (!g) return null;
  const { teach, ...rest } = g;   // teacher notes stay with teachers
  return { ...rest, quiz: stripQuiz(g.quiz) };
}
/** { "<day>": [word...] } for every day this access may open. */
export function wordsFor(access) {
  const out = {};
  for (const [n, d] of load().days) if (d.words.length && (dayIsFree(n) || access.full)) out[n] = d.words;
  return out;
}
export function teacherNotes(id) { const g = getGrammar(id); return g ? g.teach : []; }

/** Grades answers (array of option indexes, null = skipped). Answers are revealed only for questions that were answered. */
export function grade(kind, id, answers) {
  const item = kind === "day" ? getDay(id) : getGrammar(id);
  if (!item) return null;
  const quiz = item.quiz;
  if (!Array.isArray(answers) || answers.length !== quiz.length) return { error: "answers" };
  let score = 0;
  const results = quiz.map((q, i) => {
    const a = answers[i];
    if (!(Number.isInteger(a) && a >= 0 && a < q.opts.length)) return { correct: false, answer: null };
    const ok = a === q.a;
    if (ok) score++;
    return { correct: ok, answer: q.a };
  });
  return { score, total: quiz.length, results };
}
