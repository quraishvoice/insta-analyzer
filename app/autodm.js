// رسالة خاص تلقائية: لما أحد يسأل عن السعر أو التسجيل بالتعليقات (أو يكتب كلمتك من ملف مجالك)، ترسل له الأداة
// «أول رسالة بالخاص» وترد تحت تعليقه إنك أرسلت. انستجرام يسمح بهذا رسمياً (Private Replies):
// رسالة وحدة لكل تعليق، وخلال ٧ أيام منه. المتابعة بعدها تكون منك في المحادثة
import { db } from "./db.js";
import { ig } from "./instagram.js";
import { normalize } from "./intent.js";
import { getDm } from "./dm.js";
import { save as saveAlert } from "./alerts.js";
import { L } from "./i18n.js";
import { P } from "./profile.js";

db.exec(`CREATE TABLE IF NOT EXISTS autodm (
  account_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 0, enabled_at TEXT,
  keywords TEXT, reply TEXT, public_reply INTEGER DEFAULT 1)`);
for (const c of ["dm_at INTEGER", "dm_status TEXT", "dm_error TEXT"]) {
  try { db.exec(`ALTER TABLE comments ADD COLUMN ${c}`); } catch {}
}

const DAY = 86400;
const HOURLY = 20;  // حد أعلى بالساعة، عشان لو انفجر بوست ما يشوف انستجرام الحساب كأنه سبام
const WINDOW = 6.5; // انستجرام يقبل الرد الخاص خلال ٧ أيام من التعليق
const SAME_USER = 7; // نفس الشخص ما ينرسل له مرة ثانية خلال أسبوع حتى لو علّق على بوست ثاني
const DEFAULT_KEYWORDS = P.cta_word || ""; // كلمتك من ملف مجالك
const DEFAULT_REPLY = "أرسلت لك التفاصيل بالخاص 🙏\nشيّك على رسايلك يا {user} 📩\nوصلتك التفاصيل بالخاص ✓";
// كلمات تنكتب مع الكلمة وما تغيّر المعنى: «صوت لو سمحت» = «صوت»
const FILLER = new Set(["لو", "سمحت", "ابي", "ابغي", "ودي", "من", "فضلك", "الله", "يعطيك", "العافيه", "و", "plz", "pls", "please"]);

const now = () => Math.floor(Date.now() / 1000);
const igTime = (ms) => new Date(ms).toISOString().slice(0, 19) + "+0000"; // نفس شكل وقت التعليق من انستجرام
const INFO = /\{(العرض|الموعد|السعر|الرابط)\}/g;

function settings(accountId) {
  const s = db.prepare("SELECT * FROM autodm WHERE account_id = ?").get(accountId) || {};
  return {
    enabled: !!s.enabled, enabled_at: s.enabled_at || null,
    keywords: s.keywords ?? DEFAULT_KEYWORDS, reply: s.reply ?? DEFAULT_REPLY,
    public_reply: s.public_reply == null ? true : !!s.public_reply,
  };
}

const split = (list) => String(list || "").split(/[,،\n]+/).map((w) => w.trim()).filter(Boolean);
const words = (list) => split(list).map((w) => normalize(w).trim());

// التعليق كله هو كلمتك (مع إيموجي أو «لو سمحت»)، مو بس فيه الكلمة: لو كلمتك «صوت»، «صوتك حلو» ما ينحسب
export function keywordTest(accountId) {
  const kw = new Set(words(settings(accountId).keywords));
  if (!kw.size) return () => false;
  return (text) => {
    const tokens = normalize(text).replace(/@\S+/g, " ").split(/[^\p{L}]+/u).filter((t) => t && !FILLER.has(t));
    return tokens.length > 0 && tokens.every((t) => kw.has(t) || kw.has(t.replace(/^ال/, "")));
  };
}

