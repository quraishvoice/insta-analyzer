// خادم محلي: يقدّم اللوحة ويستقبل طلباتها
import { createServer } from "node:http";
import { readFile, unlink, rm } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { db } from "./db.js";
import { addAccount, syncAccount, quickSync, replyToComment } from "./instagram.js";
import { report } from "./analysis.js";
import { advise } from "./advisor.js";
import { plan } from "./planner.js";
import { langStore, langOf, LABELS, L, unlbl } from "./i18n.js";
import { P } from "./profile.js";
import { checkCaption } from "./captions.js";
import { loadDemo } from "./demo.js";
import { save as saveAlert } from "./alerts.js";
import { setOutcome, markFollowed, followupReminder } from "./leads.js";
import { goalStatus, setGoals, goalReminders } from "./goals.js";
import { recycleIdeas, markRecycle } from "./recycle.js";
import { getDm, saveDm } from "./dm.js";
import { getAutoDm, saveAutoDm } from "./autodm.js";
import { exportXlsx } from "./export.js";
import { connectCompetitors, disconnectCompetitors, setCompetitors } from "./competitors.js";
import { saveUpload, createScheduled, listScheduled, cancelScheduled, publishNow, runScheduler, cleanTmp } from "./schedule.js";
import { postReviews } from "./postreview.js";
import { botReply, botButton, sendLeadCards, morningBrief, MENU } from "./bot.js";
import { prepostReminders } from "./prepost.js";
import { fillDurations } from "./watch.js";
import { listExperiments, addExperiment, stopExperiment, deleteExperiment, experimentAlerts } from "./experiments.js";
import { monthly, monthlyDigest } from "./monthly.js";
import { carouselKit, listCarousels, getCarousel, saveCarousel, deleteCarousel } from "./carousel.js";
import { backupIfDue, backupStatus } from "./backup.js";
import { checkAccess, login, phoneInfo, newAccessCode, isLocalRequest, setSetting } from "./access.js";
import { telegramStatus, connectTelegram, disconnectTelegram, sendTelegram, listenTelegram } from "./telegram.js";
import { addIdea, listIdeas, setIdea, deleteIdea, ideaFromTelegram } from "./ideas.js";

const PORT = +process.env.PORT || 3030;
const status = {}; // حالة المزامنة لكل حساب

function startSync(id) {
  if (status[id]?.running) return;
  // لو التحديث الخفيف شغال، المزامنة الكاملة تبدأ أول ما يخلص (بدل ما تنلغي بصمت)
  if (status[id]?.quick) return void (status[id].pending = true);
  status[id] = { running: true, step: "بدأت المزامنة" };
  // الحالة تنحفظ بالعربي (يشوفها الكل)، وتتترجم وقت العرض في syncShown
  langStore.run("ar", () => syncAccount(id, (step) => (status[id].step = step)))
    .then(() => (status[id] = { running: false, step: "تمت المزامنة" }))
    .catch((e) => (status[id] = { running: false, error: e.message }));
}

// ردود افتراضية لين تكتب ردودك. ما تقول «أرسلت لك» عشان ما توعد بشي ما صار
// النصوص من ملف مجالك (replies)
const DEFAULT_REPLIES = P.replies;
function templates(accountId) {
  const saved = Object.fromEntries(db.prepare("SELECT intent, text FROM reply_templates WHERE account_id = ?").all(accountId).map((r) => [r.intent, r.text]));
  return { ...DEFAULT_REPLIES, ...saved };
}

// حالة المزامنة بلغة اللوحة
const SYNC_EN = {
  "بدأت المزامنة": "Sync started", "تمت المزامنة": "Synced", "الإحصائيات اليومية": "Daily stats", "الستوري": "Stories", "التعليقات": "Comments",
  "التوكن غير صحيح أو منتهي — ولّد توكن جديد من لوحة مطوري Meta": "The token is invalid or expired. Generate a new one in the Meta developer dashboard.",
};
const syncText = (s) => (s == null ? s : L(s, SYNC_EN[s] ?? s.replace(/^البوستات (\d+)\/(\d+)$/, "Posts $1/$2")));
const syncShown = (s) => (s ? { ...s, step: syncText(s.step), error: syncText(s.error) } : null);

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });
// الفترة: الشكل وتاريخ حقيقي (مو 2026-13-45)
function validRange(q) {
  const isDay = (s) => { try { return /^\d{4}-\d{2}-\d{2}$/.test(s || "") && new Date(s + "T00:00:00Z").toISOString().startsWith(s); } catch { return false; } };
  if (!isDay(q.get("from")) || !isDay(q.get("to")) || q.get("from") > q.get("to")) throw badRequest(L("اختار فترة صحيحة", "Choose a valid date range"));
}

