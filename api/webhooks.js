/* Webhooks from other services (one function to stay within the free plan's function count):
 *   POST /api/webhooks?src=whop       payments, refunds, disputes (Standard Webhooks signature required)
 *   POST /api/webhooks?src=telegram   bot updates (X-Telegram-Bot-Api-Secret-Token required) */
import { endpoint, fail, query, readRaw, header } from "../lib/http.js";
import { safeEqual } from "../lib/crypto.js";
import { verifyWebhook, handleWebhook } from "../lib/payments/whop.js";
import { handleUpdate, telegramConfigured } from "../lib/telegram.js";

export default endpoint(async (req) => {
  const src = query(req).src;
  const body = (await readRaw(req, 256 * 1024)).toString("utf8");
  if (src === "whop") {
    const secret = process.env.WHOP_WEBHOOK_SECRET;
    if (!secret) fail(503, "not-configured");
    const h = { "webhook-id": header(req, "webhook-id"), "webhook-timestamp": header(req, "webhook-timestamp"), "webhook-signature": header(req, "webhook-signature") };
    if (!verifyWebhook(h, body, secret)) fail(401, "signature");
    let event; try { event = JSON.parse(body); } catch { fail(400, "json"); }
    const result = await handleWebhook(h["webhook-id"], event);
    console.log("whop: " + (event && event.type) + " -> " + result);
    return { ok: true, result };
  }
  if (src === "telegram") {
    if (!telegramConfigured()) fail(503, "not-configured");
    if (!safeEqual(header(req, "x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) fail(401, "secret");
    let update; try { update = JSON.parse(body); } catch { fail(400, "json"); }
    try { await handleUpdate(update); } catch (e) { console.error("telegram update failed:", e && e.message); }
    return { ok: true };   // always 200 so Telegram doesn't retry a broken update forever
  }
  fail(404, "src");
}, { methods: ["POST"] });
