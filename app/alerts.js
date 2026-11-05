// تنبيهات وقت النشر: تقارن أول ساعات البوست الجديد بعادتك، وتنبهك على أسئلة السعر الجديدة — إشعار على الماك
import { execFile } from "node:child_process";
import { db } from "./db.js";
import { sendTelegram } from "./telegram.js";

const KIND_NAMES = { REELS: "الريل", CAROUSEL_ALBUM: "الكاروسيل", IMAGE: "البوست", VIDEO: "الفيديو" };
const kindOf = (p) => (p.product_type === "REELS" ? "REELS" : p.media_type);
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const n = (x) => Math.round(x).toLocaleString("en-US");
const firstLine = (c) => (c || "").split("\n")[0].slice(0, 40);

// إشعار macOS (يطلع مثل إشعارات الرسائل) وعلى تيليجرام إذا مربوط. NOTIFY=0 في ملف .env يطفي إشعار الماك
export function notify(title, body) {
  sendTelegram(title, body);
  if (process.env.NOTIFY === "0" || process.platform !== "darwin") return;
  const q = (s) => JSON.stringify(String(s).replace(/\s+/g, " "));
  execFile("osascript", ["-e", `display notification ${q(body)} with title ${q(title)} sound name "Glass"`], () => {});
}

export function save(accountId, mediaId, kind, title, body, link = null) {
  const r = db.prepare("INSERT OR IGNORE INTO alerts (account_id, media_id, kind, title, body, created_at, link) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(accountId, mediaId, kind, title, body, Math.floor(Date.now() / 1000), link);
  if (r.changes) notify(title, body);
  return r.changes > 0;
}

// كم يكون وصول البوست عادةً بعد نفس عدد الدقائق؟
function baseline(accountId, post, ageMin) {
  const others = db.prepare(`SELECT * FROM media WHERE account_id = ? AND id != ? AND product_type != 'STORY' AND NOT trial AND timestamp < ?
    ORDER BY timestamp DESC LIMIT 40`).all(accountId, post.id, post.timestamp).filter((p) => kindOf(p) === kindOf(post)).slice(0, 10);

  // الأدق: لقطات محفوظة لبوستاتك السابقة عند نفس العمر (±٣٠ دقيقة)
  const near = db.prepare("SELECT reach FROM snapshots WHERE media_id = ? AND age_min BETWEEN ? AND ? ORDER BY abs(age_min - ?) LIMIT 1");
  const exact = others.map((p) => near.get(p.id, ageMin - 30, ageMin + 30, ageMin)?.reach).filter((x) => x != null);
  if (exact.length >= 3) return { reach: median(exact), exact: true, count: exact.length };

  // لين تتجمع لقطات: تقدير من الوصول النهائي (البوست يجيب تقريباً ربع وصوله بأول ساعتين)
  const finals = others.filter((p) => p.reach != null && Date.now() - Date.parse(p.timestamp) > 7 * 864e5).map((p) => p.reach);
  if (finals.length < 3) return null;
  return { reach: median(finals) * Math.min(0.5, 0.25 * (ageMin / 120)), exact: false, count: finals.length };
}

// يشتغل بعد كل تحديث خفيف: البوستات اللي عمرها بين ساعة و٥ ساعات
export function checkPostAlerts(accountId) {
  const acc = db.prepare("SELECT is_demo FROM accounts WHERE id = ?").get(accountId);
  if (!acc || acc.is_demo) return;
  const since = new Date(Date.now() - 300 * 60000).toISOString().slice(0, 19);
  for (const post of db.prepare("SELECT * FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial AND timestamp >= ?").all(accountId, since)) {
    if (db.prepare("SELECT 1 FROM alerts WHERE account_id = ? AND kind = ?").get(accountId, `perf:${post.id}`)) continue;
    const snap = db.prepare("SELECT * FROM snapshots WHERE media_id = ? ORDER BY age_min DESC LIMIT 1").get(post.id);
    if (!snap || snap.age_min < 60) continue;
    const base = baseline(accountId, post, snap.age_min);
    if (!base || !base.reach) continue;

    const ratio = snap.reach / base.reach;
    // التقدير التقريبي يحتاج فرق أكبر قبل ما ننبه
    const strong = base.exact ? 1.5 : 2, weak = base.exact ? 0.5 : 0.35;
    const what = KIND_NAMES[kindOf(post)] || "البوست";
    const hrs = snap.age_min < 90 ? "أول ساعة" : `أول ${Math.round(snap.age_min / 60)} ساعات`.replace("أول 2 ساعات", "أول ساعتين");
    const cap = firstLine(post.caption);
    const how = base.exact ? "" : " (تقدير)";

    if (ratio >= strong) {
      save(accountId, post.id, `perf:${post.id}`, `🔥 ${what} الجديد ماشي أقوى من عادتك`,
        `${cap ? `«${cap}» ` : ""}وصل لـ ${n(snap.reach)} في ${hrs}، ${ratio >= 3 ? `يعني ${Math.round(ratio)} أضعاف عادتك` : `أعلى من عادتك بـ ${Math.round((ratio - 1) * 100)}٪`}${how}. ادعمه الحين بستوري فيها رابط التسجيل.`);
    } else if (ratio <= weak && snap.age_min >= 120) {
      save(accountId, post.id, `perf:${post.id}`, `⚠️ ${what} الجديد أضعف من عادتك`,
        `${cap ? `«${cap}» ` : ""}وصل لـ ${n(snap.reach)} في ${hrs}، أقل من عادتك بـ ${Math.round((1 - ratio) * 100)}٪${how}. جرّب تعدّل أول سطر في الكابشن أو انشره في الستوري.`);
    }
  }
}

// تعليقات جديدة تسأل عن السعر أو التسجيل (بس اللي انكتبت آخر ٦ ساعات، عشان أول مزامنة ما تطلّع تنبيهات قديمة)
export function alertLeads(accountId, fresh, sent = []) {
  const recent = (fresh || []).filter((c) => Date.now() - Date.parse(c.timestamp) < 6 * 3600e3);
  const auto = sent.map((c) => "@" + c.username);
  if (!recent.length) {
    if (auto.length) save(accountId, sent[0].media_id, `leads:${sent[0].id}`, `📩 أرسلت التفاصيل بالخاص لـ ${auto.slice(0, 3).join("، ")}${auto.length > 3 ? " وغيرهم" : ""}`,
      "رسالة تلقائية لأنهم سألوا بالتعليقات. تابعهم من قسم العملاء إذا ما ردوا.");
    return;
  }
  const price = recent.filter((c) => c.intent === "سعر").length;
  const who = recent.length === 1 ? "شخص" : recent.length === 2 ? "شخصين" : `${recent.length} أشخاص`;
  const about = price === recent.length ? "عن السعر" : price ? "عن السعر والتسجيل" : "عن التسجيل";
  save(accountId, recent[0].media_id, `leads:${recent[0].id}`, `💬 ${who} سألوا ${about}`.replace("شخص سألوا", "شخص سأل"),
    auto.length
      ? `أرسلت لهم التفاصيل بالخاص تلقائياً (${auto.slice(0, 3).join("، ")}${auto.length > 3 ? " وغيرهم" : ""}). تابعهم من قسم العملاء إذا ما ردوا.`
      : "في تعليقات بوستاتك. افتح قسم «عملاء محتملين من التعليقات» في اللوحة ورد عليهم وهم متحمسين.");
}
