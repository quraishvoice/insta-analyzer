// صانع الكاروسيل: مسودات محفوظة + مواد من حسابك (أسئلة جمهورك، أقوى بداياتك، أرقام الكاروسيل عندك)
import { db } from "./db.js";
import { scoredPosts, median } from "./hashtags.js";
import { topicStats } from "./topics.js";
import { watchStats } from "./watch.js";

db.exec(`CREATE TABLE IF NOT EXISTS carousels (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, title TEXT, data TEXT, updated_at INTEGER
)`);

const clean = (t) => (t || "").replace(/[⁦-⁩‎‏\t]/g, "").trim();
const firstLine = (c) => clean(c).split("\n").find((l) => l.trim())?.trim().slice(0, 90) || "";

export function listCarousels(accountId) {
  return db.prepare("SELECT id, title, updated_at FROM carousels WHERE account_id = ? ORDER BY updated_at DESC LIMIT 50").all(accountId);
}

export function getCarousel(id) {
  const c = db.prepare("SELECT * FROM carousels WHERE id = ?").get(+id);
  if (!c) throw Object.assign(new Error("المسودة مو موجودة"), { status: 404 });
  return { ...c, data: JSON.parse(c.data) };
}

export function saveCarousel(accountId, body) {
  const data = JSON.stringify(body.data || {});
  if (data.length > 200000) throw new Error("المسودة كبيرة");
  const title = String(body.title || "كاروسيل بدون عنوان").slice(0, 120);
  const now = Math.floor(Date.now() / 1000);
  if (body.id) {
    const r = db.prepare("UPDATE carousels SET title = ?, data = ?, updated_at = ? WHERE id = ? AND account_id = ?").run(title, data, now, +body.id, accountId);
    if (r.changes) return { id: +body.id };
  }
  return { id: Number(db.prepare("INSERT INTO carousels (account_id, title, data, updated_at) VALUES (?, ?, ?, ?)").run(accountId, title, data, now).lastInsertRowid) };
}

export function deleteCarousel(id) {
  db.prepare("DELETE FROM carousels WHERE id = ?").run(+id);
  return { ok: true };
}

// المواد اللي تساعدك تكتب: من تعليقات جمهورك وبوستاتك أنت
export function carouselKit(accountId) {
  const acc = db.prepare("SELECT username, name FROM accounts WHERE id = ?").get(accountId) || {};

  // أسئلة جمهورك الحقيقية (آخر ٦ شهور): تنفع شرائح «سؤال وجواب» أو رد على اعتراض
  const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 19);
  const seen = new Set();
  const questions = db.prepare(`SELECT text, intent, timestamp FROM comments WHERE account_id = ? AND intent IS NOT NULL AND timestamp >= ?
    ORDER BY CASE intent WHEN 'سؤال' THEN 0 WHEN 'تسجيل' THEN 1 ELSE 2 END, timestamp DESC`).all(accountId, since)
    .map((c) => ({ text: clean(c.text).replace(/@[\w.]+/g, "").trim().slice(0, 160), intent: c.intent }))
    .filter((c) => c.text.length >= 8 && !seen.has(c.text) && seen.add(c.text)).slice(0, 15);

  // أقوى بداياتك: أول سطر من البوستات اللي اهتمامها أعلى من عادتك
  const posts = scoredPosts(accountId);
  const hooks = posts.filter((p) => (p.rel_intent || 0) >= 1.3 && (p.rel_reach || 0) >= 0.8 && firstLine(p.caption).length >= 10)
    .sort((a, b) => b.rel_intent - a.rel_intent).slice(0, 8)
    .map((p) => ({ text: firstLine(p.caption), times: Math.round(p.rel_intent * 10) / 10, permalink: p.permalink }));

  // الكاروسيل مقابل باقي الأنواع (آخر سنة): الحفظ والمشاركة بالمتوسط
  const byKind = {};
  for (const p of posts) (byKind[p.kind] ||= []).push(p);
  const kindStats = Object.entries(byKind).filter(([, l]) => l.length >= 3).map(([kind, l]) => ({
    kind, n: l.length, saved: median(l.map((p) => p.saved || 0)), shares: median(l.map((p) => p.shares || 0)), reach: median(l.map((p) => p.reach || 0)),
  }));

  // للريلز: أفضل طول عندك، وبدايات الريلز اللي الناس كمّلوها أكثر
  const w = watchStats(accountId);
  const okLen = w.ready ? w.lengths.filter((x) => x.enough) : [];
  const bestLen = [...okLen].sort((a, b) => b.reach_lift - a.reach_lift)[0];
  const long = okLen.find((x) => x.name === "أكثر من دقيقة");
  const question = w.ready ? w.hooks.find((x) => x.name === "سؤال" && x.enough) : null;
  const reel = w.ready ? {
    by_pct: w.by_pct, median_ret: w.median_ret, median_duration: w.median_duration,
    best_len: bestLen && bestLen.reach_lift > 0.05 ? { name: bestLen.name, ret: bestLen.score, reach_lift: bestLen.reach_lift } : null,
    long: long ? { ret: long.score, n: long.n, reach_lift: long.reach_lift } : null,
    question_lift: question?.lift > 0.05 ? question.lift : null,
    hooks: w.top.filter((r) => r.caption.length >= 8).map((r) => ({ text: r.caption, ret: r.ret, watch: r.watch })),
  } : null;

  const t = topicStats(accountId);
  return {
    reel,
    username: acc.username, name: (acc.name || "").split("|")[0].trim(),
    questions, hooks, kinds: kindStats,
    topics: t.ready ? { best: t.best, list: t.topics.filter((x) => x.niche).map((x) => x.name) } : null,
  };
}