// معلومات العرض الناقصة في «أول رسالة بالخاص» (ما نرسل رسالة فيها [السعر])
// ونص بين [ ] نسيته في القالب (مثل «[سطر عن العرض]»)
function missingInfo(D) {
  const miss = [...new Set([...D.templates.first.matchAll(INFO)].map((m) => m[1]).filter((k) => !D.info[k]))];
  if (/\[[^\]\n]{2,}\]/.test(D.templates.first.replace(INFO, ""))) miss.push(L("النص اللي بين [ ] في الرسالة", "the text in [ ] in the message"));
  return miss;
}
const fill = (text, user, info) => text.replaceAll("{user}", user || "").replace(INFO, (_, k) => info[k] || "");

export function getAutoDm(accountId) {
  const s = settings(accountId), D = getDm(accountId);
  const week = igTime(Date.now() - 7 * DAY * 1000);
  const log = db.prepare(`SELECT id, username, text, dm_at, dm_status, dm_error FROM comments
    WHERE account_id = ? AND dm_status IS NOT NULL ORDER BY dm_at DESC LIMIT 15`).all(accountId);
  // لو كانت شغالة آخر ٧ أيام: كم شخص كان بيوصله
  const would = db.prepare(`SELECT DISTINCT username FROM comments WHERE account_id = ? AND intent IN ('سعر', 'تسجيل') AND timestamp >= ? AND username IS NOT NULL`)
    .all(accountId, week).map((r) => r.username);
  const count = (st) => db.prepare("SELECT COUNT(*) n FROM comments WHERE account_id = ? AND dm_status = ? AND dm_at >= ?").get(accountId, st, now() - 7 * DAY).n;
  return {
    ...s, missing: missingInfo(D), message: D.templates.first,
    sent_7d: count("sent"), failed_7d: count("failed"), would_7d: would.length, would_users: would.slice(0, 5), log,
  };
}

export function saveAutoDm(accountId, body) {
  const s = settings(accountId);
  const keywords = typeof body.keywords === "string" ? split(body.keywords).slice(0, 10).map((w) => w.slice(0, 30)).join("، ") : s.keywords;
  const reply = typeof body.reply === "string"
    ? body.reply.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 5).map((x) => x.slice(0, 300)).join("\n") || DEFAULT_REPLY
    : s.reply;
  const publicReply = body.public_reply == null ? s.public_reply : !!body.public_reply;
  const enabled = body.enabled == null ? s.enabled : !!body.enabled;
  if (enabled && !s.enabled) {
    const miss = missingInfo(getDm(accountId));
    if (miss.length) {
      const err = new Error(L(`عبّ ${miss.join(" و")} في «رسائل الخاص ✎» أول، عشان ما توصل رسالة ناقصة.`, `Fill in ${miss.join(", ")} in “DM templates ✎” first, so no one gets an incomplete message.`));
      err.status = 400;
      throw err;
    }
  }
  // التشغيل يبدأ من الحين: التعليقات القديمة ما ينرسل لها شي
  const enabledAt = enabled ? (s.enabled ? s.enabled_at : igTime(Date.now())) : null;
  db.prepare(`INSERT INTO autodm (account_id, enabled, enabled_at, keywords, reply, public_reply) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (account_id) DO UPDATE SET enabled = excluded.enabled, enabled_at = excluded.enabled_at, keywords = excluded.keywords, reply = excluded.reply, public_reply = excluded.public_reply`)
    .run(accountId, enabled ? 1 : 0, enabledAt, keywords, reply, publicReply ? 1 : 0);
  // الكلمات تغيّرت: نعيد فرز التعليقات عشان اللي كتب كلمتك يصير عميل محتمل بدون ما ننتظر المزامنة
  const hit = keywordTest(accountId);
  for (const c of db.prepare("SELECT id, text, intent FROM comments WHERE account_id = ? AND timestamp >= ? AND (intent IS NULL OR intent = 'تسجيل')").all(accountId, igTime(Date.now() - 60 * DAY * 1000))) {
    if (!c.intent && hit(c.text)) db.prepare("UPDATE comments SET intent = 'تسجيل' WHERE id = ?").run(c.id);
  }
  return getAutoDm(accountId);
}

