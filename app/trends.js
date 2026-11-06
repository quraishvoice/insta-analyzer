// الرائج في هاشتاقات مجالك: أحدث البوستات في كل هاشتاق (آخر ٢٤ ساعة) مرتبة بسرعة انتشارها
// يستخدم نفس ربط فيسبوك حق المنافسين (Hashtag Search). انستجرام ما يعطي اسم صاحب البوست ولا مشاهداته،
// وما يعطي أرقام البوست بعد ما يطلع من «الأحدث»، فنحفظ أرقامه وقت ما شفناه وكم ساعة كان عمره
// «الأفضل» (top_media) أغلبه بوستات قديمة من سنين، فناخذ منه اللي عمره سنة أو أقل بس
import { db, upsert } from "./db.js";
import { L } from "./i18n.js";
import { P } from "./profile.js";

const API = "https://graph.facebook.com/v23.0";
const MAX = 15;          // انستجرام يسمح بـ٣٠ هاشتاق مختلف كل ٧ أيام، فنخلي مجال للتغيير
const WEEK_LIMIT = 30;
const EVERY = 4 * 3600;  // أحدث البوستات كل ٤ ساعات
const FIELDS = "id,caption,media_type,media_product_type,comments_count,like_count,permalink,timestamp";
// هاشتاقات تبدأ فيها القائمة: من ملف مجالك (trend_tags)
export const SUGGESTED = P.trend_tags || [];

db.exec(`
  CREATE TABLE IF NOT EXISTS trend_tags (
    account_id TEXT, tag TEXT, tag_id TEXT, added_at INTEGER, error TEXT, last_recent INTEGER, last_top INTEGER, capped INTEGER,
    PRIMARY KEY (account_id, tag));
  CREATE TABLE IF NOT EXISTS trend_searches (account_id TEXT, tag TEXT, at INTEGER, PRIMARY KEY (account_id, tag, at));
  CREATE TABLE IF NOT EXISTS trend_media (
    account_id TEXT, id TEXT, tags TEXT, timestamp TEXT, media_type TEXT, product_type TEXT, caption TEXT,
    likes INTEGER, comments INTEGER, permalink TEXT, seen_at INTEGER, source TEXT,
    PRIMARY KEY (account_id, id));
  CREATE INDEX IF NOT EXISTS trend_media_time ON trend_media(account_id, timestamp);
`);

async function fb(path, params, token) {
  const url = new URL(path.startsWith("http") ? path : API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!path.startsWith("http")) url.searchParams.set("access_token", token);
  const body = await (await fetch(url)).json();
  if (body.error) {
    const e = body.error;
    const err = new Error(e.code === 190
      ? L("توكن فيسبوك وقف. افتح «إدارة المنافسين» والصق توكن جديد.", "The Facebook token stopped working. Open “Manage competitors” and paste a new token.")
      : e.code === 24 || /hashtag.*(limit|30)/i.test(e.message)
        ? L("وصلت حد انستجرام: ٣٠ هاشتاق مختلف كل ٧ أيام. الهاشتاقات الجديدة تنسحب لما يمر أسبوع.", "You've hit Instagram's limit of 30 different hashtags every 7 days. New hashtags will be fetched once the week passes.")
        : e.code === 10 || e.code === 200
          ? L("تطبيقك في Meta ما عنده صلاحية البحث بالهاشتاق (Instagram Public Content Access).", "Your Meta app lacks hashtag search access (Instagram Public Content Access).")
          : e.error_user_msg || e.message);
    err.code = e.code;
    throw err;
  }
  return body;
}

