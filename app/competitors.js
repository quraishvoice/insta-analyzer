// المنافسين: أرقام حسابات احترافية ثانية (متابعين، بوستات، لايكات وتعليقات) عن طريق Business Discovery
// هذي الخاصية تشتغل بس مع الربط عن طريق فيسبوك، فلها توكن ثاني منفصل: توكن الصفحة المربوطة بحسابك.
// الربط الأساسي (انستجرام) يبقى مثل ما هو لكل شي ثاني. الوصول والحفظ والمشاهدات ما تنعطى لحساب غيرك
import { db, upsert } from "./db.js";
import { save as saveAlert } from "./alerts.js";
import { L } from "./i18n.js";

const API = "https://graph.facebook.com/v23.0";
const MAX = 10;
const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const daysAgo = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() - n * 864e5));

db.exec(`
  CREATE TABLE IF NOT EXISTS competitor_auth (
    account_id TEXT PRIMARY KEY, token TEXT, ig_id TEXT, page_name TEXT, connected_at INTEGER, error TEXT);
  CREATE TABLE IF NOT EXISTS competitors (
    account_id TEXT, username TEXT, name TEXT, picture TEXT, added_at INTEGER, error TEXT, last_fetch INTEGER,
    PRIMARY KEY (account_id, username));
  CREATE TABLE IF NOT EXISTS competitor_daily (
    account_id TEXT, username TEXT, date TEXT, followers INTEGER, media_count INTEGER,
    PRIMARY KEY (account_id, username, date));
  CREATE TABLE IF NOT EXISTS competitor_media (
    id TEXT PRIMARY KEY, account_id TEXT, username TEXT, timestamp TEXT, media_type TEXT, product_type TEXT,
    caption TEXT, likes INTEGER, comments INTEGER, permalink TEXT, alerted INTEGER DEFAULT 0);
  CREATE INDEX IF NOT EXISTS competitor_media_user ON competitor_media(account_id, username, timestamp);
`);

async function fb(path, params, token) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const body = await (await fetch(url)).json();
  if (body.error) {
    const err = new Error(body.error.code === 190
      ? L("توكن فيسبوك غير صحيح أو منتهي. ولّد توكن جديد والصقه في «إدارة المنافسين».", "The Facebook token is invalid or expired. Generate a new one and paste it in “Manage competitors”.")
      : body.error.error_user_msg || body.error.message);
    err.code = body.error.code;
    err.subcode = body.error.error_subcode;
    throw err;
  }
  return body;
}

