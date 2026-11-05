// الربط مع Instagram API (تسجيل الدخول عبر انستجرام — ما يحتاج صفحة فيسبوك)
import { db, upsert } from "./db.js";
import { writeFile } from "node:fs/promises";
import { classify } from "./intent.js";
import { checkPostAlerts, alertLeads } from "./alerts.js";
import { keywordTest, runAutoDm } from "./autodm.js";
import { syncAudience } from "./audience.js";
import { syncTagged } from "./tagged.js";
import { syncCompetitors } from "./competitors.js";
import { unfollowAlerts } from "./unfollows.js";
import { L } from "./i18n.js";

const API = "https://graph.instagram.com/v23.0";
const DAY = 86400;

export async function ig(path, params = {}, token, method = "GET") {
  const url = new URL(path.startsWith("http") ? path : API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { method });
  const body = await res.json();
  if (body.error) {
    const msg = body.error.code === 190
      ? L("التوكن غير صحيح أو منتهي — ولّد توكن جديد من لوحة مطوري Meta", "The token is invalid or expired. Generate a new one in the Meta developer dashboard.")
      : body.error.error_user_msg || body.error.message;
    const err = new Error(msg);
    err.code = body.error.code;
    throw err;
  }
  return body;
}

// إضافة حساب جديد من توكن يتم توليده في لوحة مطوري Meta
export async function addAccount({ token, business, goal }) {
  const me = await ig("/me", { fields: "user_id,username,name,account_type,profile_picture_url,followers_count" }, token);
  if (me.account_type === "PERSONAL") throw new Error(L("الحساب شخصي — حوّله لاحترافي أول", "This is a personal account. Switch it to a professional account first."));

  // التوكن الطويل صالح 60 يوم؛ نجدده فوراً عشان نعرف تاريخ انتهائه
  let expires = Math.floor(Date.now() / 1000) + 60 * DAY;
  try {
    const r = await ig("/refresh_access_token", { grant_type: "ig_refresh_token" }, token);
    token = r.access_token;
    expires = Math.floor(Date.now() / 1000) + r.expires_in;
  } catch {
    // توكن قصير أو جديد جداً — نكمل فيه ونجدده لاحقاً
  }

  // نفس الحساب ينضاف مرة ثانية لما تلصق توكن جديد: نحدّث التوكن وما نمسح وصف نشاطه وهدفه المحفوظين
  const id = me.user_id || me.id;
  const known = db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(id);
  upsert("accounts", {
    id, username: me.username, name: me.name,
    picture: me.profile_picture_url, token, token_expires: expires,
    ...(known ? {} : { business, goal }), followers: me.followers_count, is_demo: 0,
  }, ["id"]);
  return me.user_id || me.id;
}

export async function refreshTokenIfNeeded(acc) {
  if (acc.token_expires - Date.now() / 1000 > 10 * DAY) return acc.token;
  let r;
  try { r = await ig("/refresh_access_token", { grant_type: "ig_refresh_token" }, acc.token); } catch (e) {
    // فشل التجديد (شبكة أو خطأ مؤقت من Meta) والتوكن لسا صالح: نكمل فيه ونجرب التجديد المرة الجاية
    if (e.code !== 190 && acc.token_expires > Date.now() / 1000) { console.error("تجديد التوكن:", e.message); return acc.token; }
    throw e;
  }
  const expires = Math.floor(Date.now() / 1000) + r.expires_in;
  db.prepare("UPDATE accounts SET token = ?, token_expires = ? WHERE id = ?").run(r.access_token, expires, acc.id);
  return r.access_token;
}

// المقاييس المتاحة تختلف حسب نوع البوست
const METRICS = {
  REELS: ["views", "reach", "saved", "shares", "total_interactions", "likes", "comments", "ig_reels_avg_watch_time"],
  FEED: ["views", "reach", "saved", "shares", "total_interactions", "likes", "comments", "profile_visits", "follows"],
};

