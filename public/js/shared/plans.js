/* What is free, what a trial gives, and what each paid plan costs and includes.
 * Public on purpose (the pricing screen shows it); the server imports this same file and enforces it. */

export const TRIAL_DAYS = 3;

// Free without paying: the five Orientation lessons, course days 1-3, the first grammar units, and all 50 video lessons.
export const FREE_DAYS_UP_TO = 3;
export const FREE_GRAMMAR_COUNT = 4;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Paid plans. `id` is what the app and the payment provider agree on; Whop plan ids are mapped in env (WHOP_PLAN_<ID>). */
export const PLANS = [
  { id: "self_month",   tier: "self", days: 30, usd: 19,  per: "month",   popular: false },
  { id: "self_quarter", tier: "self", days: 90, usd: 49,  per: "3months", popular: true },
  { id: "pro_month",    tier: "pro",  days: 30, usd: 149, per: "month",   popular: false },
  { id: "pro_quarter",  tier: "pro",  days: 90, usd: 399, per: "3months", popular: false },
];

export const TIERS = {
  free:  { ai: 3,   voiceMin: 0 },
  trial: { ai: 15,  voiceMin: 0 },
  self:  { ai: 40,  voiceMin: 30 },    // voice minutes per 30 days
  pro:   { ai: 100, voiceMin: 300 },
  staff: { ai: 200, voiceMin: 600 },
};

/** What each tier includes, for the pricing cards (keys are i18n keys). */
export const FEATURES = {
  self: ["f.allLessons", "f.grammar", "f.review", "f.aiCheck", "f.voice30", "f.offline"],
  pro: ["f.everythingSelf", "f.liveClasses", "f.mockInspection", "f.voice300", "f.teacherChat"],
};

export function planById(id) { return PLANS.find((p) => p.id === id) || null; }

/** Is this course day free? Orientation days are numbered -4..0. */
export function dayIsFree(n) { return Number(n) <= FREE_DAYS_UP_TO; }

/** Free grammar units: the first few in the book, plus any unit a free day points to. */
export function freeGrammarIds(grammarIds, freeDayGrammarIds = []) {
  return new Set([...grammarIds.slice(0, FREE_GRAMMAR_COUNT), ...freeDayGrammarIds.filter(Boolean)]);
}
