// حساب المقاييس لفترة معينة ومقارنتها بالفترة اللي قبلها مباشرة
import { db } from "./db.js";
import { hashtagStats } from "./hashtags.js";
import { stage, dueLeads, pipelineKpis } from "./leads.js";
import { topicStats } from "./topics.js";
import { watchStats } from "./watch.js";
import { audienceReport } from "./audience.js";
import { unfollowSpikes } from "./unfollows.js";
import { taggedList } from "./tagged.js";
import { competitorsReport } from "./competitors.js";

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const TYPE_NAMES = { REELS: "ريلز", CAROUSEL_ALBUM: "كاروسيل", IMAGE: "صورة", VIDEO: "فيديو" };

const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);
const avg = (arr, k) => {
  const v = arr.filter((x) => x[k] != null);
  return v.length ? sum(v, k) / v.length : null;
};

function localParts(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), hour: +p.hour };
}

function enrich(m) {
  const interactions = m.total_interactions ?? (m.likes || 0) + (m.comments || 0) + (m.saved || 0) + (m.shares || 0);
  const kind = m.product_type === "REELS" ? "REELS" : m.media_type;
  return {
    ...m,
    kind,
    kind_name: TYPE_NAMES[kind] || kind,
    interactions,
    // نسبة التفاعل من الوصول
    er: m.reach ? interactions / m.reach : null,
    // مؤشر الاهتمام بالشراء: الحفظ والمشاركة وزيارة البروفايل والمتابعة أقرب للبيع من الإعجاب
    intent: m.reach ? ((m.saved || 0) + 1.5 * (m.shares || 0) + 2 * (m.profile_visits || 0) + 3 * (m.follows || 0)) / m.reach : null,
    // للمقارنة بين الأنواع: الحفظ والمشاركة بس، لأن Meta ما تعطي زيارات البروفايل والمتابعة للريلز
    fair: m.reach ? ((m.saved || 0) + 1.5 * (m.shares || 0)) / m.reach : null,
    ...localParts(m.timestamp),
  };
}

function postsBetween(accountId, from, to) {
  return db.prepare(`SELECT * FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial
    AND timestamp >= ? AND timestamp < ? ORDER BY timestamp`)
    .all(accountId, localStart(from), localStart(nextDay(to))).map(enrich);
}

// أول لحظة في اليوم بتوقيتك (الرياض) بصيغة UTC، عشان نقارنها بأوقات انستجرام (UTC)
// بدونها البوست اللي نزل بعد ١٢ بالليل بتوقيتك ينحسب على اليوم اللي قبله
export function localStart(day) {
  const guess = Date.parse(day + "T00:00:00Z");
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess;
  return new Date(guess - offset).toISOString().slice(0, 19);
}

function nextDay(d, n = 1) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;

// عدد المتابعين في نهاية اليوم اللي قبل from
const startFollowers = (accountId, from) =>
  db.prepare("SELECT followers FROM daily WHERE account_id = ? AND date = ? AND followers IS NOT NULL").get(accountId, nextDay(from, -1))?.followers ?? null;

function dailyBetween(accountId, from, to) {
  return db.prepare("SELECT * FROM daily WHERE account_id = ? AND date >= ? AND date <= ? ORDER BY date").all(accountId, from, to);
}

// نمو المتابعين: الصافي إذا عندنا عددهم في نهاية اليوم اللي قبل الفترة (start)، وإلا مجموع المتابعات الجديدة (بدون اللي ألغوا)
// عدد المتابعين لأي يوم = آخر قراءة فيه، يعني نهاية اليوم. فالبداية الصح = نهاية اليوم اللي قبل الفترة
// وإذا الأرقام اليومية تغطي أقل من ٧٠٪ من الفترة (Meta تعطي آخر ٣٠ يوم بس) ما نحسبه، عشان المقارنة ما تطلع غلط
function followerGrowth(daily, from, days, start) {
  const covered = daily.filter((d) => d.followers != null || d.new_followers != null);
  if (!days || covered.length < days * 0.7) return { value: null, net: false };
  const snaps = daily.filter((d) => d.followers != null);
  if (start != null && snaps.length) return { value: snaps.at(-1).followers - start, net: true, days: daysBetween(nextDay(from, -1), snaps.at(-1).date) - 1 };
  // Meta تتأخر يومين في المتابعات الجديدة (آخر يومين يجون صفر)، فما نحسبهم
  const lag = nextDay(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()), -2);
  const gross = daily.filter((d) => d.new_followers != null && d.date <= lag);
  return { value: gross.length ? sum(gross, "new_followers") : null, net: false, days: gross.length };
}