async function mediaInsights(m, token) {
  const wanted = METRICS[m.media_product_type] || METRICS.FEED;
  const read = (data) => Object.fromEntries(data.map((d) => [d.name, d.values?.[0]?.value ?? d.total_value?.value]));
  try {
    return read((await ig(`/${m.id}/insights`, { metric: wanted.join(",") }, token)).data);
  } catch (e) {
    // حد الطلبات أو توكن منتهي: نوقف بدل ما نسوي ٩ طلبات زيادة
    if ([4, 17, 32, 190].includes(e.code)) throw e;
    // لو مقياس واحد غير مدعوم يفشل الطلب كله — نجرب كل مقياس لحاله
    const out = {};
    for (const metric of wanted) {
      try { Object.assign(out, read((await ig(`/${m.id}/insights`, { metric }, token)).data)); } catch {}
    }
    return out;
  }
}

const MEDIA_FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,is_shared_to_feed";

function mediaRow(m, accountId) {
  return {
    id: m.id, account_id: accountId, caption: m.caption || "", media_type: m.media_type,
    product_type: m.media_product_type, media_url: m.media_url, thumbnail_url: m.thumbnail_url,
    permalink: m.permalink, timestamp: m.timestamp, likes: m.like_count, comments: m.comments_count,
    // الريل التجريبي (Trial) ما ينشارك لمتابعينك لين تنقله للعامة، وقتها يصير true ويرجع للأرقام.
    // الريلز القديمة (قبل ٢٠٢٥) كان فيها خيار «لا تنشره في الصفحة» وهي عامة، فنحسب بس آخر ٩٠ يوم
    trial: m.media_product_type === "REELS" && m.is_shared_to_feed === false && Date.now() - Date.parse(m.timestamp) < 90 * 864e5 ? 1 : 0,
  };
}

// بس الأرقام اللي رجعت فعلاً: لو Meta ما ردّت (حد الطلبات مثلاً) ما نمسح الأرقام القديمة بـ null
function withInsights(row, m, ins) {
  const got = {
    views: ins.views, reach: ins.reach, saved: ins.saved, shares: ins.shares,
    total_interactions: ins.total_interactions, profile_visits: ins.profile_visits, follows: ins.follows,
    avg_watch_time: ins.ig_reels_avg_watch_time != null ? ins.ig_reels_avg_watch_time / 1000 : undefined,
    likes: ins.likes ?? m.like_count, comments: ins.comments ?? m.comments_count,
  };
  for (const k of Object.keys(got)) if (got[k] === undefined) delete got[k];
  if (Object.keys(ins).length) got.synced_at = Math.floor(Date.now() / 1000);
  return Object.assign(row, got);
}

// البوستات اللي مسحتها من انستجرام: أي بوست عندنا من نفس الفترة اللي رجعت وما هو فيها، نشيله (مع لقطاته وتعليقاته)
// عشان ما يدخل في الأرقام ولا نظل نطلب تعليقاته. «from» أقدم بوست رجع، فاللي أقدم منه ما نلمسه
function dropDeleted(accountId, got) {
  if (!got.length) return;
  // احتياط: لازم القائمة مرتبة من الأحدث للأقدم، وإلا ما نمسح شي
  if (got.some((m, i) => i && m.timestamp > got[i - 1].timestamp)) return;
  const from = got.at(-1).timestamp;
  const seen = new Set(got.map((m) => m.id));
  const gone = db.prepare("SELECT id FROM media WHERE account_id = ? AND timestamp >= ?").all(accountId, from).map((r) => r.id).filter((id) => !seen.has(id));
  // احتياط ثاني: لو طلع أكثر من ٥ مرة وحدة غالباً الرد ناقص، فما نمسح ونكتب في السجل
  if (gone.length > 5) return console.error(`بوستات ما رجعت من انستجرام: ${gone.length}، ما انمسحت (احتياط)`);
  for (const id of gone) {
    db.prepare("DELETE FROM snapshots WHERE media_id = ?").run(id);
    // تعليقاته تنشال بعد، إلا اللي انحفظ فيها إن العميل سجّل (عشان ما تضيع من المبيعات)
    db.prepare("DELETE FROM comments WHERE media_id = ? AND outcome IS NULL").run(id);
    db.prepare("DELETE FROM media WHERE id = ?").run(id);
  }
  if (gone.length) console.log(`انشال ${gone.length} بوست انمسح من انستجرام`);
}

