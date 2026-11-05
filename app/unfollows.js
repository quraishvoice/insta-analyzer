// اللي ألغوا متابعتك: أيام فيها إلغاء أكثر بكثير من عادتك، والبوستات اللي نزلت ذاك اليوم أو اللي قبله
// Meta تحسب اليوم بتوقيت المحيط الهادي، فربط اليوم بالبوست تقريبي
import { db } from "./db.js";
import { save as saveAlert } from "./alerts.js";

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const shift = (day, n) => { const t = new Date(day + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
// بداية اليوم بتوقيتك، بنفس شكل وقت البوست من انستجرام
const startOf = (day) => {
  const guess = new Date(day + "T00:00:00Z");
  const off = new Date(guess.toLocaleString("en-US", { timeZone: TZ })) - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess - off).toISOString().slice(0, 19);
};

export function unfollowSpikes(accountId, from, to) {
  // آخر يومين Meta لسا ما كمّلتهم (يجون صفر)، فما يدخلون لا في العادة ولا في الأيام
  const lag = shift(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()), -2);
  const end = to < lag ? to : lag;
  const rows = db.prepare("SELECT date, unfollows FROM daily WHERE account_id = ? AND unfollows IS NOT NULL AND date >= ? AND date <= ? ORDER BY date")
    .all(accountId, shift(end, -60), end);
  if (rows.length < 10) return [];
  const usual = median(rows.map((r) => r.unfollows));
  const limit = Math.max(5, usual * 3);
  const posts = db.prepare(`SELECT caption, permalink, media_type, product_type FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial
    AND timestamp >= ? AND timestamp < ? ORDER BY timestamp`);
  return rows.filter((r) => r.date >= from && r.date <= to && r.unfollows >= limit).map((r) => ({
    date: r.date, unfollows: r.unfollows, usual,
    posts: posts.all(accountId, startOf(shift(r.date, -1)), startOf(shift(r.date, 1)))
      .map((p) => ({ caption: (p.caption || "").replace(/[\u200e\u200f\u2066-\u2069\t]+/g, " ").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 60) || "", permalink: p.permalink, kind: p.product_type === "REELS" ? "REELS" : p.media_type })),
  }));
}

// بعد المزامنة الكاملة: تنبيه على يوم إلغاء غير عادي من آخر ٥ أيام (Meta تتأخر يومين في هالأرقام)
export function unfollowAlerts(accountId) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  for (const s of unfollowSpikes(accountId, shift(today, -5), today)) {
    const post = s.posts.at(-1);
    const day = new Date(s.date + "T12:00:00Z").toLocaleDateString("ar-SA-u-nu-latn-ca-gregory", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    saveAlert(accountId, null, `unfollow:${s.date}`, `📉 ${s.unfollows} ألغوا متابعتك يوم ${day}`,
      `عادتك ${Math.round(s.usual)} باليوم. ${post ? `قبلها نزّلت «${post.caption || "بوست بدون كابشن"}». شوف إذا موضوعه أو طريقته بعيدة عن اللي تابعوك عشانه.` : "ما نزّلت بوست ذاك اليوم ولا اللي قبله، فغالباً تنظيف من انستجرام لحسابات وهمية."}`,
      post?.permalink || null);
  }
}