// مجموع عمود يومي بس إذا الأيام اللي فيها رقم تغطي ٧٠٪ من الفترة، وإلا null (عشان المقارنة ما تطلع ▼١٠٠٪ من نقص البيانات)
function dailySum(daily, key, days, ok = (d) => d[key] != null) {
  const have = daily.filter(ok);
  return days && have.length >= days * 0.7 ? sum(have, key) : null;
}

// تابعوك وألغوا: بدون آخر يومين (Meta تكمّلهم متأخر)، وبس إذا الأيام تغطي ٧٠٪ من الباقي
function followFlow(daily, days) {
  const lag = nextDay(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()), -2);
  const have = daily.filter((d) => d.unfollows != null && d.date <= lag);
  const span = Math.min(days, daily.filter((d) => d.date <= lag).length || days);
  if (!have.length || have.length < span * 0.7) return { follows: null, unfollows: null, unfollow_rate: null };
  const f = sum(have, "follows"), u = sum(have, "unfollows");
  return { follows: f, unfollows: u, unfollow_rate: f ? u / f : null, flow_days: have.length };
}

function kpis(posts, daily, from, days, start) {
  const fg = followerGrowth(daily, from, days, start);
  // المتوسطات من البوستات اللي مر عليها يومين (أرقام البوست الجديد لسا تطلع)، إلا إذا كلها جديدة
  const old = posts.filter((p) => Date.now() - Date.parse(p.timestamp) >= 2 * 864e5);
  const settled = old.length ? old : posts;
  return {
    posts: posts.length,
    reach: sum(posts, "reach"),
    avg_reach: avg(settled, "reach"),
    avg_er: avg(settled, "er"),
    saved: sum(posts, "saved"),
    shares: sum(posts, "shares"),
    // زيارات البروفايل ونقرات الرابط من أرقام الحساب اليومية (البوستات ما تعطيها للريلز)
    profile_visits: dailySum(daily, "profile_views", days, (d) => d.profile_views != null && d.link_ok === 1),
    link_taps: dailySum(daily, "link_taps", days, (d) => d.link_ok === 1),
    account_reach: dailySum(daily, "reach", days),
    follower_growth: fg.value, follower_net: fg.net, follower_days: fg.days || null,
    avg_fair: avg(settled, "fair"),
    avg_intent: avg(settled, "intent"),
    ...followFlow(daily, days),
  };
}

function groupBy(posts, key) {
  const g = {};
  for (const p of posts) (g[p[key]] ||= []).push(p);
  return g;
}

// الستوري: الإجراء = رد + زيارة بروفايل + نقرة رابط + متابعة + مشاركة، والخروج = اللي سكّروا الستوري
function storiesBetween(accountId, from, to) {
  return db.prepare("SELECT * FROM stories WHERE account_id = ? AND timestamp >= ? AND timestamp < ? ORDER BY timestamp")
    .all(accountId, localStart(from), localStart(nextDay(to))).map((s) => {
      const actions = (s.replies || 0) + (s.profile_visits || 0) + (s.link_clicks || 0) + (s.follows || 0) + (s.shares || 0);
      return {
        ...s, actions, ...localParts(s.timestamp),
        action_rate: s.reach ? actions / s.reach : null,
        exit_rate: s.reach && s.exits != null ? s.exits / s.reach : null,
        local_date: new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(s.timestamp)),
      };
    });
}

function storyKpis(list) {
  const days = new Set(list.map((s) => s.local_date)).size;
  return {
    count: list.length, days,
    avg_reach: avg(list, "reach"),
    avg_action_rate: avg(list, "action_rate"),
    avg_exit_rate: avg(list, "exit_rate"),
    replies: sum(list, "replies"), profile_visits: sum(list, "profile_visits"),
    link_clicks: sum(list, "link_clicks"), follows: sum(list, "follows"),
  };
}

// كم يبقى من المشاهدين مع كل ستوري جديدة في نفس اليوم (الأولى = ١٠٠٪)
function storyRetention(list) {
  const pos = [];
  for (const day of Object.values(groupBy(list, "local_date"))) {
    const first = day[0].reach;
    if (!first || day.length < 2) continue;
    day.forEach((s, i) => s.reach != null && (pos[i] ||= []).push(s.reach / first));
  }
  return pos.map((v, i) => ({ position: i + 1, days: v.length, kept: v.reduce((a, b) => a + b, 0) / v.length }))
    .filter((p) => p.days >= 2);
}

