#!/usr/bin/env node
/* Connects the Telegram bot to the deployed app (run once after deploying, and again if APP_URL changes).
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... APP_URL=https://your-domain node scripts/telegram-setup.mjs
 *   ... node scripts/telegram-setup.mjs --info      (only show what Telegram has now)
 * It sets the webhook to <APP_URL>/api/webhooks?src=telegram with the secret Telegram sends back on every update (the
 * server refuses updates without it), asks only for the update types the bot handles, and sets the bot's menu commands.
 * Use the same TELEGRAM_WEBHOOK_SECRET as in the server's environment: 32+ random letters/digits (openssl rand -hex 32). */
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const base = (process.env.APP_URL || "").replace(/\/+$/, "");
const infoOnly = process.argv.includes("--info");

if (!/^\d+:[\w-]{30,}$/.test(token)) { console.error("Set TELEGRAM_BOT_TOKEN (from @BotFather)."); process.exit(2); }

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${method}: ${data.description || r.status}`);
  return data.result;
}

try {
  const me = await tg("getMe");
  console.log(`bot: @${me.username} (set TELEGRAM_BOT_USERNAME=${me.username} on the server)`);
  if (!infoOnly) {
    if (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) throw new Error("APP_URL must be the public https:// address of the deployed app");
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET must be 32-256 letters, digits, _ or - (openssl rand -hex 32)");
    await tg("setWebhook", {
      url: base + "/api/webhooks?src=telegram",
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
      max_connections: 20,
    });
    const commands = {
      uz: [["start", "Boshlash: bepul darslar va kurs"], ["login", "Ilovaga kirish havolasi"], ["help", "Yordam"]],
      ru: [["start", "Начать: бесплатные уроки и курс"], ["login", "Ссылка для входа в приложение"], ["help", "Помощь"]],
      en: [["start", "Start: free lessons and the course"], ["login", "Sign-in link for the app"], ["help", "Help"]],
    };
    await tg("setMyCommands", { commands: commands.uz.map(([command, description]) => ({ command, description })) });
    for (const [lang, list] of Object.entries(commands)) {
      await tg("setMyCommands", { commands: list.map(([command, description]) => ({ command, description })), language_code: lang });
    }
    console.log("webhook and commands set");
  }
  const info = await tg("getWebhookInfo");
  console.log(`webhook: ${info.url || "(none)"}; pending updates: ${info.pending_update_count}` +
    (info.last_error_message ? `; last error: ${info.last_error_message}` : ""));
} catch (e) {
  console.error("telegram-setup: " + e.message);
  process.exit(1);
}