function macOnly(req) {
  if (!isLocalRequest(req)) throw Object.assign(new Error(L("هذا الإعداد من الماك نفسه بس", "This setting is only available on the Mac itself")), { status: 403 });
}

const routes = {
  "GET /api/accounts": () =>
    db.prepare("SELECT id, username, name, picture, followers, business, goal, is_demo, last_sync, token_expires FROM accounts ORDER BY is_demo, username").all()
      .map((a) => ({ ...a, sync: syncShown(status[a.id]) })),

  "POST /api/accounts": async (_, body) => {
    const id = await addAccount(body);
    startSync(id);
    return { id };
  },

  "PATCH /api/accounts/:id": (p, body) => {
    // اللي ما انرسل يبقى مثل ما هو
    db.prepare("UPDATE accounts SET business = COALESCE(?, business), goal = COALESCE(?, goal) WHERE id = ?").run(body.business ?? null, body.goal ?? null, p.id);
    return { ok: true };
  },

  // مسح الحساب وكل بياناته: من الماك بس، ومرة وحدة (يا ينمسح كله يا ما ينمسح شي)
  "DELETE /api/accounts/:id": async (p, _, __, { req }) => {
    macOnly(req);
    if (status[p.id]?.running || status[p.id]?.quick) throw new Error(L("المزامنة شغالة الحين. انتظر دقيقة وجرّب مرة ثانية.", "A sync is running right now. Wait a minute and try again."));
    const images = db.prepare("SELECT image FROM stories WHERE account_id = ? AND image IS NOT NULL").all(p.id).map((r) => r.image);
    const queued = db.prepare("SELECT id FROM scheduled WHERE account_id = ?").all(p.id).map((r) => r.id);
    db.exec("BEGIN");
    try {
      for (const t of ["media", "daily", "stories", "comments", "sales", "snapshots", "alerts", "reply_templates", "goals", "recycle", "carousels", "dm_templates", "autodm", "audience", "tagged", "competitor_auth", "competitors", "competitor_daily", "competitor_media", "scheduled", "ideas", "experiments", "plan_days", "advice"]) db.prepare(`DELETE FROM ${t} WHERE account_id = ?`).run(p.id);
      db.prepare("DELETE FROM accounts WHERE id = ?").run(p.id);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    delete status[p.id];
    // صور الستوري المحفوظة على جهازك
    for (const f of images) await unlink(join("data/stories", basename(f))).catch(() => {});
    // ملفات البوستات المجدولة
    for (const id of queued) await rm(join("data/scheduled", String(id)), { recursive: true, force: true });
    return { ok: true };
  },

  "POST /api/accounts/:id/sync": (p) => {
    startSync(p.id);
    return { ok: true };
  },

  "GET /api/accounts/:id/report": async (p, _, q) => {
    validRange(q);
    const rep = report(p.id, q.get("from"), q.get("to"));
    const goals = goalStatus(p.id);
    return { ...rep, advice: advise({ ...rep, goals }), plan: plan(p.id), experiments: listExperiments(p.id), backup: await backupStatus(), templates: templates(p.id), dm: getDm(p.id), autodm: getAutoDm(p.id), scheduled: listScheduled(p.id), ideas: listIdeas(p.id), goals, recycle: recycleIdeas(p.id) };
  },

  // علّم تعليق «تم» (رديت عليه في الخاص مثلاً) أو رجّعه
  "POST /api/comments/:id/handled": (p, body) => {
    db.prepare("UPDATE comments SET handled = ?, replied_at = COALESCE(replied_at, ?) WHERE id = ?").run(body.handled ? 1 : 0, body.handled ? Math.floor(Date.now() / 1000) : null, p.id);
    return { ok: true };
  },

  // أهداف الشهر
  // إعادة التدوير: «نزّلتها» أو «ما تناسب» أو تراجع
  "POST /api/accounts/:id/recycle/:media": (p, body) => markRecycle(p.id, p.media, body.status || null),

  // بنك الأفكار
  "GET /api/accounts/:id/ideas": (p) => listIdeas(p.id),
  "POST /api/accounts/:id/ideas": (p, body) => addIdea(p.id, body.text),
  "POST /api/ideas/:iid": (p, body) => setIdea(p.iid, body),
  "DELETE /api/ideas/:iid": (p) => deleteIdea(p.iid),

  // رسائل الخاص الجاهزة ومعلومات العرض
  "PUT /api/accounts/:id/dm": (p, body) => saveDm(p.id, body),
  "PUT /api/accounts/:id/autodm": (p, body) => saveAutoDm(p.id, body),
  // النشر المجدول (رفع الملف نفسه يمر من مسار خاص تحت، لأنه أكبر من حد الـ JSON)
  "POST /api/accounts/:id/scheduled": (p, body) => createScheduled(p.id, body),
  "DELETE /api/scheduled/:sid": (p) => cancelScheduled(p.sid),
  "POST /api/scheduled/:sid/now": (p) => publishNow(p.sid),
  // المنافسين: الربط بتوكن فيسبوك (من الماك بس، مثل باقي التوكنات) وقائمة اليوزرات
  "POST /api/accounts/:id/competitors/connect": (p, body, _, { req }) => (macOnly(req), connectCompetitors(p.id, body.token)),
  "DELETE /api/accounts/:id/competitors/connect": (p, _, __, { req }) => (macOnly(req), disconnectCompetitors(p.id)),
  "PUT /api/accounts/:id/competitors": (p, body) => setCompetitors(p.id, body.usernames),
  // ملف إكسل للفترة المختارة
  "GET /api/accounts/:id/export": (p, _, q) => { validRange(q); return exportXlsx(p.id, q.get("from"), q.get("to")); },

  // متابعة التجارب
  "GET /api/accounts/:id/experiments": (p) => listExperiments(p.id),
  "POST /api/accounts/:id/experiments": (p, body) => addExperiment(p.id, body),
  "POST /api/experiments/:eid/stop": (p) => stopExperiment(p.eid),
  "DELETE /api/experiments/:eid": (p) => deleteExperiment(p.eid),

  // التقرير الشهري
  "GET /api/accounts/:id/monthly": (p, _, q) => monthly(p.id, q.get("month") || undefined),

  // صانع الكاروسيل
  "GET /api/accounts/:id/carousel-kit": (p) => carouselKit(p.id),
  "GET /api/accounts/:id/carousels": (p) => listCarousels(p.id),
  "PUT /api/accounts/:id/carousels": (p, body) => saveCarousel(p.id, body),
  "GET /api/carousels/:cid": (p) => getCarousel(p.cid),
  "DELETE /api/carousels/:cid": (p) => deleteCarousel(p.cid),

  "GET /api/accounts/:id/goals": (p, _, q) => {
    const month = q.get("month");
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(L("الشهر غلط", "Invalid month"));
    return goalStatus(p.id, month || undefined);
  },
  "PUT /api/accounts/:id/goals": (p, body) => setGoals(p.id, body.month, body.targets || {}),

  // متابعة العميل: «تابعته» أو النتيجة (سجّل / ما سجّل / تراجع)
  "POST /api/comments/:id/followed": (p, body) => markFollowed(p.id, body.followed !== false),
  "POST /api/comments/:id/outcome": (p, body) => setOutcome(p.id, body),

  "POST /api/accounts/:id/sales": (p, body) => {
    const count = Math.round(+body.count);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") || !(count > 0)) throw new Error(L("اكتب التاريخ وعدد المسجلين", "Enter the date and number of sign-ups"));
    const amount = body.amount === "" || body.amount == null ? null : +body.amount;
    db.prepare("INSERT INTO sales (account_id, date, count, amount, source, media_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(p.id, body.date, count, Number.isFinite(amount) ? amount : null, unlbl(body.source) || "غير معروف", body.media_id || null, (body.note || "").slice(0, 200), Math.floor(Date.now() / 1000));
    return { ok: true };
  },

  "DELETE /api/sales/:id": (p) => {
    db.prepare("DELETE FROM sales WHERE id = ?").run(+p.id);
    return { ok: true };
  },

  "POST /api/login": (_, body, __, { req, res }) => login(req, res, body.code),

  "GET /api/phone": (_, __, ___, { req }) => phoneInfo(PORT, req),

  "POST /api/phone/new-code": (_, __, ___, { req }) => {
    if (!isLocalRequest(req)) throw new Error(L("تغيير الرمز من الماك نفسه بس", "The access code can only be changed on the Mac itself"));
    newAccessCode();
    return phoneInfo(PORT, req);
  },

  // إعداد تيليجرام من الماك بس (فيه توكن البوت)
  "GET /api/telegram": (_, __, ___, { req }) => (macOnly(req), telegramStatus()),
  "POST /api/telegram": (_, body, __, { req }) => (macOnly(req), connectTelegram(body.token)),
  "DELETE /api/telegram": (_, __, ___, { req }) => (macOnly(req), disconnectTelegram()),
  "POST /api/telegram/test": async (_, __, ___, { req }) => {
    macOnly(req);
    if (!(await sendTelegram("🔔 تجربة من محلل انستجرام", "إذا وصلتك هالرسالة، التنبيهات بتوصلك على جوالك."))) throw new Error(L("ما انرسلت. تأكد إنك ضغطت Start في البوت.", "Not sent. Make sure you pressed Start in the bot."));
    return { ok: true };
  },

  "POST /api/accounts/:id/check-caption": (p, body) => checkCaption(p.id, body),

  "POST /api/comments/:id/reply": (p, body) => replyToComment(p.id, body.text),

  "GET /api/accounts/:id/templates": (p) => templates(p.id),

  "PUT /api/accounts/:id/templates": (p, body) => {
    for (const intent of Object.keys(DEFAULT_REPLIES)) {
      if (typeof body[intent] === "string") db.prepare("INSERT INTO reply_templates (account_id, intent, text) VALUES (?, ?, ?) ON CONFLICT (account_id, intent) DO UPDATE SET text = excluded.text")
        .run(p.id, intent, body[intent].trim().slice(0, 2200));
    }
    return templates(p.id);
  },

  "POST /api/demo": () => {
    loadDemo();
    return { id: "demo" };
  },
};

function match(method, path) {
  for (const [key, fn] of Object.entries(routes)) {
    const [m, pattern] = key.split(" ");
    if (m !== method) continue;
    const names = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "$");
    const hit = path.match(re);
    if (hit) return [fn, Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])]))];
  }
  return [];
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/manifest+json", ".woff2": "font/woff2" };