// التعليقات اللي فيها نية شراء (سعر/تسجيل) أو سؤال — العملاء المحتملين
function commentsBetween(accountId, from, to) {
  return db.prepare(`SELECT c.*, m.caption, m.permalink FROM comments c LEFT JOIN media m ON m.id = c.media_id
    WHERE c.account_id = ? AND c.timestamp >= ? AND c.timestamp < ? ORDER BY c.timestamp DESC`)
    .all(accountId, localStart(from), localStart(nextDay(to)));
}

function commentKpis(list) {
  const leads = list.filter((c) => c.intent === "سعر" || c.intent === "تسجيل");
  const answered = leads.filter((c) => c.replied || c.handled || c.outcome).length;
  return {
    total: list.length, leads: leads.length, questions: list.filter((c) => c.intent === "سؤال").length,
    open: leads.length - answered, reply_rate: leads.length ? answered / leads.length : null,
  };
}

// المبيعات: كل تسجيل مربوط ببوست ينحسب له كامل، والباقي يتوزع بالتساوي على البوستات
// اللي نزلت خلال ٣ أيام قبله (تقدير، مو تتبع دقيق). الإحالة والإعلان الممول ما تنحسب على المحتوى
const SALE_WINDOW = 3;
const OFF_CONTENT = ["إحالة أو معرفة", "إعلان ممول"];
const localDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

function salesBetween(accountId, from, to) {
  return db.prepare("SELECT * FROM sales WHERE account_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, id DESC").all(accountId, from, to);
}

function salesKpis(list) {
  const count = sum(list, "count");
  const priced = list.filter((x) => x.amount != null);
  const revenue = priced.length ? sum(priced, "amount") : null;
  return { entries: list.length, count, revenue, avg_value: revenue != null && sum(priced, "count") ? revenue / sum(priced, "count") : null };
}

function attributeSales(accountId, sales, from, to) {
  const posts = postsBetween(accountId, nextDay(from, -SALE_WINDOW), to).map((p) => ({ ...p, local_date: localDate(p.timestamp), attributed: 0, direct: 0 }));
  const byId = Object.fromEntries(posts.map((p) => [p.id, p]));
  let unattributed = 0;
  for (const x of sales) {
    if (x.media_id && byId[x.media_id]) { byId[x.media_id].attributed += x.count; byId[x.media_id].direct += x.count; continue; }
    if (OFF_CONTENT.includes(x.source)) continue;
    const start = nextDay(x.date, -(SALE_WINDOW - 1));
    const near = posts.filter((p) => p.local_date >= start && p.local_date <= x.date);
    if (!near.length) { unattributed += x.count; continue; }
    for (const p of near) p.attributed += x.count / near.length;
  }
  return { posts, unattributed };
}

