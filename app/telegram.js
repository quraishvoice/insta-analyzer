// إشعارات على الجوال عن طريق بوت تيليجرام (مجاني). التوكن يتحفظ على جهازك بس
import { randomInt } from "node:crypto";
import { db } from "./db.js";
import { L } from "./i18n.js";
import { getSetting, setSetting } from "./access.js";

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;
let pairing = null; // { code, until, offset, timer }
const keyboard = (rows) => ({ inline_keyboard: (rows || []).map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))) });

async function tg(method, params = {}, token = getSetting("telegram_token")) {
  if (!token) throw new Error(L("ما فيه بوت مربوط", "No bot is connected"));
  const res = await fetch(API(token, method), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(body.error_code === 401 ? L("توكن البوت غلط", "The bot token is wrong") : body.description || L("تيليجرام رفض الطلب", "Telegram rejected the request"));
  return body.result;
}

export function telegramStatus() {
  const token = getSetting("telegram_token");
  return {
    connected: !!(token && getSetting("telegram_chat")),
    bot: getSetting("telegram_bot") || null,
    chat_name: getSetting("telegram_chat_name") || null,
    link: pairing && token ? `https://t.me/${getSetting("telegram_bot")}?start=${pairing.code}` : null,
  };
}

// الخطوة ١: تلصق توكن البوت، نتأكد منه، ونبدأ ننتظر «Start» من جوالك
export async function connectTelegram(token) {
  token = String(token || "").trim();
  if (!/^\d+:[\w-]{30,}$/.test(token)) throw new Error(L("هذا مو شكل توكن بوت. انسخه كامل من BotFather (أرقام ثم : ثم حروف).", "That doesn't look like a bot token. Copy the whole thing from BotFather (digits, then :, then letters)."));
  const me = await tg("getMe", {}, token);
  setSetting("telegram_token", token);
  setSetting("telegram_bot", me.username);
  db.prepare("DELETE FROM settings WHERE key IN ('telegram_chat', 'telegram_chat_name', 'telegram_offset')").run();
  startPairing();
  return telegramStatus();
}

// نسمع لرسالة «/start الرمز» لمدة ٣٠ دقيقة، ونربط المحادثة اللي ترسلها بس
function startPairing() {
  if (pairing?.timer) clearInterval(pairing.timer);
  pairing = { code: String(randomInt(100000, 1000000)), until: Date.now() + 30 * 60000, offset: 0 };
  pairing.timer = setInterval(async () => {
    if (Date.now() > pairing.until) return stopPairing();
    try {
      const updates = await tg("getUpdates", { offset: pairing.offset, timeout: 0, allowed_updates: ["message"] });
      for (const u of updates) {
        pairing.offset = u.update_id + 1;
        const m = u.message;
        if (m?.chat?.type === "private" && m.text?.trim() === `/start ${pairing.code}`) {
          setSetting("telegram_chat", String(m.chat.id));
          setSetting("telegram_chat_name", [m.chat.first_name, m.chat.last_name].filter(Boolean).join(" ") || m.chat.username || "");
          stopPairing();
          await tg("sendMessage", { chat_id: m.chat.id, text: "✅ تم الربط. بتوصلك هنا تنبيهات محلل انستجرام: البوستات القوية والضعيفة، أسئلة السعر، والتقرير الأسبوعي." });
          return;
        }
      }
    } catch (e) { console.error("ربط تيليجرام:", e.message); }
  }, 3000);
}

function stopPairing() {
  if (pairing?.timer) clearInterval(pairing.timer);
  pairing = null;
}

export function disconnectTelegram() {
  stopPairing();
  db.prepare("DELETE FROM settings WHERE key LIKE 'telegram_%'").run();
  return telegramStatus();
}

// يسمع للرسائل اللي ترسلها أنت للبوت (من محادثتك المربوطة بس) ويمررها لـ onText
// onText يرجع نص الرد (أو null). أول مرة نتجاهل الرسائل القديمة
// ضغطات الأزرار تروح لـ onButton(data) وترجع { toast, text, buttons } عشان نعدّل الرسالة
// menu: صفوف الأزرار الثابتة تحت خانة الكتابة (تنرسل مع كل رد، ومرة وحدة أول ما تتغير)
export function listenTelegram(onText, every = 15000, onButton = null, menu = null) {
  const replyMenu = menu ? { keyboard: menu.map((row) => row.map((text) => ({ text }))), resize_keyboard: true, is_persistent: true, input_field_placeholder: "اكتب فكرة أو اضغط زر" } : null;
  const menuVersion = menu ? JSON.stringify(menu) : null;
  let busy = false;
  setInterval(async () => {
    const chat = getSetting("telegram_chat");
    if (busy || pairing || !chat || !getSetting("telegram_token")) return;
    busy = true;
    try {
      let offset = +getSetting("telegram_offset") || 0;
      if (!offset) {
        const last = await tg("getUpdates", { offset: -1, timeout: 0 });
        setSetting("telegram_offset", String(last.length ? last[0].update_id + 1 : 1));
        return;
      }
      if (replyMenu && getSetting("telegram_menu") !== menuVersion) {
        // لو فشل إرسال الأزرار ما يوقف استقبال الرسائل
        try {
          await tg("sendMessage", { chat_id: chat, text: "⌨️ صارت عندك أزرار تحت خانة الكتابة: اضغط أي زر ويرد عليك البوت بأرقامك. وأي شي تكتبه بنفسك ينحفظ فكرة.", reply_markup: replyMenu });
          setSetting("telegram_menu", menuVersion);
        } catch (e) { console.error("أزرار تيليجرام:", e.message); }
      }
      const updates = await tg("getUpdates", { offset, timeout: 0, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        setSetting("telegram_offset", String(offset));
        if (u.callback_query) { await handleButton(u.callback_query, chat, onButton); continue; }
        const m = u.message;
        console.log(`تيليجرام: رسالة ${u.update_id} ${!m ? "(مو رسالة)" : String(m.chat?.id) !== chat ? "(من محادثة ثانية، تجاهلناها)" : m.text ? "(نص)" : m.caption ? "(صورة مع كلام)" : "(بدون نص)"}`);
        if (!m || String(m.chat?.id) !== chat) continue;
        const text = m.text || m.caption;
        let reply;
        try { reply = text ? await onText(text) : "أرسل الفكرة كتابة عشان تنحفظ 🙏"; } catch (e) { reply = "ما انحفظت: " + e.message; }
        if (reply && reply.length > 4000) reply = reply.slice(0, 3990) + "\n…";
        if (reply) await tg("sendMessage", { chat_id: chat, text: reply, reply_to_message_id: m.message_id, disable_web_page_preview: true, ...(replyMenu ? { reply_markup: replyMenu } : {}) });
      }
    } catch (e) { console.error("رسائل تيليجرام:", e.message); }
    finally { busy = false; }
  }, every);
}

async function handleButton(q, chat, onButton) {
  const msg = q.message;
  console.log(`تيليجرام: زر ${String(msg?.chat?.id) === chat ? "(من محادثتك)" : "(من محادثة ثانية، تجاهلناه)"}`);
  if (String(msg?.chat?.id) !== chat || !onButton) return tg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
  let r;
  try { r = await onButton(q.data); } catch (e) { r = { toast: "ما صار: " + e.message }; }
  await tg("answerCallbackQuery", { callback_query_id: q.id, text: r?.toast || "" }).catch(() => {});
  if (r?.text) await tg("editMessageText", { chat_id: chat, message_id: msg.message_id, text: r.text, disable_web_page_preview: true, ...(r.html ? { parse_mode: "HTML" } : {}), reply_markup: keyboard(r.buttons) })
    .catch((e) => console.error("تعديل رسالة تيليجرام:", e.message));
}

// يرسل التنبيه للجوال إذا البوت مربوط (وما يوقف شي لو فشل). buttons: صفوف أزرار [{ text, data } أو { text, url }]
export async function sendTelegram(title, body, buttons = null, html = false) {
  const chat = getSetting("telegram_chat");
  if (!chat || !getSetting("telegram_token")) return false;
  try {
    await tg("sendMessage", { chat_id: chat, text: title ? `${title}\n\n${body}` : body, disable_web_page_preview: true, ...(html ? { parse_mode: "HTML" } : {}),
      ...(buttons ? { reply_markup: keyboard(buttons) } : {}) });
    return true;
  } catch (e) {
    console.error("إرسال تيليجرام فشل:", e.message);
    return false;
  }
}
