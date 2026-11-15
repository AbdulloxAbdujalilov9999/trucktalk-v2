/* Text helpers shared by the browser, the server and the build scripts (one copy, so they always agree). */

/** One normalisation everywhere: "Hello / Hi", "Hello / Hi " and "Hello / Hi..." are the same phrase. */
export function normalize(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().replace(/\.\.\.$/, "").trim();
}

/** How a course phrase should be read aloud ("Hello / Hi" -> "Hello, Hi"). */
export function spoken(text) {
  return String(text).replace(/\s*\/\s*/g, ", ").replace(/\s*\.\.\.\s*/g, "… ").replace(/\s+/g, " ").trim();
}

/** The voice set in use. Bumping it changes every audio URL on purpose (new voices); the server accepts only this one. */
export const VOICE_VERSION = "1";

/**
 * The one canonical query string for a natural-voice phrase. The server answers only this exact form (same parameter
 * order, same encoding), so a phrase has exactly one cacheable URL and nobody can make the CDN miss on purpose.
 *   lang "en": gender "female" | "male";  lang "uz": the teacher's Uzbek voice (no gender).
 */
export function ttsQuery(text, { lang = "en", gender = "female" } = {}) {
  const t = encodeURIComponent(normalize(text));
  return lang === "uz" ? `l=uz&t=${t}&v=${VOICE_VERSION}` : `g=${gender === "male" ? "male" : "female"}&t=${t}&v=${VOICE_VERSION}`;
}

/** HTML-escape for templates. */
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Loose comparison for typed answers: case, punctuation and extra spaces don't count. */
export function looseEqual(a, b) {
  const f = (s) => normalize(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  return f(a) === f(b);
}
