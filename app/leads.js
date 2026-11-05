// متابعة العملاء المحتملين: كل تعليق يسأل عن السعر أو التسجيل يمر بمراحل
// جديد ← رديت ← (يحتاج متابعة) ← سجّل / ما سجّل
import { getSetting } from "./access.js";
import { db } from "./db.js";
import { save as saveAlert } from "./alerts.js";
import { L } from "./i18n.js";

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
export const FIRST_FOLLOWUP = 3;  // أيام بعد الرد وما سجّل → ذكّرني أتابعه
export const SECOND_FOLLOWUP = 7; // أيام بعد أول متابعة → ذكّرني مرة ثانية
export const MAX_AGE = 30;        // بعد ٣٠ يوم من التعليق ما نذكّرك فيه
const DAY = 86400;

// أعمدة المتابعة (انضافت بعدين). أول مرة: وقت الرد القديم = وقت التعليق نفسه
const cols = ["replied_at INTEGER", "followed_at INTEGER", "outcome TEXT", "outcome_at INTEGER", "sale_id INTEGER"];
let added = false;
for (const c of cols) {
  try { db.exec(`ALTER TABLE comments ADD COLUMN ${c}`); added = true; } catch {}
}
if (added) db.exec("UPDATE comments SET replied_at = CAST(strftime('%s', substr(timestamp, 1, 19)) AS INTEGER) WHERE replied_at IS NULL AND (replied = 1 OR handled = 1)");

const now = () => Math.floor(Date.now() / 1000);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const isLead = (c) => c.intent === "سعر" || c.intent === "تسجيل";

// المرحلة الحالية للعميل
export function stage(c, t = now()) {
  if (!isLead(c)) return null;
  if (c.outcome === "سجّل") return "سجّل";
  if (c.outcome === "ما سجّل") return "ما سجّل";
  if (!c.replied && !c.handled) return "جديد";
  const age = t - Date.parse(c.timestamp) / 1000;
  const since = c.followed_at || c.replied_at;
  if (age <= MAX_AGE * DAY && since && t - since >= (c.followed_at ? SECOND_FOLLOWUP : FIRST_FOLLOWUP) * DAY) return "يحتاج متابعة";
  return "رديت";
}

// اللي يحتاجون متابعة الحين (من آخر ٣٠ يوم، بغض النظر عن الفترة المختارة)
export function dueLeads(accountId) {
  const t = now();
  return db.prepare(`SELECT c.*, m.caption, m.permalink FROM comments c LEFT JOIN media m ON m.id = c.media_id
    WHERE c.account_id = ? AND c.intent IN ('سعر', 'تسجيل') AND c.outcome IS NULL AND (c.replied = 1 OR c.handled = 1) AND c.timestamp >= ?
    ORDER BY c.timestamp DESC`).all(accountId, new Date((t - MAX_AGE * DAY) * 1000).toISOString().slice(0, 19))
    .filter((c) => stage(c, t) === "يحتاج متابعة");
}

// أرقام المراحل للعملاء اللي علّقوا خلال الفترة
export function pipelineKpis(list) {
  const leads = list.filter(isLead);
  const by = { "جديد": 0, "رديت": 0, "يحتاج متابعة": 0, "سجّل": 0, "ما سجّل": 0 };
  for (const c of leads) by[stage(c)]++;
  const won = leads.filter((c) => c.outcome === "سجّل");
  const days = won.map((c) => (c.outcome_at - Date.parse(c.timestamp) / 1000) / DAY).filter((d) => d >= 0).sort((a, b) => a - b);
  const decided = by["سجّل"] + by["ما سجّل"];
  return {
    leads: leads.length, stages: by,
    conversion: leads.length ? by["سجّل"] / leads.length : null,
    // نسبة اللي سجّلوا من اللي عرفت نتيجتهم (أدق إذا ما حدّثت الكل)
    close_rate: decided ? by["سجّل"] / decided : null,
    median_days: days.length ? (days.length % 2 ? days[days.length >> 1] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) : null,
  };
}

export function markFollowed(id, on = true) {
  db.prepare("UPDATE comments SET followed_at = ? WHERE id = ?").run(on ? now() : null, id);
  return { ok: true };
}

// سجّل / ما سجّل / تراجع. «سجّل» يضيف تسجيل في المبيعات مربوط بالبوست (إذا تبي)
export function setOutcome(id, { outcome, add_sale = true, amount = null }) {
  const c = db.prepare("SELECT * FROM comments WHERE id = ?").get(id);
  if (!c) throw new Error(L("التعليق مو موجود", "Comment not found"));
  if (outcome && !["سجّل", "ما سجّل"].includes(outcome)) throw new Error(L("حالة غير معروفة", "Unknown status"));
  if (c.sale_id) db.prepare("DELETE FROM sales WHERE id = ?").run(c.sale_id);
  let saleId = null;
  if (outcome === "سجّل" && add_sale) {
    const amt = amount === "" || amount == null ? null : +amount;
    saleId = db.prepare("INSERT INTO sales (account_id, date, count, amount, source, media_id, note, created_at) VALUES (?, ?, 1, ?, 'تعليق', ?, ?, ?)")
      .run(c.account_id, today(), Number.isFinite(amt) ? amt : null, c.media_id, `@${c.username || ""} من التعليقات`, now()).lastInsertRowid;
  }
  db.prepare("UPDATE comments SET outcome = ?, outcome_at = ?, sale_id = ? WHERE id = ?").run(outcome || null, outcome ? now() : null, saleId, id);
  return { ok: true };
}

// تذكير يومي الساعة ١٠ الصبح إذا فيه عملاء يحتاجون متابعة (على الماك وتيليجرام)
// يرجع الحسابات اللي انرسل لها تذكير الحين، عشان تنرسل بطاقة لكل عميل بأزرارها في تيليجرام
export function followupReminder(accountIds) {
  const hour = +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date());
  const sent = [];
  if (hour < 10) return sent;
  for (const id of accountIds) {
    const due = dueLeads(id);
    if (!due.length) continue;
    const names = due.slice(0, 3).map((c) => "@" + c.username).join("، ") + (due.length > 3 ? " وغيرهم" : "");
    const who = due.length === 1 ? "عميل واحد" : due.length === 2 ? "عميلين" : `${due.length} ${due.length <= 10 ? "عملاء" : "عميل"}`;
    saveAlert(id, null, `followup:${today()}`, `👋 ${who} يحتاج${due.length > 1 ? "ون" : ""} متابعة`,
      `رديت عليهم وما سجّلوا للحين: ${names}. راسلهم بالخاص، وعلّم النتيجة في اللوحة أو من الأزرار في تيليجرام.`);
    // بطاقات تيليجرام تنحسب «انرسلت» بس لما يوصل الإرسال فعلاً (لو فشل نعيد بعد ١٠ دقايق)
    if (getSetting(`lead_cards:${id}`) !== today()) sent.push({ id, due, day: today() });
  }
  return sent;
}
