/* The Telegram bot: where people who watched a video land ("DM TRUCK" now has a real answer), and a sign-in method.
 *
 *   t.me/<bot>?start=v12   -> lesson 12: its key phrases, a link to the lesson in the app, and the course offer
 *   "TRUCK" / /start       -> welcome: free video lessons, start the course, prices, sign in
 *   /login or "Kirish"     -> a one-time sign-in link (10 minutes, single use) that opens the app already signed in
 *   t.me/<bot>?start=link_<code> -> connects this Telegram to an account that is signed in with Google/email
 *   sharing the contact    -> the verified phone number is saved (only your own contact counts)
 * Every lead is remembered with the video it came from (admin > Leads).
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (also given to setWebhook), TELEGRAM_BOT_USERNAME. */
import { db, key } from "./db.js";
import { newId, signToken, verifyToken } from "./crypto.js";
import { appUrl, readJson, sessionSecret } from "./env.js";
import { PLANS } from "../public/js/shared/plans.js";

export const LOGIN_TTL_MS = 10 * 60 * 1000;
export const telegramConfigured = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
export const botUsername = () => (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");

let videos = null;
const videoList = () => (videos ||= readJson("public/data/videos.json"));

// ---------------------------------------------------------------- texts (Uzbek, Russian)
const T = {
  uz: {
    welcome: (name) => `Assalomu alaykum${name ? ", " + name : ""}! 🚛\n\n<b>TruckTalk</b> — Amerikada ishlayotgan trakchilar uchun ingliz tili.\n\n• 50 ta bepul video dars (politsiya, broker, DOT, tarozi, yoʻl belgilari…)\n• 60 kunlik toʻliq kurs: soʻzlar, dialoglar, grammatika, test\n• AI oʻqituvchi gapingizni tekshiradi\n\nQuyidagidan birini tanlang 👇`,
    lesson: (v) => `🎬 <b>${v.n}-dars: ${esc(v.title.uz)}</b>\n<i>${esc(v.title.en)}</i>\n\nAsosiy iboralar:\n${keyPhrases(v).map((p) => `• <b>${esc(p.en)}</b> — ${esc(p.uz)}`).join("\n")}\n\nDarsni ilovada oching: tinglang, takrorlang va oʻzingizni sinang 👇`,
    login: "🔑 Ilovaga kirish uchun tugmani bosing. Havola 10 daqiqa ishlaydi va faqat bir marta ochiladi.\n\nHech kimga yubormang.",
    prices: () => `💳 <b>Narxlar</b>\n\n${PLANS.map((p) => `• ${p.tier === "pro" ? "Pro (jonli darslar bilan)" : "Mustaqil"}, ${p.per === "month" ? "1 oy" : "3 oy"}: <b>$${p.usd}</b>`).join("\n")}\n\nBirinchi 3 kun bepul sinab koʻrishingiz mumkin. Toʻlov ilova ichida.`,
    help: "Yozing:\n• dars raqami (masalan <b>12</b>) — video darsni ochish\n• <b>/login</b> — ilovaga kirish\n• <b>/narx</b> — narxlar",
    linked: "✅ Telegram hisobingizga ulandi. Endi shu yerdan ham kira olasiz.",
    linkBad: "Bu havola eskirgan. Ilovada «Telegramni ulash»ni qayta bosing.",
    linkTaken: "Bu Telegram boshqa hisobga ulangan. Yordam uchun admin bilan bogʻlaning.",
    phoneSaved: "📱 Raqamingiz saqlandi. Rahmat!",
    phoneOnlyOwn: "Iltimos, oʻzingizning raqamingizni «Raqamni ulashish» tugmasi orqali yuboring.",
    noLesson: "Bunday dars yoʻq. 1 dan 50 gacha raqam yozing.",
    btnVideos: "📚 Bepul video darslar", btnStart: "🎓 Kursni boshlash", btnLogin: "🔑 Ilovaga kirish", btnPrices: "💳 Narxlar",
    btnOpenLesson: (n) => `▶️ ${n}-darsni ochish`, btnLoginNow: "🔑 Kirish", btnPhone: "📱 Raqamni ulashish",
  },
  ru: {
    welcome: (name) => `Здравствуйте${name ? ", " + name : ""}! 🚛\n\n<b>TruckTalk</b> — английский для дальнобойщиков, которые уже работают в США.\n\n• 50 бесплатных видеоуроков (полиция, брокер, DOT, весы, знаки…)\n• Полный курс на 60 дней: слова, диалоги, грамматика, тесты\n• AI-учитель проверяет ваши фразы\n\nВыберите 👇`,
    lesson: (v) => `🎬 <b>Урок ${v.n}: ${esc(v.title.en)}</b>\n<i>${esc(v.title.uz)}</i>\n\nГлавные фразы:\n${keyPhrases(v).map((p) => `• <b>${esc(p.en)}</b> — ${esc(p.uz)}`).join("\n")}\n\nОткройте урок в приложении 👇`,
    login: "🔑 Нажмите кнопку, чтобы войти в приложение. Ссылка работает 10 минут и открывается один раз.\n\nНикому её не пересылайте.",
    prices: () => `💳 <b>Цены</b>\n\n${PLANS.map((p) => `• ${p.tier === "pro" ? "Pro (с живыми уроками)" : "Самостоятельно"}, ${p.per === "month" ? "1 месяц" : "3 месяца"}: <b>$${p.usd}</b>`).join("\n")}\n\nПервые 3 дня можно попробовать бесплатно. Оплата в приложении.`,
    help: "Напишите:\n• номер урока (например <b>12</b>)\n• <b>/login</b> — вход в приложение\n• <b>/narx</b> — цены",
    linked: "✅ Telegram подключён к вашему аккаунту.",
    linkBad: "Ссылка устарела. Нажмите «Подключить Telegram» в приложении ещё раз.",
    linkTaken: "Этот Telegram уже подключён к другому аккаунту. Напишите администратору.",
    phoneSaved: "📱 Номер сохранён. Спасибо!",
    phoneOnlyOwn: "Пожалуйста, отправьте свой номер кнопкой «Поделиться номером».",
    noLesson: "Такого урока нет. Напишите число от 1 до 50.",
    btnVideos: "📚 Бесплатные видеоуроки", btnStart: "🎓 Начать курс", btnLogin: "🔑 Войти в приложение", btnPrices: "💳 Цены",
    btnOpenLesson: (n) => `▶️ Открыть урок ${n}`, btnLoginNow: "🔑 Войти", btnPhone: "📱 Поделиться номером",
  },
};
const esc = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function keyPhrases(v) {
  const items = v.recap.length ? v.recap : v.cards.length ? v.cards : v.lines.filter((l) => l.who !== "narrator");
  return items.slice(0, 4);
}
const langOf = (from) => (String((from && from.language_code) || "").startsWith("ru") ? "ru" : "uz");

// ---------------------------------------------------------------- one-time sign-in links
export function loginLink(from, now = Date.now()) {
  const token = signToken({ t: "tglogin", tg: from.id, n: String(from.first_name || "").slice(0, 40), u: String(from.username || "").slice(0, 40), l: langOf(from), jti: newId(), exp: now + LOGIN_TTL_MS }, sessionSecret());
  return appUrl() + "/app#tg=" + token;
}

/** Exchanges a sign-in link token for the account it opens. Single use. Returns { uid, telegramId, name, ... } or null. */
export async function redeemLogin(token, now = Date.now()) {
  const p = verifyToken(token, sessionSecret(), now);
  if (!p || p.t !== "tglogin" || !Number.isInteger(p.tg) || typeof p.jti !== "string") return null;
  if (!(await db().createOnce("loginTokens/" + key(p.jti), { at: now, exp: p.exp }))) return null;
  const tg = String(p.tg);
  await db().createOnce("telegram/" + tg, { uid: "tg" + tg, at: now });
  const link = await db().get("telegram/" + tg);
  return { uid: link.uid, telegramId: p.tg, name: p.n || null, username: p.u || null, lang: p.l || "uz", phone: link.phone || null };
}

/** A code a signed-in person sends to the bot to connect their Telegram (start=link_<code>). */
export async function createLinkCode(uid, now = Date.now()) {
  const code = newId().slice(-16);
  await db().set("telegramLinks/" + code, { uid, exp: now + LOGIN_TTL_MS });
  return code;
}

// ---------------------------------------------------------------- Bot API
async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) console.error("telegram " + method + " " + r.status + " " + (await r.text().catch(() => "")).slice(0, 200));
  return r.ok;
}
const urlBtn = (text, url) => ({ text, url });
const cbBtn = (text, data) => ({ text, callback_data: data });
function menu(L, src) {
  const q = src ? "?src=" + encodeURIComponent(src) : "?src=tg";
  return { inline_keyboard: [[urlBtn(L.btnVideos, appUrl() + "/app/videos" + q)], [urlBtn(L.btnStart, appUrl() + "/app" + q)], [cbBtn(L.btnLogin, "login"), cbBtn(L.btnPrices, "prices")]] };
}

