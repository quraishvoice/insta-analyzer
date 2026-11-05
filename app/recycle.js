// إعادة تدوير المحتوى الناجح: بوستات عمرها ٣ شهور أو أكثر كانت أقوى بوضوح من عادتك وقتها
// أغلب متابعينك الحين ما شافوها، فتستاهل تنزل من جديد بشكل جديد
import { db } from "./db.js";
import { scoredPosts, median } from "./hashtags.js";
import { topicOf, NICHE_TOPICS } from "./topics.js";
import { L } from "./i18n.js";
import { P, T } from "./profile.js";

db.exec(`CREATE TABLE IF NOT EXISTS recycle (
  account_id TEXT, media_id TEXT, status TEXT, at INTEGER,  -- used = نزّلتها من جديد، skip = ما تناسب
  PRIMARY KEY (account_id, media_id)
)`);

const MIN_AGE = 90;    // يوم
const STRONG = 2;      // ضعف عادتك وقتها أو أكثر
const NAMES = { REELS: "ريلز", CAROUSEL_ALBUM: "كاروسيل", IMAGE: "صورة", VIDEO: "فيديو" };
const normalize = (t) => (t || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase();
const words = (t) => new Set(normalize((t || "").replace(/#[\p{L}\p{N}_]+/gu, " ")).match(/[\p{L}]{3,}/gu) || []);
const clean = (c) => (c || "").replace(/[\u2066-\u2069\u200e\u200f\t]/g, "");
const firstLine = (c) => clean(c).split("\n").find((l) => l.trim())?.trim().slice(0, 80) || "";

// هل نزّلت شي قريب منها في آخر ٩٠ يوم؟
function similarTo(post, recent) {
  const mine = words(post.caption);
  if (mine.size < 3) return null;
  return recent.find((r) => {
    const w = words(r.caption);
    const common = [...mine].filter((x) => w.has(x)).length;
    return common >= 3 && common / Math.min(mine.size, w.size || 1) >= 0.5;
  }) || null;
}

function howTo(p, ageDays, niche) {
  const steps = [];
  if (p.kind !== "REELS" && p.media_type !== "VIDEO") steps.push(L("سوّها ريل: نفس الفكرة بصوتك وصورتك، لأن الريلز توصل لناس جدد أكثر", "Turn it into a Reel: same idea with your voice and face, since Reels reach more new people"));
  else if (ageDays > 365) steps.push(L("صوّرها من جديد بنفس الفكرة والبداية، بجودة اليوم", "Reshoot it with the same idea and opening, at today's quality"));
  else steps.push(L("نزّلها من جديد مع أول سطر وغلاف جديدين، أو قصّ منها أقوى ١٥ ثانية", "Repost it with a new first line and cover, or cut out the strongest 15 seconds"));
  if (!niche) steps.push(L(`وزد عليها لمسة من مجالك وسطر عن ${T(P.offer)} في الآخر`, `add a touch of your niche and a line about ${T(P.offer)} at the end`));
  return steps.join(L("، ", ", and ")) + ".";
}

export function recycleIdeas(accountId) {
  const now = Date.now();
  const all = scoredPosts(accountId, 3650);
  const marks = Object.fromEntries(db.prepare("SELECT media_id, status FROM recycle WHERE account_id = ?").all(accountId).map((r) => [r.media_id, r.status]));
  const recent = db.prepare("SELECT id, caption, permalink, timestamp FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial AND timestamp >= ?")
    .all(accountId, new Date(now - MIN_AGE * 864e5).toISOString().slice(0, 19));

  // لازم يكون وصولها الفعلي محترم مقارنة بحسابك اليوم (بوست وصل لـ ٢٠ شخص سنة ٢٠١٩ ما يثبت شي)
  const nowReach = median(all.filter((p) => now - p.t < MIN_AGE * 864e5).map((p) => p.reach)) || 0;
  const floor = nowReach * 0.2;

  const ideas = [];
  for (const p of all) {
    if (p.reach < floor) continue;
    const age = (now - p.t) / 864e5;
    if (age < MIN_AGE) continue;
    // الاهتمام العالي ما يكفي إذا الوصول كان ضعيف (عينة صغيرة تطلّع نسب كبيرة)
    const intent = (p.rel_reach || 0) >= 0.7 ? p.rel_intent || 0 : 0;
    const best = Math.max(p.rel_reach || 0, intent);
    if (best < STRONG) continue;
    const topic = topicOf(p.caption), niche = NICHE_TOPICS.has(topic);
    const twin = similarTo(p, recent);
    ideas.push({
      id: p.id, caption: firstLine(p.caption), permalink: p.permalink, image: p.thumbnail_url || p.media_url,
      kind_name: NAMES[p.kind] || p.kind, timestamp: p.timestamp, age_days: Math.round(age),
      reach: p.reach, rel_reach: p.rel_reach, rel_intent: p.rel_intent ?? null,
      why: (p.rel_reach || 0) >= intent ? "وصول" : "اهتمام",
      times: Math.round(best * 10) / 10,
      topic, niche, how: howTo(p, age, niche),
      status: marks[p.id] || (twin ? "similar" : null),
      similar: twin ? { caption: firstLine(twin.caption), permalink: twin.permalink } : null,
      // الترتيب: مجالك أول (أقرب للبيع)، وبعدها الأقوى
      // النسب فوق ٥ أضعاف غالباً حظ، فنوقفها عند ٥ ونفاضل بالوصول
      score: Math.min(best, 5) * (niche ? 1.3 : 1) + Math.log10(p.reach || 1) / 10,
    });
  }
  ideas.sort((a, b) => b.score - a.score);
  const open = ideas.filter((x) => !x.status);
  return {
    open: open.slice(0, 24), total: open.length,
    used: ideas.filter((x) => x.status === "used").slice(0, 12),
    similar: ideas.filter((x) => x.status === "similar").length,
    skipped: ideas.filter((x) => x.status === "skip").length,
    min_age: MIN_AGE,
  };
}

export function markRecycle(accountId, mediaId, status) {
  if (!["used", "skip", null].includes(status ?? null)) throw new Error(L("حالة غير معروفة", "Unknown status"));
  if (status) db.prepare("INSERT INTO recycle (account_id, media_id, status, at) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, media_id) DO UPDATE SET status = excluded.status, at = excluded.at")
    .run(accountId, mediaId, status, Math.floor(Date.now() / 1000));
  else db.prepare("DELETE FROM recycle WHERE account_id = ? AND media_id = ?").run(accountId, mediaId);
  return { ok: true };
}