const mark = (id, status, error = null) =>
  db.prepare("UPDATE comments SET dm_status = ?, dm_error = ?, dm_at = ? WHERE id = ?").run(status, error, now(), id);

// يشتغل بعد سحب التعليقات (كل دقيقتين). يرجع اللي انرسل لهم عشان التنبيه
export async function runAutoDm(acc, token) {
  const s = settings(acc.id);
  if (!s.enabled || acc.is_demo) return [];
  const D = getDm(acc.id);
  if (missingInfo(D).length) return [];
  const window = igTime(Date.now() - WINDOW * DAY * 1000);
  const since = s.enabled_at > window ? s.enabled_at : window;
  const list = db.prepare(`SELECT * FROM comments WHERE account_id = ? AND intent IN ('سعر', 'تسجيل') AND dm_status IS NULL
    AND NOT replied AND NOT COALESCE(handled, 0) AND outcome IS NULL AND username IS NOT NULL AND timestamp >= ? ORDER BY timestamp`).all(acc.id, since);
  if (!list.length) return [];

  let budget = HOURLY - db.prepare("SELECT COUNT(*) n FROM comments WHERE account_id = ? AND dm_status = 'sent' AND dm_at >= ?").get(acc.id, now() - 3600).n;
  const lines = s.reply.split("\n").filter(Boolean);
  const sent = [], failed = [];
  for (const c of list) {
    if (budget <= 0) break;
    if (db.prepare("SELECT 1 FROM comments WHERE account_id = ? AND username = ? AND dm_status = 'sent' AND dm_at >= ?").get(acc.id, c.username, now() - SAME_USER * DAY)) {
      mark(c.id, "skipped", L("انرسل له قبل أقل من أسبوع", "Already messaged this week"));
      continue;
    }
    try {
      await ig("/me/messages", {
        recipient: JSON.stringify({ comment_id: c.id }),
        message: JSON.stringify({ text: fill(D.templates.first, c.username, D.info).slice(0, 1000) }),
      }, token, "POST");
    } catch (e) {
      if (e.code === 190) throw e;
      if ([4, 17, 32, 613].includes(e.code)) break; // حد الطلبات: نكمل المرة الجاية
      // ما فيه صلاحية الرسائل (أو التطبيق ما يسمح): نطفيها وننبهك بدل ما نفشل مع كل تعليق
      if ([3, 10, 200].includes(e.code)) {
        db.prepare("UPDATE autodm SET enabled = 0 WHERE account_id = ?").run(acc.id);
        saveAlert(acc.id, null, `autodm-off:${now()}`, "⚠️ وقفت رسائل الخاص التلقائية",
          `انستجرام رفض الإرسال: ${String(e.message).replace(/[.\s]+$/, "")}. شغّلها من جديد من قسم العملاء بعد ما تحل المشكلة.`);
        break;
      }
      const error = String(e.message).slice(0, 200);
      mark(c.id, "failed", error);
      failed.push({ ...c, dm_error: error });
      continue;
    }
    budget--;
    mark(c.id, "sent");
    db.prepare("UPDATE comments SET handled = 1, replied_at = COALESCE(replied_at, ?) WHERE id = ?").run(now(), c.id);
    sent.push(c);
    if (s.public_reply && lines.length) {
      const text = lines[Math.floor(Math.random() * lines.length)].replaceAll("{user}", c.username);
      try {
        await ig(`/${c.id}/replies`, { message: text }, token, "POST");
        db.prepare("UPDATE comments SET replied = 1 WHERE id = ?").run(c.id);
      } catch (e) { console.error("رد التعليق بعد الرسالة التلقائية:", e.message); }
    }
  }
  if (failed.length) {
    saveAlert(acc.id, failed[0].media_id, `autodm-fail:${failed[0].id}`, "⚠️ رسالة خاص تلقائية ما وصلت",
      `${failed.map((c) => "@" + c.username).join("، ")}: ${(failed[0].dm_error || "انستجرام رفض الإرسال").replace(/[.\s]+$/, "")}. راسلهم بنفسك من قسم العملاء.`);
  }
  return sent;
}