// prev: فترة المقارنة لو تبيها غير «نفس الطول قبلها مباشرة» (مثل الشهر اللي قبله كامل)
export function report(accountId, from, to, prev = null) {
  const len = daysBetween(from, to);
  const prevTo = prev?.to || nextDay(from, -1);
  const prevFrom = prev?.from || nextDay(prevTo, -(len - 1));

  const posts = postsBetween(accountId, from, to);
  const daily = dailyBetween(accountId, from, to);
  const prevPosts = postsBetween(accountId, prevFrom, prevTo);
  const prevDaily = dailyBetween(accountId, prevFrom, prevTo);

  const byType = Object.entries(groupBy(posts, "kind")).map(([kind, list]) => ({
    kind, name: list[0].kind_name, count: list.length,
    avg_reach: avg(list, "reach"), avg_er: avg(list, "er"), avg_intent: avg(list, "intent"), avg_fair: avg(list, "fair"),
    avg_saved: avg(list, "saved"), avg_shares: avg(list, "shares"),
  })).sort((a, b) => (b.avg_fair || 0) - (a.avg_fair || 0));

  // خريطة الأوقات: متوسط التفاعل لكل يوم × فترة (4 ساعات)
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 6 }, () => ({ n: 0, er: 0 })));
  for (const p of posts) if (p.er != null) {
    const c = heat[p.day][Math.floor(p.hour / 4)];
    c.n++; c.er += p.er;
  }
  const heatmap = heat.map((row) => row.map((c) => (c.n ? { n: c.n, er: c.er / c.n } : null)));

  // أفضل فترة نشر: من آخر ٣ شهور دايماً (نفس خطة النشر)، عشان ما تتغير النصيحة لما تغير فترة اللوحة
  const slotList = Array.from({ length: 6 }, () => []);
  for (const p of postsBetween(accountId, nextDay(to, -89), to)) if (p.er != null) slotList[Math.floor(p.hour / 4)].push(p.er);
  const time_slots = slotList.map((v, s) => ({ s, count: v.length, er: v.length ? v.reduce((x, y) => x + y, 0) / v.length : null }));

  // الأنجح والأضعف بالحفظ والمشاركة، عشان الترتيب ما يظلم الريلز (ما لها زيارات بروفايل ومتابعة من Meta)
  const ranked = posts.filter((p) => p.fair != null).sort((a, b) => b.fair - a.fair);
  const slim = (p) => ({
    id: p.id, kind: p.kind, kind_name: p.kind_name, caption: p.caption, permalink: p.permalink,
    image: p.thumbnail_url || p.media_url, timestamp: p.timestamp,
    reach: p.reach, views: p.views, likes: p.likes, comments: p.comments, saved: p.saved, shares: p.shares,
    profile_visits: p.profile_visits, follows: p.follows, avg_watch_time: p.avg_watch_time, er: p.er, intent: p.intent, fair: p.fair,
  });

  const stories = storiesBetween(accountId, from, to);
  const slimStory = (x) => ({
    id: x.id, media_type: x.media_type, timestamp: x.timestamp, image: x.image, permalink: x.permalink,
    views: x.views, reach: x.reach, replies: x.replies, shares: x.shares, follows: x.follows,
    profile_visits: x.profile_visits, link_clicks: x.link_clicks, exits: x.exits, taps_forward: x.taps_forward,
    actions: x.actions, action_rate: x.action_rate, exit_rate: x.exit_rate, hour: x.hour,
    live: Date.now() - Date.parse(x.timestamp) < 864e5,
  });

  const sales = salesBetween(accountId, from, to);
  const attr = attributeSales(accountId, sales, from, to);
  const inPeriod = attr.posts.filter((p) => p.local_date >= from);
  const salesByType = Object.entries(groupBy(inPeriod, "kind")).map(([kind, list]) => ({
    kind, name: list[0].kind_name, posts: list.length, attributed: sum(list, "attributed"),
    per_post: sum(list, "attributed") / list.length, avg_reach: avg(list, "reach"),
  })).sort((a, b) => b.per_post - a.per_post);
  const bySource = Object.entries(groupBy(sales, "source")).map(([source, list]) => ({ source, count: sum(list, "count"), revenue: sum(list, "amount") }))
    .sort((a, b) => b.count - a.count);

  const acc = db.prepare("SELECT id, username, name, picture, followers, business, goal, online_followers, last_sync, is_demo, comments_ok FROM accounts WHERE id = ?").get(accountId);
  const comments = commentsBetween(accountId, from, to);
  const rank = { "سعر": 0, "تسجيل": 1, "سؤال": 2 };
  const stageRank = { "يحتاج متابعة": 0, "جديد": 1, "رديت": 2, "سجّل": 3, "ما سجّل": 4 };
  // اللي يحتاجون متابعة يطلعون حتى لو علّقوا قبل الفترة المختارة
  const due = dueLeads(accountId);
  const inList = new Set(comments.map((c) => c.id));
  const withStage = comments.concat(due.filter((c) => !inList.has(c.id))).filter((c) => c.intent).map((c) => ({ ...c, stage: stage(c) }));

  return {
    account: { ...acc, online_followers: (() => { const o = acc.online_followers ? JSON.parse(acc.online_followers) : null; return o?.some((v) => v > 0) ? o : null; })() },
    period: { from, to, days: len, prev_from: prevFrom, prev_to: prevTo, timezone: TZ },
    audience: audienceReport(accountId),
    kpis: kpis(posts, daily, from, len, startFollowers(accountId, from)),
    prev_kpis: kpis(prevPosts, prevDaily, prevFrom, daysBetween(prevFrom, prevTo), startFollowers(accountId, prevFrom)),
    followers_series: daily.map((d) => ({ date: d.date, followers: d.followers, new_followers: d.new_followers, reach: d.reach, follows: d.follows, unfollows: d.unfollows })),
    unfollow_spikes: unfollowSpikes(accountId, from, to),
    tagged: taggedList(accountId),
    competitors: competitorsReport(accountId),
    by_type: byType,
    heatmap, time_slots,
    reels: posts.filter((p) => p.kind === "REELS").map(slim).sort((a, b) => (b.views || 0) - (a.views || 0)),
    // الريلز التجريبية (Trial): برا كل الأرقام لين تنقلها للعامة، نعرضها لحالها
    trials: db.prepare("SELECT * FROM media WHERE account_id = ? AND trial ORDER BY timestamp DESC LIMIT 20").all(accountId).map(enrich).map(slim),
    top: ranked.slice(0, 6).map(slim),
    bottom: ranked.slice(-6).reverse().filter((p) => !ranked.slice(0, 6).includes(p)).map(slim),
    posts: posts.map(slim),
    comments: {
      kpis: commentKpis(comments),
      prev_kpis: commentKpis(commentsBetween(accountId, prevFrom, prevTo)),
      pipeline: pipelineKpis(comments),
      prev_pipeline: pipelineKpis(commentsBetween(accountId, prevFrom, prevTo)),
      due: due.length,
      // يحتاج متابعة أول، وبعدها الجديد، وبعدها حسب النوع، وبعدها الأحدث
      list: withStage
        .sort((a, b) => (stageRank[a.stage] ?? 5) - (stageRank[b.stage] ?? 5) || (!a.stage && (a.replied || a.handled) - (b.replied || b.handled)) || rank[a.intent] - rank[b.intent])
        .slice(0, 150)
        .map((c) => ({
          id: c.id, username: c.username, text: c.text, timestamp: c.timestamp, intent: c.intent, stage: c.stage,
          replied: !!c.replied, handled: !!c.handled, followed: !!c.followed_at, permalink: c.permalink, post: (c.caption || "").split("\n")[0].slice(0, 60),
        })),
    },
    hashtags: hashtagStats(accountId, acc.username, acc.name),
    topics: topicStats(accountId),
    watch: watchStats(accountId),
    // التنبيهات اللي لها وقت تختفي من اللوحة لما يفوت وقتها (تذكير النشر بعد ساعتين، متابعة العملاء ونتيجة الريل بعد يوم…)
    alerts: db.prepare(`SELECT a.title, a.body, a.created_at, a.link, m.permalink FROM alerts a LEFT JOIN media m ON m.id = a.media_id
      WHERE a.account_id = ? AND a.created_at > unixepoch() - CASE
        WHEN a.kind LIKE 'prepost:%' THEN 2 * 3600
        WHEN a.kind LIKE 'followup:%' OR a.kind LIKE 'perf:%' THEN 86400
        WHEN a.kind LIKE 'weekly:%' OR a.kind LIKE 'goal-mid:%' OR a.kind LIKE 'exp:%' THEN 7 * 86400
        WHEN a.kind LIKE 'monthly:%' OR a.kind LIKE 'goal-end:%' THEN 10 * 86400
        ELSE 3 * 86400 END
      ORDER BY a.created_at DESC LIMIT 6`).all(accountId),
    sales: {
      kpis: salesKpis(sales),
      prev_kpis: salesKpis(salesBetween(accountId, prevFrom, prevTo)),
      by_source: bySource,
      by_type: salesByType,
      unattributed: attr.unattributed,
      window: SALE_WINDOW,
      top_posts: attr.posts.filter((p) => p.attributed > 0).sort((a, b) => b.attributed - a.attributed).slice(0, 8)
        .map((p) => ({ ...slim(p), attributed: p.attributed, direct: p.direct })),
      list: sales.slice(0, 50).map((x) => ({ ...x, post: x.media_id ? (db.prepare("SELECT caption FROM media WHERE id = ?").get(x.media_id)?.caption || "").split("\n")[0].slice(0, 50) : null })),
      // للقائمة في نموذج الإضافة: آخر البوستات بغض النظر عن الفترة
      recent_posts: db.prepare("SELECT id, caption, timestamp, product_type, media_type FROM media WHERE account_id = ? AND product_type != 'STORY' ORDER BY timestamp DESC LIMIT 30")
        .all(accountId).map((p) => ({ id: p.id, date: localDate(p.timestamp), kind_name: TYPE_NAMES[p.product_type === "REELS" ? "REELS" : p.media_type] || "", caption: (p.caption || "").split("\n")[0].slice(0, 50) })),
    },
    stories: {
      kpis: storyKpis(stories),
      prev_kpis: storyKpis(storiesBetween(accountId, prevFrom, prevTo)),
      retention: storyRetention(stories),
      list: stories.map(slimStory).reverse(),
    },
  };
}