async function syncMedia(acc, token, onProgress) {
  let page = await ig("/me/media", { fields: MEDIA_FIELDS, limit: 50 }, token);
  const all = [];
  while (page) {
    all.push(...page.data);
    page = page.paging?.next && all.length < 500 ? await ig(page.paging.next, {}, token) : null;
  }

  const known = new Map(db.prepare("SELECT id, synced_at, timestamp FROM media WHERE account_id = ?").all(acc.id).map((r) => [r.id, r]));
  let done = 0;
  for (const m of all) {
    done++;
    // البوستات الأقدم من 45 يوم أرقامها ثابتة تقريباً — ما نعيد سحبها كل مرة
    const prev = known.get(m.id);
    const ageDays = (Date.now() - Date.parse(m.timestamp)) / 864e5;
    // واللي ما انسحبت أرقامه أبد (فشل أول مرة) نعيده مهما كان عمره
    const stale = !prev || prev.synced_at == null || (ageDays < 45 && Date.now() / 1000 - prev.synced_at > 6 * 3600);
    const row = mediaRow(m, acc.id);
    if (stale) withInsights(row, m, await mediaInsights(m, token));
    upsert("media", row, ["id"]);
    onProgress?.(`البوستات ${done}/${all.length}`);
  }
  dropDeleted(acc.id, all);
}

const isoDay = (t) => new Date(t * 1000).toISOString().slice(0, 10);
// لقطة عدد المتابعين تنحفظ بتاريخ اليوم بتوقيتك (بين ١٢ و٣ بالليل كانت تنحسب على أمس)
const localDay = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TIMEZONE || "Asia/Riyadh" }).format(new Date(t * 1000));

async function syncDaily(acc, token, followersNow) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - 29 * DAY;

  // سلاسل يومية: الوصول وصافي المتابعين الجدد (آخر 30 يوم فقط من Meta)
  // Meta تحسب اليوم بتوقيت المحيط الهادي، و end_time = نهاية اليوم (منتصف الليل اللي بعده)، فاليوم نفسه = end_time ناقص يوم
  const dayOf = (end) => new Date(Date.parse(end) - DAY * 1000).toISOString().slice(0, 10);
  const ends = new Set();
  for (const metric of ["reach", "follower_count"]) {
    try {
      const r = await ig(`/${acc.id}/insights`, { metric, period: "day", since, until }, token);
      for (const v of r.data[0]?.values || []) {
        ends.add(v.end_time);
        upsert("daily", { account_id: acc.id, date: dayOf(v.end_time), [metric === "reach" ? "reach" : "new_followers"]: v.value }, ["account_id", "date"]);
      }
    } catch {}
  }

  // مقاييس إجمالية لكل يوم (مشاهدات، زيارات البروفايل، نقرات الرابط)، بنفس أيام Meta فوق
  // نقرات الرابط = website_clicks (رابط البايو) + profile_links_taps (أزرار الاتصال والإيميل والعنوان)
  // اليوم اللي انحفظ ما نطلبه مرة ثانية، إلا آخر ٣ أيام لأن Meta تكمّل أرقامها متأخر
  const have = new Set(db.prepare("SELECT date FROM daily WHERE account_id = ? AND views IS NOT NULL AND link_ok = 1").all(acc.id).map((r) => r.date));
  const fresh = isoDay(until - 3 * DAY);
  for (const end of [...ends].sort()) {
    const u = Math.floor(Date.parse(end) / 1000), date = dayOf(end);
    if (u > until || (have.has(date) && date < fresh)) continue;
    try {
      const r = await ig(`/${acc.id}/insights`, {
        // since بالضبط على منتصف الليل يدخّل اليوم اللي قبله بعد، فنبدأ بعده بثانية
        metric: "views,profile_views,website_clicks,profile_links_taps", metric_type: "total_value", period: "day", since: u - DAY + 1, until: u,
      }, token);
      const val = (n) => r.data.find((d) => d.name === n)?.total_value?.value ?? 0;
      upsert("daily", { account_id: acc.id, date, views: val("views"), profile_views: val("profile_views"), link_taps: val("website_clicks") + val("profile_links_taps"), link_ok: 1 }, ["account_id", "date"]);
    } catch { break; }
  }

  // تابعوك وألغوا متابعتك كل يوم (Meta تعطيها للحسابات اللي فوق ١٠٠ متابع). نفس قاعدة الأيام فوق
  const haveFu = new Set(db.prepare("SELECT date FROM daily WHERE account_id = ? AND unfollows IS NOT NULL").all(acc.id).map((r) => r.date));
  for (const end of [...ends].sort()) {
    const u = Math.floor(Date.parse(end) / 1000), date = dayOf(end);
    if (u > until || (haveFu.has(date) && date < fresh)) continue;
    try {
      const r = await ig(`/${acc.id}/insights`, { metric: "follows_and_unfollows", metric_type: "total_value", breakdown: "follow_type", period: "day", since: u - DAY + 1, until: u }, token);
      const res = r.data[0]?.total_value?.breakdowns?.[0]?.results || [];
      const v = (k) => res.find((x) => x.dimension_values[0] === k)?.value ?? 0;
      upsert("daily", { account_id: acc.id, date, follows: v("FOLLOWER"), unfollows: v("NON_FOLLOWER") }, ["account_id", "date"]);
    } catch { break; }
  }

  // عدد المتابعين الحالي محفوظ كلقطة لليوم — مع الوقت يتكون عندك تاريخ أطول من 30 يوم
  upsert("daily", { account_id: acc.id, date: localDay(until), followers: followersNow }, ["account_id", "date"]);

  // تواجد المتابعين بالساعة: بدون since/until ترجع Meta آخر يومين بس وغالباً فاضية، فنطلب آخر ٣٠ يوم ونحسب متوسط الأيام اللي فيها أرقام.
  // الساعات من Meta بتوقيت المحيط الهادي (من بداية يومها)، فنحوّل كل ساعة لتوقيتك
  try {
    const r = await ig(`/${acc.id}/insights`, { metric: "online_followers", period: "lifetime", since, until }, token);
    const hourIn = new Intl.DateTimeFormat("en-US", { timeZone: process.env.TIMEZONE || "Asia/Riyadh", hour: "numeric", hourCycle: "h23" });
    const hours = Array(24).fill(0);
    let days = 0;
    for (const d of r.data[0]?.values || []) {
      const vals = Object.entries(d.value || {});
      if (!vals.length) continue;
      days++;
      const start = Date.parse(d.end_time) - DAY * 1000;
      for (const [h, v] of vals) hours[+hourIn.format(new Date(start + h * 3600000))] += v;
    }
    if (days) db.prepare("UPDATE accounts SET online_followers = ? WHERE id = ?").run(JSON.stringify(hours.map((v) => Math.round(v / days))), acc.id);
  } catch {}
}

