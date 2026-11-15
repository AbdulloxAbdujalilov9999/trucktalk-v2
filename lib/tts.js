/* Natural voices for course phrases (ElevenLabs preferred, OpenAI as an alternative).
 *
 * Why this can be public without becoming a free text-to-speech service or a way to run up the bill:
 *  - it only speaks phrases that are in the course (content/phrases-*.json, built from the lessons),
 *  - it answers only the one canonical URL of each phrase (exact parameter set, order and encoding; see ttsQuery in
 *    public/js/shared/text.js), so extra or reordered parameters can't create new CDN cache entries that each cost money,
 *  - a good answer is cached for a year by the CDN and the browser, so each phrase is generated about once,
 *  - generation has a global daily character budget kept in the database; past it the app uses the device voice.
 * Any failure answers 503 without caching and the app falls back to the phone's own voice. */
import { readJson, int } from "./env.js";
import { normalize, ttsQuery, VOICE_VERSION } from "../public/js/shared/text.js";
import { take } from "./limits.js";

let EN = null, UZ = null;
const phrases = () => { if (!EN) { EN = readJson("content/phrases-en.json"); UZ = readJson("content/phrases-uz.json"); } return { EN, UZ }; };

const ELEVEN = { female: "21m00Tcm4TlvDq8ikWAM", male: "nPczCjzI2devNBz1zQrb" };   // Rachel, Brian (premade US voices)
const OPENAI = { female: "nova", male: "onyx" };
const UZ_VOICE = "agoC45V78njTIxYzwmSb";                                        // native Uzbek voice ("Davronbek")

export function ttsProvider(env = process.env) { return env.ELEVENLABS_API_KEY ? "elevenlabs" : env.OPENAI_API_KEY ? "openai" : null; }

/** Validates a request. Returns { text, say, lang, gender } or { status, error }. */
export function parseRequest(q, rawQs) {
  const allowed = new Set(["t", "g", "l", "v"]);
  if (Object.keys(q).some((k) => !allowed.has(k))) return { status: 400, error: "params" };
  if (q.v !== VOICE_VERSION) return { status: 400, error: "version" };
  const lang = q.l === "uz" ? "uz" : q.l == null ? "en" : null;
  if (!lang) return { status: 400, error: "lang" };
  if (lang === "uz" && q.g != null) return { status: 400, error: "params" };
  if (lang === "en" && q.g !== "female" && q.g !== "male") return { status: 400, error: "gender" };
  const text = typeof q.t === "string" ? q.t : "";
  if (!text || text.length > 600 || normalize(text) !== text) return { status: 400, error: "text" };
  if (rawQs !== ttsQuery(text, { lang, gender: q.g })) return { status: 400, error: "not-canonical" };
  const { EN, UZ } = phrases();
  if (lang === "en" && !EN[text]) return { status: 404, error: "not-in-course" };
  if (lang === "uz" && !UZ[text]) return { status: 404, error: "not-in-course" };
  return { text, say: lang === "en" ? EN[text] : text, lang, gender: q.g || null };
}

async function synth(r, env) {
  if (r.lang === "uz") {
    return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_UZ_VOICE || UZ_VOICE)}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: r.say, model_id: env.ELEVENLABS_UZ_MODEL || "eleven_v4", language_code: "uz", voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }),
    });
  }
  if (ttsProvider(env) === "elevenlabs") {
    const voice = (r.gender === "male" ? env.ELEVENLABS_VOICE_MALE : env.ELEVENLABS_VOICE_FEMALE) || ELEVEN[r.gender];
    return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: r.say, model_id: env.ELEVENLABS_MODEL || "eleven_multilingual_v2", voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }),
    });
  }
  const voice = (r.gender === "male" ? env.OPENAI_VOICE_MALE : env.OPENAI_VOICE_FEMALE) || OPENAI[r.gender];
  return fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: env.OPENAI_TTS_MODEL || "tts-1-hd", voice, input: r.say, response_format: "mp3" }),
  });
}

/** { status, body, headers } */
export async function speak(q, rawQs, env = process.env, now = Date.now()) {
  const r = parseRequest(q, rawQs);
  if (r.error) return { status: r.status, body: { error: r.error } };
  const prov = ttsProvider(env);
  if (!prov || (r.lang === "uz" && !env.ELEVENLABS_API_KEY)) return { status: 503, body: { error: "not-configured" } };
  const budget = await take("tts/chars", int("TTS_DAILY_CHARS", 60000), { amount: r.say.length, now });
  if (!budget.ok) return { status: 503, body: { error: "budget" } };
  let up;
  try {
    up = await synth(r, env);
    if (up.status >= 500) up = await synth(r, env);   // one retry for a hiccup on their side
  } catch {
    try { up = await synth(r, env); } catch { return { status: 503, body: { error: "upstream-unreachable" } }; }
  }
  if (!up.ok) return { status: 503, body: { error: "upstream-" + up.status } };
  const audio = Buffer.from(await up.arrayBuffer());
  if (!audio.length) return { status: 503, body: { error: "empty-audio" } };
  return {
    status: 200, body: audio,
    headers: { "content-type": "audio/mpeg", "content-length": String(audio.length), "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable" },
  };
}