// كل طلب يشتغل بلغة اللوحة (كوكي ia_lang)، فالنصائح والخطة ترجع بنفس اللغة
createServer((req, res) => langStore.run(langOf(req), () => handle(req, res))).listen(PORT, () => console.log(`اللوحة شغالة: http://localhost:${PORT}`));

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  try {
    // من الماك نفسه يدخل مباشرة، ومن الجوال يحتاج رمز الدخول
    const access = checkAccess(req, url.pathname);
    if (access === "forbidden") return res.writeHead(403).end();
    if (access === "login") {
      if (url.pathname.startsWith("/api/")) return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "login" }));
      return res.writeHead(302, { location: "/login.html" }).end();
    }
    // رفع فيديو أو صورة للجدولة: الملف يتخزن مباشرة بدون ما يمر على حد الـ JSON
    const up = req.method === "PUT" && /^\/api\/accounts\/([^/]+)\/upload$/.exec(url.pathname);
    if (up) {
      if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(decodeURIComponent(up[1]))) throw Object.assign(new Error(L("الحساب مو موجود", "Account not found")), { status: 404 });
      const out = await saveUpload(req, url.searchParams.get("ext"));
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    }
    if (url.pathname.startsWith("/api/")) {
      let found;
      try { found = match(req.method, url.pathname); } catch { throw badRequest(L("الرابط غلط", "Invalid URL")); }
      const [fn, params] = found;
      if (!fn) return res.writeHead(404).end();
      if (params.id && url.pathname.startsWith("/api/accounts/") && !db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(params.id))
        throw Object.assign(new Error(L("الحساب مو موجود", "Account not found")), { status: 404 });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2e6) throw Object.assign(new Error(L("الطلب كبير", "Request too large")), { status: 413 });
      }
      let parsed = {};
      if (body) { try { parsed = JSON.parse(body); } catch { throw badRequest(L("البيانات المرسلة غلط", "Invalid request data")); } }
      if (!parsed || typeof parsed !== "object") throw badRequest(L("البيانات المرسلة غلط", "Invalid request data"));
      const out = await fn(params, parsed, url.searchParams, { req, res });
      // ملف للتحميل (مثل الإكسل)
      if (Buffer.isBuffer(out?.file)) return res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(out.name)}`,
        "cache-control": "no-store",
      }).end(out.file);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } else if (url.pathname.startsWith("/stories/")) {
      // صور الستوري المحفوظة على جهازك (روابط انستجرام تنتهي بعد يوم)
      const data = await readFile(join("data/stories", basename(url.pathname)));
      res.writeHead(200, { "content-type": "image/jpeg" }).end(data);
    } else if (url.pathname === "/profile.js") {
      // ملف مجالك للوحة: القوالب والأمثلة (بدون الكلمات والردود)
      const { label, niche, about, offer, cta_word, emoji, business, niche_tag_example, questions, templates } = P;
      res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(`window.PROFILE = ${JSON.stringify({ label, niche, about, offer, cta_word, emoji, business, niche_tag_example, questions, templates })};`);
    } else if (url.pathname === "/i18n-labels.js") {
      res.writeHead(200, { "content-type": "text/javascript" }).end(`window.I18N_LABELS = ${JSON.stringify(LABELS)};`);
    } else {
      const file = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
      const data = await readFile(join("public", file));
      const type = TYPES[extname(file)] || "application/octet-stream";
      const gz = data.length > 4096 && /html|javascript|css|json|svg/.test(type) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
      res.writeHead(200, { "content-type": type, ...(gz && { "content-encoding": "gzip", vary: "accept-encoding" }) }).end(gz ? gzipSync(data) : data);
    }
  } catch (e) {
    // رسائلنا (Error عادي) = خطأ في الطلب، وأي نوع ثاني (TypeError…) = خلل في الكود ينكتب في السجل
    const code = e.code === "ENOENT" ? 404 : e.status || (e.constructor === Error ? 400 : 500);
    if (code === 500) console.error(e);
    res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
  }
}

const liveIds = () => db.prepare("SELECT id FROM accounts WHERE is_demo = 0").all().map((a) => a.id);

// كل المهام المجدولة تمر من هنا: لو صار خطأ ينكتب في السجل والخادم يكمل
const safe = (name, fn) => async () => { try { await fn(); } catch (e) { console.error(`${name}:`, e.message); } };
process.on("unhandledRejection", (e) => console.error("خطأ غير متوقع:", e?.message || e));

// مزامنة كاملة إذا مر ١٢ ساعة على آخر وحدة: نفحص كل ساعة وبعد التشغيل بدقيقة
// (العدّاد الثابت كان يبدأ من جديد مع كل تشغيل، ويوقف لما ينام الجهاز)
const fullSyncDue = () => {
  for (const id of liveIds()) {
    const last = db.prepare("SELECT last_full_sync FROM accounts WHERE id = ?").get(id)?.last_full_sync || 0;
    if (Date.now() / 1000 - last > 12 * 3600) startSync(id);
  }
};
setInterval(safe("المزامنة الكاملة", fullSyncDue), 3600 * 1000);
setTimeout(safe("المزامنة الكاملة", fullSyncDue), 60 * 1000);

// تحديث خفيف كل دقيقتين (ما يشتغل إذا فيه مزامنة كاملة شغالة لنفس الحساب)
setInterval(() => {
  for (const id of liveIds()) {
    if (status[id]?.running || status[id]?.quick) continue;
    status[id] = { ...status[id], quick: true };
    quickSync(id)
      .then(() => (status[id] = { running: false, step: "تمت المزامنة", pending: status[id]?.pending }))
      .catch((e) => (status[id] = { running: false, error: e.message, pending: status[id]?.pending }))
      .finally(() => { if (status[id]?.pending) startSync(id); });
  }
}, 2 * 60 * 1000);

// التقرير الأسبوعي: كل أحد من الساعة ٩ الصبح (أو أول ما يصحى الجهاز بعدها) يوصلك ملخص الأسبوع اللي راح
const TZ = process.env.TIMEZONE || "Asia/Riyadh";
function weeklyDigest() {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  const hour = +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now);
  const dow = new Date(today + "T00:00:00Z").getUTCDay();
  if (dow === 0 && hour < 9) return;
  const day = (n) => new Date(Date.parse(today + "T00:00:00Z") - n * 864e5).toISOString().slice(0, 10);
  const from = day(dow + 7), to = day(dow + 1);
  for (const id of liveIds()) {
    if (db.prepare("SELECT 1 FROM alerts WHERE account_id = ? AND kind = ?").get(id, `weekly:${from}`)) continue;
    const rep = report(id, from, to);
    const adv = advise(rep);
    const k = rep.kpis, ch = k.reach && rep.prev_kpis.reach ? (k.reach - rep.prev_kpis.reach) / rep.prev_kpis.reach : null;
    const bits = [k.posts === 1 ? "بوست واحد" : k.posts === 2 ? "بوستين" : `${k.posts} ${k.posts >= 3 && k.posts <= 10 ? "بوستات" : "بوست"}`];
    if (ch != null) bits.push(`الوصول ${ch >= 0 ? "▲" : "▼"} ${Math.round(Math.abs(ch) * 100)}٪`);
    if (k.follower_growth != null) bits.push(`المتابعين ${k.follower_growth >= 0 ? "+" : ""}${k.follower_growth}`);
    if (rep.sales.kpis.count) bits.push(`${rep.sales.kpis.count} مسجل`);
    if (rep.comments.due) bits.push(`${rep.comments.due} يحتاجون متابعة`);
    const step = adv.recommendations[0];
    saveAlert(id, null, `weekly:${from}`, "📊 تقريرك الأسبوعي جاهز",
      `${bits.join(" · ")}.${step ? ` أهم خطوة: ${step.title}.` : ""}`, `/weekly.html?id=${encodeURIComponent(id)}&from=${from}`);
  }
}
setInterval(safe("التقرير الأسبوعي", weeklyDigest), 10 * 60 * 1000);

// تذكير متابعة العملاء: مرة باليوم من الساعة ١٠ الصبح
// ومع التذكير بطاقة لكل عميل في تيليجرام فيها رسالة المتابعة وأزرار النتيجة
const remindLeads = safe("متابعة العملاء", async () => {
  for (const x of followupReminder(liveIds())) if (await sendLeadCards(x.id, x.due)) setSetting(`lead_cards:${x.id}`, x.day);
});
setInterval(remindLeads, 10 * 60 * 1000);
setTimeout(remindLeads, 90 * 1000);

// طول الريلز (لنسبة المشاهدة): ٣٠ ريل كل ربع ساعة لين تخلص، وبعدها الجديدة بس
const durations = safe("طول الريلز", async () => { for (const id of liveIds()) await fillDurations(id).catch((e) => console.error("طول الريلز:", e.message)); });
setInterval(durations, 15 * 60 * 1000);
setTimeout(durations, 4 * 60 * 1000);

// ملخص الصباح على تيليجرام الساعة ٨
setInterval(safe("ملخص الصباح", () => morningBrief(liveIds())), 5 * 60 * 1000);

// تذكير قبل وقت البوست في الخطة بنص ساعة
const prepost = safe("تذكير النشر", () => prepostReminders(liveIds()));
setInterval(prepost, 5 * 60 * 1000);
setTimeout(prepost, 2 * 60 * 1000);

// تقرير كل بوست بعد يومين من نشره
const reviews = safe("تقرير البوست", () => postReviews(liveIds()));
setInterval(reviews, 30 * 60 * 1000);
setTimeout(reviews, 3 * 60 * 1000);

// البوت يرد على الأوامر (/اليوم، /مشاهدات…) من أول حساب مربوط، وأي رسالة ثانية تنحفظ فكرة
listenTelegram((text) => (liveIds()[0] ? botReply(liveIds()[0], text) : null), 15000, botButton, MENU);

// أهداف الشهر: تنبيه نص الشهر إذا متأخر، وملخص أول الشهر الجاي
const goalJob = safe("الأهداف", () => goalReminders(liveIds()));
setInterval(goalJob, 10 * 60 * 1000);
setTimeout(goalJob, 2 * 60 * 1000);
setTimeout(safe("التقرير الأسبوعي", weeklyDigest), 60 * 1000);

// نتيجة كل تجربة بعد ما تخلص، والتقرير الشهري أول كل شهر
const monthlyJobs = () => { try { experimentAlerts(liveIds()); monthlyDigest(liveIds()); } catch (e) { console.error("التجارب والتقرير الشهري:", e.message); } };
setInterval(monthlyJobs, 10 * 60 * 1000);
setTimeout(monthlyJobs, 2 * 60 * 1000);

// نسخة احتياطية يومية (تتأكد كل ساعة، وأول ما يشتغل الخادم)
setInterval(safe("النسخة الاحتياطية", backupIfDue), 3600 * 1000);
// النشر المجدول: كل دقيقة، وبعد التشغيل بـ ٢٠ ثانية (لو الجهاز صحى وفيه بوست وقته فات)
setInterval(safe("النشر المجدول", runScheduler), 60 * 1000);
setTimeout(safe("النشر المجدول", runScheduler), 20 * 1000);
setInterval(safe("ملفات الجدولة المؤقتة", cleanTmp), 3600 * 1000);
setTimeout(safe("النسخة الاحتياطية", backupIfDue), 30 * 1000);
