// تحليل الهاشتاقات اللي تستخدمها: أي هاشتاق يجي مع وصول واهتمام أعلى من عادتك
// كل بوست ينقارن ببوستات نفس النوع اللي نزلت قريب منه (±٣٠ يوم)، عشان نمو الحساب مع الوقت ما يخرب المقارنة
import { db } from "./db.js";
import { P, rx } from "./profile.js";

const MIN_POSTS = 8; // أقل عدد بوستات للهاشتاق عشان نحكم عليه
const TAG = /#[\p{L}\p{N}_]+/gu;
const CATEGORIES = [
  ["عام", /^#(اكسبلور|explore|explorepage|foryou|fyp|foryoupage|viral|ترند|trend|trending|reels|ريلز|reel|instagood|اكسبلوور|لايك|follow)/],
  // كلمات هاشتاقات مجالك من ملف مجالك (niche_tags)
  ["مجالك", rx(P.niche_tags) || /$^/],
];
const kindOf = (p) => (p.product_type === "REELS" ? "REELS" : p.media_type);
export const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const intentOf = (p) => (p.reach ? ((p.saved || 0) + 1.5 * (p.shares || 0) + 2 * (p.profile_visits || 0) + 3 * (p.follows || 0)) / p.reach : null);
export const tagsOf = (c) => [...new Set(((c || "").match(TAG) || []).map((t) => t.toLowerCase()))];

const plain = (t) => t.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

// بوستات آخر سنة (أو المدة اللي تحددها)، وكل بوست معه نسبته لعادتك وقتها (rel_reach و rel_intent)
export function scoredPosts(accountId, days = 365) {
  const posts = db.prepare(`SELECT * FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial AND reach > 0 AND timestamp >= ? ORDER BY timestamp`)
    .all(accountId, new Date(Date.now() - days * 864e5).toISOString().slice(0, 19))
    .map((p) => ({ ...p, kind: kindOf(p), t: Date.parse(p.timestamp), intent: intentOf(p), tags: tagsOf(p.caption) }));

  // نسبة كل بوست لعادتك وقتها: ١ = عادي، ١٫٥ = أعلى بـ ٥٠٪
  for (const p of posts) {
    const near = posts.filter((q) => q !== p && q.kind === p.kind && Math.abs(q.t - p.t) <= 30 * 864e5);
    if (near.length < 3) continue;
    p.rel_reach = p.reach / median(near.map((q) => q.reach));
    const mi = median(near.map((q) => q.intent).filter((x) => x != null));
    if (mi && p.intent != null) p.rel_intent = p.intent / mi;
  }
  return posts.filter((p) => p.rel_reach != null);
}

export function hashtagStats(accountId, username, name) {
  const scored = scoredPosts(accountId);
  if (scored.length < 20) return { ready: false, posts: scored.length };

  const lift = (list, k) => { const m = median(list.map((p) => p[k]).filter((x) => x != null)); return m == null ? null : m - 1; };
  // هاشتاق اسمك أو يوزرك (مثل #احمد_قريش)
  const mine = [username, (name || "").split("|")[0].trim().replace(/\s+/g, "_")].filter(Boolean).map((x) => "#" + plain(x.toLowerCase()));
  const category = (t) => (mine.includes(plain(t)) ? "اسمك" : CATEGORIES.find(([, re]) => re.test(t))?.[0] || "أخرى");

  const byTag = {};
  for (const p of scored) for (const t of p.tags) (byTag[t] ||= []).push(p);
  const tags = Object.entries(byTag).filter(([, list]) => list.length >= MIN_POSTS).map(([tag, list]) => ({
    tag, n: list.length, category: category(tag), reach_lift: lift(list, "rel_reach"), intent_lift: lift(list, "rel_intent"),
  })).sort((a, b) => b.reach_lift - a.reach_lift);

  // كم هاشتاق بالبوست أفضل؟
  const BUCKETS = [["بدون", 0, 0], ["١–٣", 1, 3], ["٤–٦", 4, 6], ["٧–١٠", 7, 10], ["أكثر من ١٠", 11, 99]];
  const counts = BUCKETS.map(([label, lo, hi]) => {
    const list = scored.filter((p) => p.tags.length >= lo && p.tags.length <= hi);
    return { label, lo, hi, n: list.length, reach_lift: list.length >= MIN_POSTS ? lift(list, "rel_reach") : null, intent_lift: list.length >= MIN_POSTS ? lift(list, "rel_intent") : null };
  });
  const usable = counts.filter((c) => c.reach_lift != null && c.lo > 0);
  // «الأفضل» بس إذا عينته كافية ويتفوق بوضوح على باقي الأعداد
  const total = (c) => c.reach_lift + (c.intent_lift || 0);
  const top = usable.length >= 2 ? [...usable].sort((a, b) => total(b) - total(a))[0] : null;
  // ولازم وصوله فعلاً أعلى من عادتك، مو بس «أقل سوءاً» من باقي الأعداد
  const best_count = top && top.n >= 15 && top.reach_lift > 0 && usable.every((c) => c === top || total(top) - total(c) > 0.15) ? top : null;

  const cats = ["مجالك", "عام", "اسمك", "أخرى"].map((name) => {
    const list = scored.filter((p) => p.tags.some((t) => category(t) === name));
    return { name, n: list.length, reach_lift: list.length >= MIN_POSTS ? lift(list, "rel_reach") : null, intent_lift: list.length >= MIN_POSTS ? lift(list, "rel_intent") : null };
  }).filter((c) => c.n);

  return {
    ready: true, posts: scored.length, with_tags: scored.filter((p) => p.tags.length).length,
    avg_count: scored.reduce((s, p) => s + p.tags.length, 0) / scored.length,
    min_posts: MIN_POSTS, tags, counts, best_count, categories: cats,
  };
}