export async function syncAccount(id, onProgress) {
  const acc = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!acc || acc.is_demo) return;
  const token = await refreshTokenIfNeeded(acc);
  const me = await ig("/me", { fields: "username,name,profile_picture_url,followers_count" }, token);
  db.prepare("UPDATE accounts SET username = ?, name = ?, picture = ?, followers = ? WHERE id = ?")
    .run(me.username, me.name, me.profile_picture_url, me.followers_count, id);
  onProgress?.("الإحصائيات اليومية");
  await syncDaily(acc, token, me.followers_count);
  unfollowAlerts(id);
  onProgress?.("الجمهور");
  // مين جمهورك (مرة باليوم). فشلها ما يوقف باقي المزامنة
  try { await syncAudience(acc, token); } catch (e) { if (e.code === 190) throw e; console.error("الجمهور:", e.message); }
  await syncMedia(acc, token, onProgress);
  onProgress?.("الستوري");
  await syncStories(id, token);
  onProgress?.("التعليقات");
  await syncComments(acc, token, 60);
  onProgress?.("المنافسين");
  // توكن ثاني (فيسبوك)، فخطأه ما يوقف المزامنة
  try { await syncCompetitors(id); } catch (e) { console.error("المنافسين:", e.message); }
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE accounts SET last_sync = ?, last_full_sync = ? WHERE id = ?").run(now, now, id);
}

