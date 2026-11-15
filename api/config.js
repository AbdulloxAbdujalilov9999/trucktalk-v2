/* GET /api/config  -> what the browser needs to start (public, cacheable). ?health=1 adds which services are set up. */
import { endpoint, query } from "../lib/http.js";
import { appUrl, firebaseWebConfig, isDemo } from "../lib/env.js";
import { whopConfigured } from "../lib/payments/whop.js";
import { botUsername, telegramConfigured } from "../lib/telegram.js";
import { tutorConfigured } from "../lib/tutor.js";
import { voiceConfigured } from "../lib/voice.js";
import { ttsProvider } from "../lib/tts.js";

export default endpoint(async (req) => {
  const q = query(req);
  const demo = isDemo();
  const cfg = {
    demo,
    appUrl: appUrl(),
    firebase: demo ? null : firebaseWebConfig(),
    telegramBot: botUsername() || null,
    support: process.env.SUPPORT_TELEGRAM || null,
    features: {
      checkout: demo || whopConfigured(),
      manualPayment: !!process.env.MANUAL_PAYMENT_INFO,
      ai: demo || tutorConfigured(),
      voiceTeacher: voiceConfigured(),
      naturalVoice: !!ttsProvider(),
      telegramLogin: demo || telegramConfigured(),
    },
    manualPayment: process.env.MANUAL_PAYMENT_INFO || null,
  };
  if (q.health) cfg.health = { database: demo ? "memory" : process.env.FIREBASE_SERVICE_ACCOUNT ? "rtdb" : "missing", sessionSecret: !!process.env.SESSION_SECRET || demo };
  return { __raw: true, body: cfg, headers: { "cache-control": q.health ? "no-store" : "public, max-age=60, s-maxage=300" } };
}, { methods: ["GET"] });