async function rememberLead(from, source, now) {
  const id = String(from.id);
  const path = "leads/" + id;
  const cur = (await db().get(path)) || {};
  const update = {
    name: [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, 80) || null,
    username: from.username || null, lang: langOf(from), lastAt: now, count: (cur.count || 0) + 1,
  };
  if (!cur.firstAt) { update.firstAt = now; update.firstSource = source; }
  if (source && !(cur.sources && cur.sources[source])) update["sources/" + source] = now;
  await db().update(path, Object.fromEntries(Object.entries(update).filter(([, v]) => v !== null)));
}

// ---------------------------------------------------------------- updates
async function sendLesson(chat, L, n, from, now) {
  const v = videoList().find((x) => x.n === n);
  if (!v) return api("sendMessage", { chat_id: chat, text: L.noLesson });
  await rememberLead(from, "v" + n, now);
  return api("sendMessage", {
    chat_id: chat, text: L.lesson(v), parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[urlBtn(L.btnOpenLesson(n), `${appUrl()}/v/${n}?src=tg`)], [urlBtn(L.btnStart, appUrl() + "/app?src=tg-v" + n)], [cbBtn(L.btnLogin, "login"), cbBtn(L.btnPrices, "prices")]] },
  });
}

async function sendLogin(chat, L, from, now) {
  return api("sendMessage", {
    chat_id: chat, text: L.login,
    reply_markup: { inline_keyboard: [[urlBtn(L.btnLoginNow, loginLink(from, now))]] },
  });
}

