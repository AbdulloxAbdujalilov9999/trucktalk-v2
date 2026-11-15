/* GET /api/tts?g=female&t=<phrase>&v=1   GET /api/tts?l=uz&t=<narrator line>&v=1   -> audio/mpeg (see lib/tts.js) */
import { endpoint, query, rawQueryString, raw, clientIp, fail } from "../lib/http.js";
import { speak } from "../lib/tts.js";
import { memoryLimiter } from "../lib/limits.js";

const limiter = memoryLimiter({ max: 120, windowMs: 60 * 1000 });

export default endpoint(async (req) => {
  if (!limiter(clientIp(req))) fail(429, "slow-down");
  const r = await speak(query(req), rawQueryString(req));
  return raw(r.body, r.status, r.headers || {});
}, { methods: ["GET", "HEAD"] });