// تحديث خفيف كل دقيقتين: المتابعين، والبوستات الجديدة، وأرقام بوستات آخر 3 أيام (اللي أرقامها لسا تتحرك)
export async function quickSync(id) {
  const acc = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!acc || acc.is_demo) return;
  const token = await refreshTokenIfNeeded(acc);
  const me = await ig("/me", { fields: "followers_count" }, token);
  db.prepare("UPDATE accounts SET followers = ? WHERE id = ?").run(me.followers_count, id);
  upsert("daily", { account_id: id, date: localDay(Date.now() / 1000), followers: me.followers_count }, ["account_id", "date"]);

  const known = new Set(db.prepare("SELECT id FROM media WHERE account_id = ?").all(id).map((r) => r.id));
  const page = await ig("/me/media", { fields: MEDIA_FIELDS, limit: 25 }, token);
  for (const m of page.data) {
    const row = mediaRow(m, id);
    const ageMin = Math.round((Date.now() - Date.parse(m.timestamp)) / 60000);
    if (!known.has(m.id) || ageMin < 3 * 1440) withInsights(row, m, await mediaInsights(m, token));
    upsert("media", row, ["id"]);
    // أول ٦ ساعات: نحفظ لقطة من الأرقام عشان تنبيه وقت النشر
    if (ageMin <= 360 && row.reach != null) {
      upsert("snapshots", { media_id: m.id, account_id: id, age_min: ageMin, reach: row.reach, views: row.views, saved: row.saved, shares: row.shares, profile_visits: row.profile_visits }, ["media_id", "age_min"]);
    }
  }
  dropDeleted(id, page.data);
  checkPostAlerts(id);
  await syncStories(id, token);
  await syncComments(acc, token, 7);
  await syncTagged(acc, token);
  db.prepare("UPDATE accounts SET last_sync = ? WHERE id = ?").run(Math.floor(Date.now() / 1000), id);
}

// الستوري: Meta تعطي أرقامها 24 ساعة بس، فنسحبها كل دقيقتين ونحفظ آخر قراءة قبل ما تختفي
// نقرات ملصق الرابط ما يعطيها Instagram API للستوري (link_clicks مرفوض)، فما نطلبها
const STORY_METRICS = ["views", "reach", "replies", "shares", "follows", "profile_visits", "total_interactions"];
const NAV = { tap_forward: "taps_forward", tap_back: "taps_back", tap_exit: "exits", swipe_forward: "swipes" };

async function storyInsights(id, token) {
  const out = {};
  const read = (data) => data.forEach((d) => (out[d.name] = d.values?.[0]?.value ?? d.total_value?.value));
  try {
    read((await ig(`/${id}/insights`, { metric: STORY_METRICS.join(",") }, token)).data);
  } catch {
    // لو الستوري شافها أقل من 5 أشخاص، Meta ترفض بعض المقاييس — نجرب كل واحد لحاله
    for (const metric of STORY_METRICS) {
      try { read((await ig(`/${id}/insights`, { metric }, token)).data); } catch {}
    }
  }
  try {
    const r = await ig(`/${id}/insights`, { metric: "navigation", breakdown: "story_navigation_action_type" }, token);
    for (const b of r.data[0]?.total_value?.breakdowns?.[0]?.results || []) {
      const col = NAV[b.dimension_values[0]?.toLowerCase()];
      if (col) out[col] = b.value;
    }
  } catch {}
  return out;
}

