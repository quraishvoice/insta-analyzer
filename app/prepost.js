// تذكير قبل وقت النشر بنص ساعة: وش تنشر اليوم حسب الخطة، والفكرة، والهاشتاقات، والدعوة (الماك وتيليجرام)
// الخطة تبدأ من بكرة وتتغير كل يوم، فنحفظ آخر نسخة شفتها لكل يوم، ويوم النشر نذكّرك بآخر نسخة قبله
import { db } from "./db.js";
import { plan } from "./planner.js";
import { save as saveAlert } from "./alerts.js";

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
export const BEFORE_MIN = 30;

db.exec(`CREATE TABLE IF NOT EXISTS plan_days (account_id TEXT, date TEXT, data TEXT, PRIMARY KEY (account_id, date))`);

const parts = () => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  .formatToParts(new Date()).map((p) => [p.type, p.value]));
const localDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const hourName = (h) => (h === 0 ? "١٢ بالليل" : h < 12 ? `${h} الصبح` : h === 12 ? "١٢ الظهر" : `${h - 12} ${h < 15 ? "الظهر" : h < 18 ? "العصر" : h < 20 ? "المغرب" : "الليل"}`);

// نحدّث نسخة الخطة المحفوظة مرة بالساعة (الخطة تحسب ٩٠ يوم فما نبيها كل ٥ دقايق)
const refreshed = new Map();
function refreshPlan(accountId) {
  if (Date.now() - (refreshed.get(accountId) || 0) < 3600e3) return;
  refreshed.set(accountId, Date.now());
  const p = plan(accountId);
  if (!p.ready) return;
  const put = db.prepare("INSERT INTO plan_days (account_id, date, data) VALUES (?, ?, ?) ON CONFLICT (account_id, date) DO UPDATE SET data = excluded.data");
  for (const d of p.days) put.run(accountId, d.date, JSON.stringify(d));
}

export function prepostText(d, minsLeft = BEFORE_MIN) {
  const h = +d.time.slice(0, 2);
  const title = minsLeft > 0 ? `⏰ بعد ${minsLeft >= 25 ? "نص ساعة" : `${minsLeft} دقيقة`} موعد بوستك (الساعة ${hourName(h)})` : `⏰ حان وقت بوستك (الساعة ${hourName(h)})`;
  const body = [
    `${d.kind_name}، والهدف ${d.goal}${d.goal_note ? `: ${d.goal_note}` : ""}.`,
    d.topic ? `الموضوع: ${d.topic}` : null,
    d.bank_idea ? `💡 من بنك أفكارك: ${d.bank_idea.text}` : d.hook ? `💡 الفكرة: ${d.hook}${d.idea_note ? ` (${d.idea_note})` : ""}` : null,
    !d.bank_idea && d.idea_link ? d.idea_link : null,
    d.reel_tip ? `⏱ ${d.reel_tip}: الريلز اللي بهالشكل الناس يكملونها أكثر.` : null,
    d.hashtags?.length ? `الهاشتاقات: ${d.hashtags.join(" ")}` : null,
    d.cta ? `الدعوة في الآخر: ${d.cta.replace(/^اختم بـ:\s*/, "")}` : "اختم بسؤال أو «احفظه لا يفوتك» عشان يزيد التفاعل.",
    "أول سطر في الكابشن جملة تشد، مو هاشتاقات.",
  ].filter(Boolean).join("\n");
  return { title, body };
}

// يشتغل كل ٥ دقايق: إذا اليوم فيه بوست في الخطة وباقي على وقته نص ساعة أو أقل، ولسا ما نزّلت شي اليوم
export function prepostReminders(accountIds) {
  const t = parts(), today = `${t.year}-${t.month}-${t.day}`, nowMin = +t.hour * 60 + +t.minute;
  for (const id of accountIds) {
    try { refreshPlan(id); } catch (e) { console.error("تذكير النشر (الخطة):", e.message); }
    const row = db.prepare("SELECT data FROM plan_days WHERE account_id = ? AND date = ?").get(id, today);
    if (!row) continue;
    const d = JSON.parse(row.data);
    if (d.rest || !d.time) continue;
    const at = +d.time.slice(0, 2) * 60 + +d.time.slice(3, 5);
    // من نص ساعة قبل الوقت لين ساعة بعده (لو الماك كان طافي وقت التذكير)
    if (nowMin < at - BEFORE_MIN || nowMin > at + 60) continue;
    const recent = db.prepare("SELECT timestamp FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial ORDER BY timestamp DESC LIMIT 3").all(id);
    if (recent.some((p) => localDate(p.timestamp) === today)) continue;
    const { title, body } = prepostText(d, at - nowMin);
    saveAlert(id, null, `prepost:${today}`, title, body);
  }
}