// اليوزر من «@x» أو رابط البروفايل
export function cleanUsername(s) {
  const m = /(?:instagram\.com\/)?@?([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/.exec(String(s || "").trim());
  return m ? m[1].toLowerCase() : null;
}

// توكن المستخدم من Graph API Explorer ← نطلع منه توكن الصفحة المربوطة بحسابك (ما ينتهي لو التوكن الأصلي ممدد)
export async function connectCompetitors(accountId, token) {
  const acc = db.prepare("SELECT username, is_demo FROM accounts WHERE id = ?").get(accountId);
  if (acc.is_demo) throw new Error(L("هذا حساب تجريبي.", "This is the demo account."));
  token = String(token || "").trim();
  if (/^IG/.test(token)) throw new Error(L("هذا توكن انستجرام (يبدأ بـ IG). المطلوب توكن فيسبوك من Graph API Explorer، يبدأ بـ EAA.", "That's an Instagram token (starts with IG). This needs a Facebook token from Graph API Explorer, starting with EAA."));
  if (!/^EA[A-Za-z0-9]{20,}$/.test(token)) throw new Error(L("التوكن مو كامل. انسخه كله من Graph API Explorer (يبدأ بـ EAA).", "That token looks incomplete. Copy all of it from Graph API Explorer (it starts with EAA)."));

  // التوكن القصير (ساعة أو ساعتين) يطلع منه توكن صفحة قصير بعد، فنطلب تمديده قبل
  let info = null;
  try { info = await fb("/oauth/access_token_info", {}, token); } catch {}
  if (info?.expires_in && info.expires_in < 3 * 86400)
    throw new Error(L("التوكن قصير وينتهي خلال ساعات. مدّده أول: افتحه في Access Token Debugger واضغط «Extend Access Token»، وانسخ التوكن الجديد اللي يطلع تحت.", "This token is short-lived and expires within hours. Extend it first: open it in Access Token Debugger, click “Extend Access Token”, and copy the new token shown below."));

  // الصلاحيات اللي فعلاً انعطت للتوكن: لو ناقص شي نقول وش هو بالضبط
  const NEED = ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement", "business_management"];
  let granted = null;
  try { granted = (await fb("/me/permissions", {}, token)).data.filter((x) => x.status === "granted").map((x) => x.permission); } catch {}
  const missing = granted ? NEED.filter((x) => !granted.includes(x)) : [];
  if (missing.length) throw new Error(L(`التوكن ناقصه صلاحيات: ${missing.join("، ")}. أضفها في Graph API Explorer وولّد التوكن من جديد. لو ما لقيتها في القائمة، أضفها لتطبيقك أول (تحت).`, `The token is missing permissions: ${missing.join(", ")}. Add them in Graph API Explorer and generate the token again. If they're not in the list, add them to your app first (below).`));
  const step = (where) => (e) => { e.message = `${where}: ${e.message}${e.code === 10 ? L(" — التطبيق نفسه ما عنده هالصلاحية. في لوحة تطبيقك اضغط Add Product وأضف «Facebook Login for Business»، وبعدها ولّد التوكن من جديد.", " — the app itself lacks this permission. In your app dashboard, click Add Product and add “Facebook Login for Business”, then generate the token again.") : ""}`; throw e; };
  const pages = await fb("/me/accounts", { fields: "name,access_token,instagram_business_account{id,username}", limit: 100 }, token).catch(step(L("قراءة صفحاتك", "Reading your pages")));
  const page = pages.data?.find((p) => p.instagram_business_account?.username?.toLowerCase() === acc.username.toLowerCase());
  if (!page) {
    const linked = (pages.data || []).filter((p) => p.instagram_business_account).map((p) => `@${p.instagram_business_account.username}`);
    throw new Error(pages.data?.length
      ? L(`ما لقيت صفحة مربوطة بـ @${acc.username}${linked.length ? ` (الصفحات اللي وصلتني مربوطة بـ ${linked.join("، ")})` : ""}. لما تولّد التوكن، اختار الصفحة المربوطة بحسابك.`, `No page linked to @${acc.username}${linked.length ? ` (the pages I can see are linked to ${linked.join(", ")})` : ""}. When generating the token, select the page linked to your account.`)
      : L("التوكن ما وصّلني لأي صفحة. تأكد إنك أضفت صلاحية pages_show_list، واخترت صفحتك لما سألك فيسبوك.", "The token didn't give access to any page. Make sure you added pages_show_list and selected your page when Facebook asked."));
  }
  const ig_id = page.instagram_business_account.id;
  // تجربة فعلية على حسابك نفسه
  await fb(`/${ig_id}`, { fields: `business_discovery.username(${acc.username}){followers_count}` }, page.access_token).catch(step(L("قراءة الحسابات (Business Discovery)", "Reading accounts (Business Discovery)")));
  upsert("competitor_auth", { account_id: accountId, token: page.access_token, ig_id, page_name: page.name, connected_at: Math.floor(Date.now() / 1000), error: null }, ["account_id"]);
  syncCompetitors(accountId, { force: true }).catch((e) => console.error("المنافسين:", e.message));
  return getCompetitors(accountId);
}

export function disconnectCompetitors(accountId) {
  db.prepare("DELETE FROM competitor_auth WHERE account_id = ?").run(accountId);
  return getCompetitors(accountId);
}

// حالة الربط وقائمة المنافسين (بدون التوكن)
export function getCompetitors(accountId) {
  const auth = db.prepare("SELECT page_name, connected_at, error FROM competitor_auth WHERE account_id = ?").get(accountId);
  const list = db.prepare("SELECT username, name, error FROM competitors WHERE account_id = ? ORDER BY added_at, username").all(accountId);
  return { connected: !!auth, page_name: auth?.page_name || null, error: auth?.error || null, list, max: MAX };
}

export async function setCompetitors(accountId, usernames) {
  const acc = db.prepare("SELECT username FROM accounts WHERE id = ?").get(accountId);
  const wanted = [...new Set((Array.isArray(usernames) ? usernames : String(usernames || "").split(/[\s,،]+/)).map(cleanUsername).filter(Boolean))]
    .filter((u) => u !== acc.username.toLowerCase());
  if (wanted.length > MAX) throw new Error(L(`${MAX} منافسين بالكثير.`, `${MAX} competitors at most.`));
  const old = new Set(db.prepare("SELECT username FROM competitors WHERE account_id = ?").all(accountId).map((r) => r.username));
  db.exec("BEGIN");
  try {
    for (const u of old) if (!wanted.includes(u)) {
      for (const t of ["competitors", "competitor_daily", "competitor_media"]) db.prepare(`DELETE FROM ${t} WHERE account_id = ? AND username = ?`).run(accountId, u);
    }
    const now = Math.floor(Date.now() / 1000);
    wanted.forEach((u, i) => { if (!old.has(u)) db.prepare("INSERT INTO competitors (account_id, username, added_at) VALUES (?, ?, ?)").run(accountId, u, now + i); });
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  // الجدد نسحبهم على طول عشان يبين لو اليوزر غلط أو الحساب شخصي
  const auth = db.prepare("SELECT * FROM competitor_auth WHERE account_id = ?").get(accountId);
  if (auth) for (const u of wanted.filter((u) => !old.has(u))) await fetchOne(accountId, auth, u, true);
  return getCompetitors(accountId);
}

const FIELDS = "username,name,profile_picture_url,followers_count,media_count,media.limit(50){id,caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink}";

async function fetchOne(accountId, auth, username, quiet) {
  let r;
  try {
    r = (await fb(`/${auth.ig_id}`, { fields: `business_discovery.username(${username}){${FIELDS}}` }, auth.token)).business_discovery;
  } catch (e) {
    if (e.code === 190) {
      db.prepare("UPDATE competitor_auth SET error = ? WHERE account_id = ?").run(e.message, accountId);
      saveAlert(accountId, null, `comp-token:${today()}`, L("⚠️ توكن المنافسين وقف", "⚠️ The competitors token stopped working"),
        L("أرقام المنافسين ما تتحدث. افتح «إدارة المنافسين» والصق توكن جديد.", "Competitor numbers aren't updating. Open “Manage competitors” and paste a new token."));
      throw e;
    }
    if ([4, 17, 32, 613].includes(e.code)) throw e; // حد الطلبات: نوقف ونكمل بكرة
    // 110 / 2207013: اليوزر غلط، أو الحساب شخصي، أو محظور
    const msg = e.code === 110 || e.subcode === 2207013 || /cannot be found|not.*business/i.test(e.message)
      ? L("ما انقرا: اليوزر غلط أو الحساب شخصي (مو احترافي)", "Couldn't read it: wrong username or a personal (non-professional) account")
      : e.message;
    db.prepare("UPDATE competitors SET error = ?, last_fetch = ? WHERE account_id = ? AND username = ?").run(msg, Math.floor(Date.now() / 1000), accountId, username);
    return;
  }
  db.prepare("UPDATE competitors SET name = ?, picture = ?, error = NULL, last_fetch = ? WHERE account_id = ? AND username = ?")
    .run(r.name || null, r.profile_picture_url || null, Math.floor(Date.now() / 1000), accountId, username);
  upsert("competitor_daily", { account_id: accountId, username, date: today(), followers: r.followers_count, media_count: r.media_count }, ["account_id", "username", "date"]);
  const fresh = !db.prepare("SELECT 1 FROM competitor_media WHERE account_id = ? AND username = ? LIMIT 1").get(accountId, username);
  for (const m of r.media?.data || []) {
    db.prepare(`INSERT INTO competitor_media (id, account_id, username, timestamp, media_type, product_type, caption, likes, comments, permalink, alerted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET caption = excluded.caption, likes = excluded.likes, comments = excluded.comments`)
      .run(m.id, accountId, username, m.timestamp, m.media_type, m.media_product_type || null, m.caption || "", m.like_count ?? null, m.comments_count ?? null, m.permalink, fresh || quiet ? 1 : 0);
  }
  hitAlerts(accountId, username, r.followers_count);
}

// مرة باليوم مع المزامنة الكاملة (force: بعد الربط مباشرة)
export async function syncCompetitors(accountId, { force = false } = {}) {
  const auth = db.prepare("SELECT * FROM competitor_auth WHERE account_id = ?").get(accountId);
  if (!auth) return;
  const day = today();
  const due = db.prepare(`SELECT c.username FROM competitors c WHERE c.account_id = ? AND (? OR NOT EXISTS
    (SELECT 1 FROM competitor_daily d WHERE d.account_id = c.account_id AND d.username = c.username AND d.date = ?)) ORDER BY c.added_at`).all(accountId, force ? 1 : 0, day);
  for (const { username } of due) await fetchOne(accountId, auth, username, false);
  if (due.length) db.prepare("UPDATE competitor_auth SET error = NULL WHERE account_id = ?").run(accountId);
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const kindOf = (m) => (m.product_type === "REELS" ? "REELS" : m.media_type === "CAROUSEL_ALBUM" ? "CAROUSEL_ALBUM" : m.media_type === "VIDEO" ? "REELS" : "IMAGE");
// التفاعل = (لايكات + تعليقات) ÷ المتابعين. الوحيد اللي ينحسب بنفس الطريقة لك وللمنافس
const eng = (m, followers) => (m.likes == null || !followers ? null : (m.likes + (m.comments || 0)) / followers);
// البوستات اللي عمرها أقل من يومين أرقامها لسا تطلع، فما نحسبها في المتوسط
const settled = (m) => Date.now() - Date.parse(m.timestamp) > 2 * 864e5;

// بوست انفجر: ٣ أضعاف عادته على الأقل، وعمره ٣ أيام أو أقل
function hitAlerts(accountId, username, followers) {
  const posts = db.prepare("SELECT * FROM competitor_media WHERE account_id = ? AND username = ? AND timestamp >= ? ORDER BY timestamp DESC").all(accountId, username, new Date(Date.now() - 60 * 864e5).toISOString());
  const base = median(posts.filter(settled).map((m) => eng(m, followers)).filter((x) => x != null));
  if (!base || posts.length < 6) return;
  for (const m of posts) {
    if (m.alerted || Date.now() - Date.parse(m.timestamp) > 3 * 864e5) continue;
    const e = eng(m, followers);
    // لسا ما وصل: نرجع نشيّك عليه بكرة لين يكمل ٣ أيام
    if (e == null || e < 3 * base) continue;
    db.prepare("UPDATE competitor_media SET alerted = 1 WHERE id = ?").run(m.id);
    const cap = (m.caption || "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 60) || "";
    saveAlert(accountId, null, `comp:${m.id}`, L(`🔥 بوست @${username} ماشي ${Math.round(e / base)}× عادته`, `🔥 @${username}'s post is doing ${Math.round(e / base)}× their usual`),
      L(`${cap ? `«${cap}». ` : ""}شوف وش الفكرة وكيف بدأ، وفكّر كيف تسويها بأسلوبك.`, `${cap ? `“${cap}”. ` : ""}Look at the idea and how it opens, then think how you'd do it your way.`), m.permalink);
  }
}

// نمو المتابعين من أقرب لقطة قبل n يوم (null لو ما عندنا لقطة بهالعمر)
function growth(rows, n) {
  if (!rows.length) return null;
  const now = rows[rows.length - 1], cut = daysAgo(n);
  const then = [...rows].reverse().find((r) => r.date <= cut);
  return then && now.followers != null && then.followers != null ? now.followers - then.followers : null;
}

function profile(posts, followers, history) {
  const since60 = Date.now() - 60 * 864e5, since28 = Date.now() - 28 * 864e5;
  const recent = posts.filter((m) => Date.parse(m.timestamp) >= since60);
  const scored = recent.filter(settled).map((m) => ({ ...m, kind: kindOf(m), e: eng(m, followers) }));
  const withE = scored.filter((m) => m.e != null);
  const byKind = {};
  for (const m of withE) (byKind[m.kind] ||= []).push(m.e);
  const kinds = Object.entries(byKind).filter(([, a]) => a.length >= 3).map(([k, a]) => ({ kind: k, n: a.length, eng: median(a) })).sort((a, b) => b.eng - a.eng);
  const mix = {};
  for (const m of recent) mix[kindOf(m)] = (mix[kindOf(m)] || 0) + 1;
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (const m of recent) days[new Date(new Date(m.timestamp).toLocaleString("en-US", { timeZone: TZ })).getDay()]++;
  return {
    followers,
    growth_7: growth(history, 7), growth_30: growth(history, 30),
    per_week: posts.filter((m) => Date.parse(m.timestamp) >= since28).length / 4,
    eng: median(withE.map((m) => m.e)),
    comments: median(scored.map((m) => m.comments).filter((x) => x != null)),
    hidden_likes: scored.length >= 3 && !withE.length,
    best_kind: kinds.length >= 2 ? kinds[0].kind : null,
    kinds, mix, posts: recent.length,
    top_day: recent.length >= 6 ? days.indexOf(Math.max(...days)) : null,
    scored,
  };
}

export function competitorsReport(accountId) {
  const acc = db.prepare("SELECT username, name, picture, followers FROM accounts WHERE id = ?").get(accountId);
  const status = getCompetitors(accountId);
  if (!status.connected && !status.list.length) return { ...status, rows: [], hits: [] };

  const ownPosts = db.prepare("SELECT timestamp, media_type, product_type, likes, comments, permalink, caption FROM media WHERE account_id = ? AND trial = 0 AND timestamp >= ? ORDER BY timestamp")
    .all(accountId, new Date(Date.now() - 60 * 864e5).toISOString());
  const ownHist = db.prepare("SELECT date, followers FROM daily WHERE account_id = ? AND followers IS NOT NULL ORDER BY date").all(accountId);
  const me = { username: acc.username, name: acc.name, picture: acc.picture, you: true, ...profile(ownPosts, acc.followers, ownHist) };

  const rows = [me], hits = [];
  for (const c of db.prepare("SELECT * FROM competitors WHERE account_id = ? ORDER BY added_at, username").all(accountId)) {
    const hist = db.prepare("SELECT date, followers, media_count FROM competitor_daily WHERE account_id = ? AND username = ? ORDER BY date").all(accountId, c.username);
    if (!hist.length) { rows.push({ username: c.username, name: c.name, error: c.error, pending: !c.error }); continue; }
    const followers = hist[hist.length - 1].followers;
    const posts = db.prepare("SELECT * FROM competitor_media WHERE account_id = ? AND username = ? ORDER BY timestamp").all(accountId, c.username);
    const p = profile(posts, followers, hist);
    rows.push({ username: c.username, name: c.name, picture: c.picture, error: c.error, since: hist[0].date, ...p });
    // بوستاته اللي ضعف عادته أو أكثر
    if (p.eng && p.scored.length >= 6) for (const m of p.scored) {
      if (m.e != null && m.e >= 2 * p.eng) hits.push({ username: c.username, permalink: m.permalink, timestamp: m.timestamp, kind: m.kind, likes: m.likes, comments: m.comments, x: m.e / p.eng,
        caption: (m.caption || "").replace(/[‎‏⁦-⁩\t]+/g, " ").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 100) || "" });
    }
  }
  for (const r of rows) delete r.scored;
  hits.sort((a, b) => b.x - a.x);
  return { ...status, rows, hits: hits.slice(0, 8) };
}