async function linkAccount(chat, L, from, code, now) {
  const rec = /^[a-z0-9]{8,32}$/.test(code) ? await db().get("telegramLinks/" + code) : null;
  if (rec) await db().remove("telegramLinks/" + code);
  if (!rec || rec.exp < now) return api("sendMessage", { chat_id: chat, text: L.linkBad });
  const tg = String(from.id);
  const existing = await db().get("telegram/" + tg);
  if (existing && existing.uid !== rec.uid && existing.uid !== "tg" + tg) return api("sendMessage", { chat_id: chat, text: L.linkTaken });
  if (existing && existing.uid === "tg" + tg && (await db().get("users/tg" + tg))) {
    // this Telegram already has its own account with possible progress: keep it, ask the admin to merge
    return api("sendMessage", { chat_id: chat, text: L.linkTaken });
  }
  await db().update("", {
    ["telegram/" + tg]: { uid: rec.uid, at: now },
    [`users/${key(rec.uid)}/telegramId`]: from.id,
    [`users/${key(rec.uid)}/telegramUsername`]: from.username || null,
  });
  return api("sendMessage", { chat_id: chat, text: L.linked });
}

async function savePhone(chat, L, msg, now) {
  const c = msg.contact;
  if (!c || c.user_id !== msg.from.id) return api("sendMessage", { chat_id: chat, text: L.phoneOnlyOwn });
  const phone = "+" + String(c.phone_number || "").replace(/\D/g, "").slice(0, 15);
  const tg = String(msg.from.id);
  const link = await db().get("telegram/" + tg);
  const updates = { ["telegram/" + tg + "/phone"]: phone, ["leads/" + tg + "/phone"]: phone };
  if (link && link.uid && (await db().get("users/" + key(link.uid)))) updates[`users/${key(link.uid)}/phone`] = phone;
  await db().update("", updates);
  return api("sendMessage", { chat_id: chat, text: L.phoneSaved, reply_markup: { remove_keyboard: true } });
}

