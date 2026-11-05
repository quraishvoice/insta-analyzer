// تحليل المواضيع: كل بوست ينصنّف من كلمات الكابشن، ونشوف أي موضوع يجيب وصول وأيه يجيب عملاء
// الكلمات تتعدّل في ملف مجالك (data/profile.json). البوست ياخذ الموضوع اللي له أكثر كلمات، ولو تعادلوا ياخذ اللي فوق في القائمة
import { db } from "./db.js";
import { scoredPosts, median } from "./hashtags.js";
import { P, rx, nicheTest } from "./profile.js";

const MIN = 5; // أقل عدد بوستات عشان نحكم على موضوع
// المواضيع وكلماتها من ملف مجالك (profile.js). needs_niche = ما يحسب إلا إذا الكابشن فيه كلمة من مجالك
// [الاسم, الكلمات, شرط إضافي (اختياري)]
export const TOPICS = P.topics.map((t) => [t.name, rx(t.words, "g") || /$^/g, t.needs_niche ? nicheTest : null]);

// مواضيع مجالك (تجيب ناس مهتمين باللي تقدمه) مقابل المواضيع العامة
export const NICHE_TOPICS = new Set(P.topics.filter((t) => t.niche).map((t) => t.name));

const normalize = (t) => (t || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/_/g, " ").toLowerCase();

// loose: للأفكار القصيرة (مثل «كاروسيل عن أخطاء شائعة») ما نشترط كلمة من مجالك، لأن كل أفكارك أصلاً عن مجالك
export function topicOf(caption, loose = false) {
  const t = normalize(caption);
  let best = null, hits = 0;
  for (const [name, re, need] of TOPICS) {
    if (need && !loose && !need(t)) continue;
    const n = (t.match(re) || []).length;
    if (n > hits) { best = name; hits = n; }
  }
  return best || "أخرى";
}

const lift = (list, k) => { const m = median(list.map((p) => p[k]).filter((x) => x != null)); return m == null ? null : m - 1; };

// أرقام كل موضوع خلال آخر سنة، كل بوست مقارن بعادتك وقته (مثل الهاشتاقات)
export function topicStats(accountId) {
  const posts = scoredPosts(accountId).map((p) => ({ ...p, topic: topicOf(p.caption) }));
  if (posts.length < 15) return { ready: false, posts: posts.length };

  const leadsOf = Object.fromEntries(db.prepare(`SELECT media_id, COUNT(*) n, SUM(outcome = 'سجّل') won FROM comments
    WHERE account_id = ? AND intent IN ('سعر', 'تسجيل') GROUP BY media_id`).all(accountId).map((r) => [r.media_id, r]));
  const salesOf = Object.fromEntries(db.prepare("SELECT media_id, SUM(count) n FROM sales WHERE account_id = ? AND media_id IS NOT NULL GROUP BY media_id")
    .all(accountId).map((r) => [r.media_id, r.n]));
  const allLeads = posts.reduce((s, p) => s + (leadsOf[p.id]?.n || 0), 0);
  const leadRate = allLeads / posts.length;

  const groups = {};
  for (const p of posts) (groups[p.topic] ||= []).push(p);
  const summarize = ([name, list]) => {
    const leads = list.reduce((s, p) => s + (leadsOf[p.id]?.n || 0), 0);
    const sales = list.reduce((s, p) => s + (salesOf[p.id] || 0), 0);
    const top = [...list].sort((a, b) => (b.rel_reach || 0) - (a.rel_reach || 0))[0];
    return {
      name, n: list.length, share: list.length / posts.length, enough: list.length >= MIN,
      reach_lift: lift(list, "rel_reach"), intent_lift: lift(list, "rel_intent"),
      leads, leads_per_post: leads / list.length,
      // كم ضعف معدلك في أسئلة السعر والتسجيل (١ = نفس عادتك)
      leads_x: leadRate ? leads / list.length / leadRate : null,
      sales,
      top: top && { caption: (top.caption || "").split("\n")[0].slice(0, 70), permalink: top.permalink, reach: top.reach },
      niche: NICHE_TOPICS.has(name),
    };
  };
  // مواضيع مجالك أول، والأكثر بوستات أول، و«أخرى» آخر شي
  const topics = Object.entries(groups).map(summarize).sort((a, b) => (a.name === "أخرى") - (b.name === "أخرى") || b.niche - a.niche || b.n - a.n);
  // مقارنة أوسع: كل مواضيع مجالك مع بعض مقابل المحتوى العام (تنفع لما كل موضوع لحاله عينته قليلة)
  const sides = [["عن مجالك", posts.filter((p) => NICHE_TOPICS.has(p.topic))], ["محتوى عام", posts.filter((p) => !NICHE_TOPICS.has(p.topic))]]
    .map(summarize).map(({ top, niche, ...x }) => x);

  const ok = topics.filter((t) => t.enough && t.name !== "أخرى");
  const by = (k) => [...ok].filter((t) => t[k] != null).sort((a, b) => b[k] - a[k]);
  const reachTop = by("reach_lift")[0], intentTop = by("intent_lift")[0];
  // أكثر موضوع يجيب عملاء: التسجيلات إذا فيه، وإلا أسئلة السعر والتسجيل
  const sellTop = ok.some((t) => t.sales) ? by("sales")[0] : allLeads >= 5 ? by("leads_x").find((t) => t.leads >= 2) : null;
  return {
    ready: true, posts: posts.length, leads: allLeads, topics, sides,
    best: { reach: reachTop?.reach_lift > 0.1 ? reachTop.name : null, intent: intentTop?.intent_lift > 0.1 ? intentTop.name : null, sell: sellTop?.name || null },
  };
}