// «#تعليق صوتي» ← «تعليق_صوتي»: بدون # ومسافات، وحروف صغيرة للإنقليزي
export function cleanTag(s) {
  const t = String(s || "").trim().replace(/^#+/, "").replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
  return t && t.length <= 60 ? t : null;
}

const auth = (accountId) => db.prepare("SELECT token, ig_id FROM competitor_auth WHERE account_id = ?").get(accountId);
const weekAgo = () => Math.floor(Date.now() / 1000) - 7 * 86400;
const searchedThisWeek = (accountId) => new Set(db.prepare("SELECT DISTINCT tag FROM trend_searches WHERE account_id = ? AND at > ?").all(accountId, weekAgo()).map((r) => r.tag));

export function getTrendTags(accountId) {
  const list = db.prepare("SELECT tag, error FROM trend_tags WHERE account_id = ? ORDER BY added_at, tag").all(accountId);
  const used = searchedThisWeek(accountId).size;
  return { connected: !!auth(accountId), list, max: MAX, left: Math.max(0, WEEK_LIMIT - used), suggested: SUGGESTED };
}

export async function setTrendTags(accountId, tags) {
  // سطر لكل هاشتاق، أو فاصلة، أو أكثر من # بنفس السطر. المسافة داخل الهاشتاق تصير _
  const parts = (Array.isArray(tags) ? tags : String(tags || "").split(/[\n,،]+/)).flatMap((p) => (String(p).includes("#") ? String(p).split("#") : [p]));
  const wanted = [...new Set(parts.map(cleanTag).filter(Boolean))];
  if (wanted.length > MAX) throw new Error(L(`${MAX} هاشتاق بالكثير.`, `${MAX} hashtags at most.`));
  const old = new Set(db.prepare("SELECT tag FROM trend_tags WHERE account_id = ?").all(accountId).map((r) => r.tag));
  // الجديد اللي ما انبحث هالأسبوع يحسب من الـ٣٠
  const done = searchedThisWeek(accountId);
  const fresh = wanted.filter((t) => !old.has(t) && !done.has(t));
  if (done.size + fresh.length > WEEK_LIMIT)
    throw new Error(L(`انستجرام يسمح بـ${WEEK_LIMIT} هاشتاق مختلف كل ٧ أيام، وباقي لك ${WEEK_LIMIT - done.size} هالأسبوع. شيل ${done.size + fresh.length - WEEK_LIMIT} من الجديدة أو انتظر.`,
      `Instagram allows ${WEEK_LIMIT} different hashtags every 7 days, and you have ${WEEK_LIMIT - done.size} left this week. Remove ${done.size + fresh.length - WEEK_LIMIT} of the new ones or wait.`));
  db.exec("BEGIN");
  try {
    for (const t of old) if (!wanted.includes(t)) db.prepare("DELETE FROM trend_tags WHERE account_id = ? AND tag = ?").run(accountId, t);
    const now = Math.floor(Date.now() / 1000);
    wanted.forEach((t, i) => { if (!old.has(t)) db.prepare("INSERT INTO trend_tags (account_id, tag, added_at) VALUES (?, ?, ?)").run(accountId, t, now + i); });
    // بوستات ما عاد لها هاشتاق في القائمة
    for (const m of db.prepare("SELECT id, tags FROM trend_media WHERE account_id = ?").all(accountId)) {
      const keep = JSON.parse(m.tags || "[]").filter((t) => wanted.includes(t));
      if (!keep.length) db.prepare("DELETE FROM trend_media WHERE account_id = ? AND id = ?").run(accountId, m.id);
      else db.prepare("UPDATE trend_media SET tags = ? WHERE account_id = ? AND id = ?").run(JSON.stringify(keep), accountId, m.id);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  if (wanted.some((t) => !old.has(t))) syncTrends(accountId, { only: wanted.filter((t) => !old.has(t)) }).catch((e) => console.error("الهاشتاقات:", e.message));
  return getTrendTags(accountId);
}

function store(accountId, tag, m, source) {
  const prev = db.prepare("SELECT tags, source FROM trend_media WHERE account_id = ? AND id = ?").get(accountId, m.id);
  const tags = [...new Set([...JSON.parse(prev?.tags || "[]"), tag])];
  upsert("trend_media", {
    account_id: accountId, id: m.id, tags: JSON.stringify(tags), timestamp: m.timestamp, media_type: m.media_type, product_type: m.media_product_type || null,
    caption: m.caption || "", likes: m.like_count ?? null, comments: m.comments_count ?? null, permalink: m.permalink,
    seen_at: Math.floor(Date.now() / 1000), source: prev?.source === "recent" ? "recent" : source,
  }, ["account_id", "id"]);
}

async function fetchTag(accountId, a, row, { top }) {
  let id = row.tag_id;
  if (!id) {
    const r = await fb("/ig_hashtag_search", { user_id: a.ig_id, q: row.tag }, a.token);
    db.prepare("INSERT OR IGNORE INTO trend_searches (account_id, tag, at) VALUES (?, ?, ?)").run(accountId, row.tag, Math.floor(Date.now() / 1000));
    id = r.data?.[0]?.id;
    if (!id) throw new Error(L("انستجرام ما لقى هالهاشتاق.", "Instagram couldn't find this hashtag."));
    db.prepare("UPDATE trend_tags SET tag_id = ? WHERE account_id = ? AND tag = ?").run(id, accountId, row.tag);
  }
  // بوستاتك أنت ما نعرضها
  const own = (mid) => db.prepare("SELECT 1 FROM media WHERE account_id = ? AND id = ?").get(accountId, mid);
  // الأحدث: آخر ٢٤ ساعة، ٣ صفحات بالكثير (١٥٠ بوست)
  let r = await fb(`/${id}/recent_media`, { user_id: a.ig_id, fields: FIELDS, limit: 50 }, a.token), n = 0;
  for (let page = 0; r?.data; page++) {
    for (const m of r.data) { n++; if (!own(m.id)) store(accountId, row.tag, m, "recent"); }
    if (page >= 2 || !r.paging?.next) break;
    r = await fb(r.paging.next, {}, a.token);
  }
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE trend_tags SET last_recent = ?, capped = ?, error = NULL WHERE account_id = ? AND tag = ?").run(now, n >= 150 ? 1 : 0, accountId, row.tag);
  if (!top) return;
  // الأفضل: مرة باليوم، واللي عمره سنة أو أقل بس
  const year = Date.now() - 365 * 864e5;
  r = await fb(`/${id}/top_media`, { user_id: a.ig_id, fields: FIELDS, limit: 50 }, a.token);
  for (let page = 0; r?.data; page++) {
    for (const m of r.data) if (Date.parse(m.timestamp) >= year && !own(m.id)) store(accountId, row.tag, m, "top");
    if (page >= 1 || !r.paging?.next) break;
    r = await fb(r.paging.next, {}, a.token);
  }
  db.prepare("UPDATE trend_tags SET last_top = ? WHERE account_id = ? AND tag = ?").run(now, accountId, row.tag);
}

// كل ٤ ساعات (only: الهاشتاقات الجديدة على طول بعد الحفظ)
const busy = new Set(); // سحب واحد بكل مرة لكل حساب (انستجرام بطيء في الهاشتاقات: دقيقة تقريباً لكل واحد)
export async function syncTrends(accountId, { only = null } = {}) {
  const a = auth(accountId);
  if (!a || busy.has(accountId)) return;
  busy.add(accountId);
  try { await pull(accountId, a, only); } finally { busy.delete(accountId); }
}
async function pull(accountId, a, only) {
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare("SELECT * FROM trend_tags WHERE account_id = ? ORDER BY added_at").all(accountId)
    .filter((r) => (only ? only.includes(r.tag) : now - (r.last_recent || 0) >= EVERY - 300));
  for (const row of rows) {
    try {
      await fetchTag(accountId, a, row, { top: now - (row.last_top || 0) >= 20 * 3600 });
    } catch (e) {
      db.prepare("UPDATE trend_tags SET error = ? WHERE account_id = ? AND tag = ?").run(e.message, accountId, row.tag);
      if ([190, 4, 17, 32, 613].includes(e.code)) break; // التوكن أو حد الطلبات: نوقف ونكمل الدورة الجاية
    }
  }
  // الأحدث نخليه ٣٠ يوم، والأفضل سنة
  db.prepare("DELETE FROM trend_media WHERE account_id = ? AND ((source = 'recent' AND timestamp < ?) OR timestamp < ?)")
    .run(accountId, new Date(Date.now() - 30 * 864e5).toISOString(), new Date(Date.now() - 365 * 864e5).toISOString());
}

const kindOf = (m) => (m.product_type === "REELS" || m.media_type === "VIDEO" ? "REELS" : m.media_type === "CAROUSEL_ALBUM" ? "CAROUSEL_ALBUM" : "IMAGE");
const firstLine = (c) => (c || "").replace(/[‎‏⁦-⁩\t]+/g, " ").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 100) || "";
const score = (m) => (m.likes || 0) + 2 * (m.comments || 0);

export function trendsReport(accountId) {
  const status = getTrendTags(accountId);
  if (!status.list.length) return { ...status, tags: [], rising: [], top: [] };
  const now = Date.now();
  const since7 = new Date(now - 7 * 864e5).toISOString();
  const all = db.prepare("SELECT * FROM trend_media WHERE account_id = ?").all(accountId);
  const recent = all.filter((m) => m.source === "recent" && m.timestamp >= since7);
  // كم بوست ينزل باليوم في كل هاشتاق (من اللي شفناه آخر ٧ أيام)
  const meta = db.prepare("SELECT tag, error, last_recent, capped, added_at FROM trend_tags WHERE account_id = ? ORDER BY added_at, tag").all(accountId);
  const tags = meta.map((t) => {
    const seen = recent.filter((m) => JSON.parse(m.tags).includes(t.tag));
    const days = Math.min(7, Math.max(1, (now / 1000 - t.added_at) / 86400));
    return { tag: t.tag, error: t.error, pending: !t.last_recent && !t.error, per_day: t.last_recent ? Math.round(seen.length / days) : null, capped: !!t.capped };
  });
  // سرعة الانتشار: التفاعل ÷ عمر البوست بالساعات لما شفناه آخر مرة (ساعتين أقل شي عشان ما يطير بوست عمره دقايق)
  const rising = recent.map((m) => {
    const hours = Math.max(2, (m.seen_at * 1000 - Date.parse(m.timestamp)) / 36e5);
    return { ...m, hours, speed: score(m) / hours };
  }).filter((m) => score(m) > 0).sort((a, b) => b.speed - a.speed).slice(0, 80); // زيادة عشان فلتر «عربي بس» في اللوحة
  const top = all.filter((m) => m.source === "top").sort((a, b) => score(b) - score(a)).slice(0, 30);
  const slim = (m) => ({ tags: JSON.parse(m.tags), kind: kindOf(m), timestamp: m.timestamp, likes: m.likes, comments: m.comments,
    permalink: m.permalink, caption: firstLine(m.caption), hours: m.hours ? Math.round(m.hours) : undefined, speed: m.speed ? Math.round(m.speed) : undefined });
  return { ...status, tags, rising: rising.map(slim), top: top.map(slim) };
}