async function saveStoryImage(s) {
  const src = s.media_type === "VIDEO" ? s.thumbnail_url : s.media_url;
  if (!src) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const file = `${s.id}.jpg`;
    await writeFile(`data/stories/${file}`, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch { return null; }
}

async function syncStories(accountId, token) {
  const r = await ig("/me/stories", { fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp,caption" }, token);
  const saved = new Map(db.prepare("SELECT id, image FROM stories WHERE account_id = ?").all(accountId).map((x) => [x.id, x.image]));
  for (const s of r.data || []) {
    const ins = await storyInsights(s.id, token);
    const row = {
      id: s.id, account_id: accountId, media_type: s.media_type, caption: s.caption || "",
      permalink: s.permalink, timestamp: s.timestamp, synced_at: Math.floor(Date.now() / 1000),
      image: saved.get(s.id) || (await saveStoryImage(s)),
    };
    // نحفظ بس الأرقام اللي وصلت، عشان قراءة ناقصة ما تمسح قراءة سابقة كاملة
    for (const k of [...STORY_METRICS, ...Object.values(NAV)]) if (ins[k] != null) row[k] = ins[k];
    upsert("stories", row, ["id"]);
  }
}

// Meta ما ترجع اسم صاحب الرد داخل التعليق، فنسأل عن كل رد لحاله (بس للتعليقات اللي فيها نية)
async function ownerReplied(replies, username, token) {
  const users = await Promise.all(replies.map((r) => ig(`/${r.id}`, { fields: "username" }, token).then((x) => x.username, () => null)));
  return users.includes(username) ? 1 : 0;
}

// التعليقات: نسحب تعليقات البوستات الحديثة، نفرزها حسب نية الشراء، ونعرف إذا رديت عليها
async function syncComments(acc, token, maxAgeDays) {
  const posts = db.prepare("SELECT id FROM media WHERE account_id = ? AND comments > 0 AND timestamp >= ?")
    .all(acc.id, new Date(Date.now() - maxAgeDays * 864e5).toISOString().slice(0, 19));
  const fields = "id,text,timestamp,from,username,replies{id}";
  let got = 0;
  const fresh = []; // تعليقات جديدة فيها نية شراء (للتنبيه)
  let sent = [];   // اللي وصلتهم رسالة خاص تلقائية
  // اللي يكتب كلمتك بس (cta_word) عميل يبي التفاصيل
  const keyword = keywordTest(acc.id);
  // التنبيه يطلع حتى لو المزامنة الكاملة هي اللي لقت التعليق، أو وقفت بالنص (حد الطلبات)
  try {
  for (const post of posts) {
    // بوست انحذف من انستجرام أو فشل طلبه ما يوقف باقي التعليقات
    let page;
    try { page = await ig(`/${post.id}/comments`, { fields, limit: 50 }, token); } catch (e) {
      if (e.code === 4 || e.code === 17 || e.code === 32) throw e;
      console.error("تعليقات بوست:", e.message);
      continue;
    }
    for (let n = 0; page && n < 10; n++) {
      for (const c of page.data || []) {
        const user = c.from?.username || c.username;
        if (user === acc.username) continue;
        got++;
        const intent = classify(c.text) || (keyword(c.text) ? "تسجيل" : null);
        const seen = db.prepare("SELECT replied FROM comments WHERE id = ?").get(c.id);
        let replied = seen?.replied || 0;
        if (!seen && (intent === "سعر" || intent === "تسجيل")) fresh.push({ id: c.id, media_id: post.id, intent, timestamp: c.timestamp });
        if (!replied && intent && c.replies?.data?.length) replied = await ownerReplied(c.replies.data, acc.username, token);
        upsert("comments", {
          id: c.id, account_id: acc.id, media_id: post.id, username: user, text: c.text,
          timestamp: c.timestamp, intent, replied,
        }, ["id"]);
        if (replied && !seen?.replied) db.prepare("UPDATE comments SET replied_at = COALESCE(replied_at, ?) WHERE id = ?").run(Math.floor(Date.now() / 1000), c.id);
      }
      page = page.paging?.next ? await ig(page.paging.next, {}, token) : null;
    }
  }
  try { sent = await runAutoDm(acc, token); } catch (e) { if (e.code === 190) throw e; console.error("رسائل الخاص التلقائية:", e.message); }
  } finally { alertLeads(acc.id, fresh, sent); }
  // Meta ترجع قائمة فاضية (بدون خطأ) إذا التوكن ما فيه صلاحية التعليقات
  if (posts.length) db.prepare("UPDATE accounts SET comments_ok = ? WHERE id = ?").run(got ? 1 : 0, acc.id);
  return fresh;
}

// رد على تعليق من اللوحة: ينزل كرد عام تحت التعليق في انستجرام
export async function replyToComment(commentId, text) {
  const c = db.prepare("SELECT c.id, c.account_id, a.token, a.is_demo FROM comments c JOIN accounts a ON a.id = c.account_id WHERE c.id = ?").get(commentId);
  if (!c) throw new Error(L("التعليق مو موجود", "Comment not found"));
  const message = String(text || "").trim();
  if (!message) throw new Error(L("اكتب الرد", "Write a reply"));
  if (message.length > 2200) throw new Error(L("الرد طويل", "The reply is too long"));
  if (!c.is_demo) await ig(`/${c.id}/replies`, { message }, c.token, "POST");
  db.prepare("UPDATE comments SET replied = 1, replied_at = COALESCE(replied_at, ?) WHERE id = ?").run(Math.floor(Date.now() / 1000), c.id);
  return { ok: true, demo: !!c.is_demo };
}