/** Handles one webhook update. */
export async function handleUpdate(u, now = Date.now()) {
  if (u.callback_query) {
    const cq = u.callback_query, L = T[langOf(cq.from)], chat = cq.message && cq.message.chat && cq.message.chat.id;
    await api("answerCallbackQuery", { callback_query_id: cq.id });
    if (!chat) return "no-chat";
    if (cq.data === "login") { await sendLogin(chat, L, cq.from, now); return "login"; }
    if (cq.data === "prices") { await api("sendMessage", { chat_id: chat, text: L.prices(), parse_mode: "HTML", reply_markup: { inline_keyboard: [[urlBtn(L.btnStart, appUrl() + "/app/pricing?src=tg")]] } }); return "prices"; }
    return "ignored";
  }
  const msg = u.message;
  if (!msg || !msg.from || !msg.chat || msg.chat.type !== "private") return "ignored";
  const chat = msg.chat.id, L = T[langOf(msg.from)];
  if (msg.contact) { await savePhone(chat, L, msg, now); return "phone"; }
  const text = String(msg.text || "").trim();
  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
  if (start) {
    const payload = start[1] || "";
    const v = /^v(\d{1,2})$/.exec(payload);
    if (v) { await sendLesson(chat, L, Number(v[1]), msg.from, now); return "lesson"; }
    if (payload === "login") { await sendLogin(chat, L, msg.from, now); return "login"; }
    if (payload.startsWith("link_")) { await linkAccount(chat, L, msg.from, payload.slice(5), now); return "link"; }
    const src = /^[a-z0-9_-]{1,30}$/i.test(payload) ? payload.toLowerCase() : "start";
    await rememberLead(msg.from, src, now);
    await api("sendMessage", { chat_id: chat, text: L.welcome(msg.from.first_name), parse_mode: "HTML", reply_markup: menu(L, src) });
    return "welcome";
  }
  if (/^\/login\b|^kirish$|^войти$/i.test(text)) { await sendLogin(chat, L, msg.from, now); return "login"; }
  if (/^\/(narx|price|prices|цены)\b/i.test(text)) { await api("sendMessage", { chat_id: chat, text: L.prices(), parse_mode: "HTML" }); return "prices"; }
  if (/^truck$/i.test(text) || /^трак$/i.test(text)) {
    await rememberLead(msg.from, "dm-truck", now);
    await api("sendMessage", { chat_id: chat, text: L.welcome(msg.from.first_name), parse_mode: "HTML", reply_markup: menu(L, "dm-truck") });
    return "welcome";
  }
  const num = /^(\d{1,2})(?:\s*-?\s*(?:dars|урок))?$/i.exec(text);
  if (num) { await sendLesson(chat, L, Number(num[1]), msg.from, now); return "lesson"; }
  await api("sendMessage", { chat_id: chat, text: L.help, parse_mode: "HTML", reply_markup: menu(L, null) });
  return "help";
}

export const _texts = T;
