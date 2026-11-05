// أوامر بوت تيليجرام: تسأل البوت عن أرقامك وهو يرد من بيانات الأداة (بدون ذكاء اصطناعي، أوامر محددة بس)
// أي رسالة ما تبدأ بأمر من هنا تروح لبنك الأفكار
import { db } from "./db.js";
import { report } from "./analysis.js";
import { plan } from "./planner.js";
import { dueLeads, markFollowed, setOutcome, SECOND_FOLLOWUP } from "./leads.js";
import { getDm } from "./dm.js";
import { sendTelegram } from "./telegram.js";
import { getSetting, setSetting } from "./access.js";
import { watchStats } from "./watch.js";
import { goalStatus, METRICS } from "./goals.js";
import { reviewPost } from "./postreview.js";
import { reelWatch } from "./watch.js";
import { ideaFromTelegram } from "./ideas.js";
import { listExperiments, verdictName } from "./experiments.js";
import { monthText } from "./monthly.js";

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const KIND_NAMES = { REELS: "ريل", CAROUSEL_ALBUM: "كاروسيل", IMAGE: "صورة", VIDEO: "فيديو" };
const kindOf = (p) => (p.product_type === "REELS" ? "REELS" : p.media_type);
const n = (x) => Math.round(x || 0).toLocaleString("en-US");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
const clean = (c) => (c || "").replace(/[⁦-⁩‎‏\t]/g, "");
const firstLine = (c) => clean(c).split("\n").find((l) => l.trim())?.trim().slice(0, 50) || "بدون كابشن";
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
const delta = (a, b) => { const d = pct(a, b); return d == null ? "" : d > 0 ? ` (↑ ${d}٪)` : d < 0 ? ` (↓ ${-d}٪)` : " (نفسها)"; };
function ago(iso) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3600e3);
  if (h < 1) return "قبل أقل من ساعة";
  if (h < 24) return h === 1 ? "قبل ساعة" : h === 2 ? "قبل ساعتين" : `قبل ${h} ${h <= 10 ? "ساعات" : "ساعة"}`;
  const d = Math.floor(h / 24);
  return d === 1 ? "أمس" : d === 2 ? "قبل يومين" : `قبل ${d} أيام`;
}
const leadsCount = (k) => (k === 1 ? "عميل واحد يحتاج" : k === 2 ? "عميلين يحتاجون" : `${n(k)} ${k <= 10 ? "عملاء" : "عميل"} يحتاجون`);
const postsOf = (id, k) => db.prepare("SELECT * FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial ORDER BY timestamp DESC LIMIT ?").all(id, k);
const updatedAt = (id) => {
  const t = db.prepare("SELECT MAX(synced_at) t FROM media WHERE account_id = ?").get(id).t;
  return t ? `\n\n🕒 آخر تحديث ${ago(new Date(t * 1000).toISOString())}` : "";
};

// المشاهدات على مستوى الحساب: Meta تعطيها متأخرة يوم أو يومين، فناخذ آخر ٧ أيام فيها أرقام ونقارنها بالسبعة اللي قبلها
function accountViews(id) {
  const rows = db.prepare("SELECT date, views FROM daily WHERE account_id = ? AND views IS NOT NULL ORDER BY date DESC LIMIT 14").all(id);
  if (rows.length < 7) return null;
  const sum = (l) => l.reduce((s, r) => s + r.views, 0);
  const last = rows.slice(0, 7), prev = rows.slice(7, 14);
  return { total: sum(last), prev: prev.length === 7 ? sum(prev) : null, from: last[6].date, to: last[0].date, yesterday: rows[0] };
}
const dayName = (d) => new Intl.DateTimeFormat("ar", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(d));

function cmdToday(id) {
  const fol = db.prepare("SELECT date, followers FROM daily WHERE account_id = ? AND followers IS NOT NULL ORDER BY date DESC LIMIT 1").get(id);
  const week = db.prepare("SELECT followers FROM daily WHERE account_id = ? AND followers IS NOT NULL AND date <= ? ORDER BY date DESC LIMIT 1").get(id, addDays(today(), -7));
  const v = accountViews(id);
  const p = postsOf(id, 1)[0];
  const due = dueLeads(id).length;
  const lines = ["☀️ ملخص اليوم", ""];
  if (fol) lines.push(`👥 المتابعين: ${n(fol.followers)}${week ? ` (${fol.followers - week.followers >= 0 ? "+" : ""}${n(fol.followers - week.followers)} هالأسبوع)` : ""}`);
  if (v) lines.push(`👁 المشاهدات آخر ٧ أيام: ${n(v.total)}${v.prev ? delta(v.total, v.prev) : ""}`);
  if (p) lines.push(`🎬 آخر بوست (${ago(p.timestamp)}): ${n(p.views)} مشاهدة · وصل لـ ${n(p.reach)}`);
  lines.push(due ? `💬 ${leadsCount(due)} متابعة اليوم (/عملاء)` : "💬 ما فيه عملاء يحتاجون متابعة اليوم");
  const next = plan(id).days?.find((d) => !d.rest);
  if (next) lines.push(`📅 البوست الجاي: ${next.day} الساعة ${next.time}، ${next.kind_name} (${next.goal})`);
  return lines.join("\n") + updatedAt(id);
}

function cmdViews(id) {
  const lines = ["👁 المشاهدات", ""];
  const v = accountViews(id);
  if (v) {
    lines.push(`الحساب كامل آخر ٧ أيام: ${n(v.total)}${v.prev ? delta(v.total, v.prev) + " مقارنة بالأسبوع اللي قبله" : ""}`);
    lines.push(`آخر يوم وصلت أرقامه (${dayName(v.yesterday.date)}): ${n(v.yesterday.views)}`);
    lines.push("(Meta تعطي مشاهدات الحساب متأخرة يوم أو يومين)", "");
  }
  const posts = postsOf(id, 5);
  if (posts.length) {
    lines.push("آخر البوستات:");
    for (const p of posts) lines.push(`• ${n(p.views)} مشاهدة · ${KIND_NAMES[kindOf(p)] || "بوست"} ${ago(p.timestamp)}: «${firstLine(p.caption)}»`);
  }
  const since = new Date(Date.now() - 864e5).toISOString().slice(0, 19);
  const st = db.prepare("SELECT COUNT(*) c, SUM(views) v FROM stories WHERE account_id = ? AND timestamp >= ?").get(id, since);
  if (st.c) lines.push("", `📱 الستوري (آخر ٢٤ ساعة): ${n(st.c)} ستوري، ${n(st.v)} مشاهدة`);
  return lines.join("\n") + updatedAt(id);
}

function cmdPost(id) {
  const p = postsOf(id, 1)[0];
  if (!p) return "ما لقيت بوستات.";
  const lines = [`🎬 آخر ${KIND_NAMES[kindOf(p)] || "بوست"} (${ago(p.timestamp)})`, `«${firstLine(p.caption)}»`, ""];
  lines.push(`👁 ${n(p.views)} مشاهدة · وصل لـ ${n(p.reach)} شخص`);
  lines.push(`❤️ ${n(p.likes)} · 💬 ${n(p.comments)} · 🔖 ${n(p.saved)} حفظ · 🔁 ${n(p.shares)} مشاركة`);
  if (p.follows) lines.push(`➕ ${n(p.follows)} متابعة من البوست`);
  if (p.avg_watch_time) {
    const s = Math.round(p.avg_watch_time), w = reelWatch(id, p);
    lines.push(`⏱ يتفرجون ${s} ${s <= 10 ? "ثواني" : "ثانية"} بالمتوسط${w?.ret != null ? `، يعني ${Math.round(w.ret * 100)}٪ من الريل (طوله ${Math.round(w.duration)} ثانية)` : ""}${w?.ratio != null ? ` · ${w.ratio >= 1.1 ? "أكثر من" : w.ratio <= 0.9 ? "أقل من" : "مثل"} عادتك` : ""}`);
  }
  // المقارنة بعادتك تصير أوضح بعد يوم من النشر
  if (Date.now() - Date.parse(p.timestamp) >= 864e5) {
    const t = today();
    const r = reviewPost(id, p, report(id, addDays(t, -89), t));
    if (r) lines.push("", r.body.split("\n").slice(1).join("\n"));
  } else lines.push("", "المقارنة بعادتك تطلع بعد ٢٤ ساعة من النشر.");
  if (p.permalink) lines.push("", p.permalink);
  return lines.join("\n") + updatedAt(id);
}

function cmdLeads(id) {
  const due = dueLeads(id);
  if (!due.length) return "💬 ما فيه عملاء يحتاجون متابعة اليوم 👌";
  return [`💬 ${leadsCount(due.length)} متابعة:`, "",
    ...due.slice(0, 10).map((c) => `• @${c.username}${c.followed_at ? " (تذكير ثاني)" : ""}: «${clean(c.text).slice(0, 60)}»`),
    due.length > 10 ? `و${n(due.length - 10)} غيرهم.` : null,
    "", "الرسائل الجاهزة في اللوحة، قسم «العملاء»."].filter((x) => x != null).join("\n");
}

function cmdPlan(id) {
  const p = plan(id);
  if (!p.ready) return "الخطة تحتاج ٦ بوستات على الأقل في آخر ٩٠ يوم.";
  const days = p.days.filter((d) => !d.rest).slice(0, 2);
  if (!days.length) return "ما فيه بوستات في خطة الأسبوع.";
  return "📅 الخطة\n\n" + days.map((d) => [
    `${d.day} الساعة ${d.time}: ${d.kind_name} (${d.goal})`,
    d.topic ? `الموضوع: ${d.topic}` : null,
    d.bank_idea ? `💡 من أفكارك: ${d.bank_idea.text.slice(0, 100)}` : d.hook ? `الفكرة: ${d.hook}` : null,
    d.cta ? `الدعوة: ${d.cta}` : null,
  ].filter(Boolean).join("\n")).join("\n\n");
}

function cmdGoals(id) {
  const g = goalStatus(id);
  if (!g.goals.length) return `🎯 ما حددت أهداف ${g.month_name} للحين. تحددها من اللوحة، بطاقة «أهداف الشهر».`;
  const st = { done: "✅ خلصته", ahead: "🟢 سابق الوتيرة", close: "🟡 قريب", behind: "🔴 متأخر", early: "⏳ بدري تحكم" };
  return `🎯 أهداف ${g.month_name} (باقي ${n(g.days_left)} ${g.days_left <= 10 ? "أيام" : "يوم"})\n\n` + g.goals.map((x) => `${METRICS[x.metric]?.name || x.metric}: ${n(x.actual)} من ${n(x.target)} ${st[x.status] || ""}${x.per_day && x.status !== "done" ? `\nتحتاج ${x.per_day < 1 ? `${n(x.per_week)} بالأسبوع` : `${n(Math.ceil(x.per_day))} باليوم`}` : ""}`).join("\n\n");
}

function cmdSales(id) {
  const t = today(), from = t.slice(0, 8) + "01";
  const s = db.prepare("SELECT COALESCE(SUM(count), 0) c, SUM(amount) a FROM sales WHERE account_id = ? AND date BETWEEN ? AND ?").get(id, from, t);
  const pm = addDays(from, -1).slice(0, 8) + "01";
  const prev = db.prepare("SELECT COALESCE(SUM(count), 0) c, SUM(amount) a FROM sales WHERE account_id = ? AND date BETWEEN ? AND ?").get(id, pm, addDays(pm, Math.min(+t.slice(8), +addDays(from, -1).slice(8)) - 1)); // ما تتعدى آخر يوم في الشهر اللي قبله
  return "💰 مبيعات هالشهر لين اليوم\n\n" + [`التسجيلات: ${n(s.c)}${prev.c ? delta(s.c, prev.c) : ""}`, s.a ? `المبلغ: ${n(s.a)} ريال${prev.a ? delta(s.a, prev.a) : ""}` : null,
    prev.c ? "(المقارنة بنفس الفترة من الشهر اللي قبله)" : null].filter(Boolean).join("\n");
}

// ملخص الصباح: أمس كيف مشى، ووش اليوم
const localDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const hourName = (h) => (h === 0 ? "١٢ بالليل" : h < 12 ? `${h} الصبح` : h === 12 ? "١٢ الظهر" : `${h - 12} ${h < 15 ? "الظهر" : h < 18 ? "العصر" : h < 20 ? "المغرب" : "الليل"}`);
export function morningText(id) {
  const t = today(), y = addDays(t, -1);
  const lines = ["☀️ صباح الخير! ملخص أمس واليوم", ""];
  const fol = (d) => db.prepare("SELECT followers FROM daily WHERE account_id = ? AND date = ? AND followers IS NOT NULL").get(id, d)?.followers;
  const f1 = fol(y), f0 = fol(addDays(y, -1)), fNow = db.prepare("SELECT followers FROM accounts WHERE id = ?").get(id)?.followers;
  if (f1 != null && f0 != null) lines.push(`👥 المتابعين أمس: ${f1 - f0 >= 0 ? "+" : ""}${n(f1 - f0)} (صاروا ${n(fNow ?? f1)})`);
  else if (fNow) lines.push(`👥 المتابعين: ${n(fNow)}`);

  // مشاهدات الحساب: آخر يوم وصلت أرقامه، مقارنة بمتوسط الأسبوع اللي قبله
  const vs = db.prepare("SELECT date, views FROM daily WHERE account_id = ? AND views IS NOT NULL ORDER BY date DESC LIMIT 8").all(id);
  if (vs.length) {
    const avg = vs.length >= 8 ? vs.slice(1).reduce((a, r) => a + r.views, 0) / 7 : null;
    lines.push(`👁 مشاهدات الحساب ${vs[0].date === y ? "أمس" : `يوم ${dayName(vs[0].date)}`}: ${n(vs[0].views)}${avg ? delta(vs[0].views, avg).replace(")", " عن متوسط أسبوعك)") : ""}`);
  }

  const posts = postsOf(id, 10).filter((p) => localDate(p.timestamp) === y);
  if (posts.length) for (const p of posts) lines.push(`🎬 ${KIND_NAMES[kindOf(p)] || "بوست"} أمس «${firstLine(p.caption).slice(0, 35)}»: ${n(p.views)} مشاهدة · وصل لـ ${n(p.reach)}`);
  else lines.push("🎬 ما نزّلت بوست أمس");
  const st = db.prepare("SELECT timestamp, views FROM stories WHERE account_id = ? AND timestamp >= ?").all(id, new Date(Date.parse(y) - 864e5).toISOString().slice(0, 19))
    .filter((x) => localDate(x.timestamp) === y);
  if (st.length) lines.push(`📱 ${st.length === 1 ? "ستوري وحدة" : `${n(st.length)} ستوري`} أمس: ${n(st.reduce((a, x) => a + (x.views || 0), 0))} مشاهدة`);
  const asked = db.prepare("SELECT timestamp FROM comments WHERE account_id = ? AND intent IN ('سعر', 'تسجيل') AND timestamp >= ?").all(id, new Date(Date.parse(y) - 864e5).toISOString().slice(0, 19))
    .filter((c) => localDate(c.timestamp) === y).length;
  if (asked) lines.push(`🙋 ${asked === 1 ? "واحد سأل" : `${n(asked)} سألوا`} عن السعر أو التسجيل أمس`);

  lines.push("");
  const plan = db.prepare("SELECT data FROM plan_days WHERE account_id = ? AND date = ?").get(id, t);
  if (plan) {
    const d = JSON.parse(plan.data);
    if (d.rest) lines.push("📅 اليوم راحة من النشر. وقت مناسب تصوّر بوستات الأسبوع.");
    else lines.push(`📅 اليوم: ${d.kind_name} الساعة ${hourName(+d.time.slice(0, 2))} (${d.goal})${d.topic ? `، موضوع «${d.topic}»` : ""}${d.reel_tip ? `\n⏱ ${d.reel_tip}.` : d.kind === "REELS" ? "\nخله أقل من دقيقة." : ""}`);
  }
  const due = dueLeads(id).length;
  if (due) lines.push(`💬 ${leadsCount(due)} متابعة (بطاقاتهم توصلك الساعة ١٠)`);
  const g = goalStatus(id);
  const st2 = { done: "✅", ahead: "🟢", close: "🟡", behind: "🔴", early: "⏳" };
  if (g.goals.length) lines.push(`🎯 ${g.goals.map((x) => `${METRICS[x.metric]?.name}: ${n(x.actual)} من ${n(x.target)} ${st2[x.status] || ""}`).join(" · ")}`);

  // درس من مدة المشاهدة، يتغير كل يوم
  const w = watchStats(id);
  if (w.ready && w.lessons.length) lines.push("", `💡 ${w.lessons[Math.floor(Date.parse(t) / 864e5) % w.lessons.length]}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// يرسل ملخص الصباح مرة باليوم من الساعة ٨ (لين ١٢ الظهر لو الماك كان طافي)
export async function morningBrief(accountIds) {
  const h = +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date());
  const t = today();
  if (h < 8 || h >= 12 || getSetting("morning_sent") === t || !accountIds.length) return;
  // ينعلَّم إنه انرسل بس إذا وصل، وإلا نحاول بعد ٥ دقايق
  if (await sendTelegram(null, morningText(accountIds[0]))) setSetting("morning_sent", t);
}

// التجارب: الشغالة ووين وصلت، واللي خلصت آخر ٦٠ يوم بنتيجتها
function cmdExperiments(id) {
  const X = listExperiments(id);
  const recent = X.finished.filter((e) => Date.parse(e.end) >= Date.now() - 60 * 864e5);
  const lines = ["🧪 تجاربك", ""];
  if (!X.running.length && !recent.length) lines.push("ما عندك تجارب. ابدأ وحدة من اللوحة ← «التجارب».");
  for (const e of X.running) lines.push(`▶️ ${e.name} (باقي ${e.days_left <= 0 ? "أقل من يوم" : e.days_left === 1 ? "يوم" : e.days_left === 2 ? "يومين" : `${e.days_left} ${e.days_left <= 10 ? "أيام" : "يوم"}`})`, e.verdict === "early" ? e.text : `${verdictName(e.verdict)} للحين: ${e.text}`, "");
  for (const e of recent) lines.push(`${verdictName(e.verdict)}: ${e.name}`, `${e.verdict === "early" ? "" : e.text + " "}${e.advice}`.trim(), "");
  if (X.suggestions.length && X.running.length < 2) lines.push("", `💡 تجربة مقترحة: ${X.suggestions[0].why}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const HELP = ["🤖 الأوامر:", "",
  "/اليوم ملخص سريع", "/مشاهدات مشاهدات الحساب وآخر البوستات", "/بوست أرقام آخر بوست", "/عملاء اللي يحتاجون متابعة",
  "/خطة وش تنشر الجاي", "/هدف أهداف الشهر", "/مبيعات مبيعات الشهر", "/افكار آخر أفكارك", "/صباح ملخص الصباح", "/شهر الشهر لين اليوم", "/تجارب تجاربك ونتايجها", "",
  "وأي رسالة ثانية تنحفظ فكرة في «بنك الأفكار»."].join("\n");

const COMMANDS = [
  [/^\/(اليوم|today)/i, cmdToday], [/^\/(مشاهدات|المشاهدات|views)/i, cmdViews], [/^\/(بوست|البوست|post)/i, cmdPost],
  [/^\/(عملاء|العملاء|leads)/i, cmdLeads], [/^\/(خطة|الخطة|خطه|plan)/i, cmdPlan], [/^\/(هدف|الهدف|اهداف|أهداف|goals)/i, cmdGoals],
  [/^\/(مبيعات|المبيعات|sales)/i, cmdSales], [/^\/(صباح|الصباح|morning)/i, morningText],
  [/^\/(شهر|الشهر|month)/i, (id) => monthText(id, today().slice(0, 7))], [/^\/(تجارب|التجارب|تجربة|experiments)/i, cmdExperiments], [/^\/(start|help|مساعدة|اوامر|أوامر)/i, () => HELP],
];

// الأزرار الثابتة تحت خانة الكتابة: الزر يرسل نصه، ونحوله للأمر
export const MENU = [["📊 اليوم", "👁 المشاهدات"], ["🎬 آخر بوست", "💬 العملاء"], ["📅 الخطة", "🎯 الأهداف"], ["💰 المبيعات", "💡 أفكاري"], ["📈 الشهر", "🧪 التجارب"]];
const MENU_COMMANDS = { "📊 اليوم": "/اليوم", "👁 المشاهدات": "/مشاهدات", "🎬 آخر بوست": "/بوست", "💬 العملاء": "/عملاء", "📅 الخطة": "/خطة", "🎯 الأهداف": "/هدف", "💰 المبيعات": "/مبيعات", "💡 أفكاري": "/افكار", "📈 الشهر": "/شهر", "🧪 التجارب": "/تجارب" };

export function botReply(accountId, text) {
  const t = MENU_COMMANDS[String(text || "").trim()] || String(text || "").trim();
  const hit = COMMANDS.find(([re]) => re.test(t));
  if (hit) return hit[1](accountId);
  if (t.startsWith("/") && !/^\/(ideas|افكار|أفكار)/i.test(t)) return "ما عرفت هالأمر.\n\n" + HELP;
  return ideaFromTelegram(accountId, t);
}

// بطاقة لكل عميل يحتاج متابعة: رسالة الخاص جاهزة للنسخ، وأزرار تعلّم النتيجة بدون ما تفتح اللوحة
const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toLatin = (t) => String(t || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
function dmText(accountId, c) {
  const D = getDm(accountId);
  const t = D.templates[c.followed_at ? "followup2" : "followup1"] || "";
  return t.replaceAll("{user}", c.username || "").replace(/\{(العرض|الموعد|السعر|الرابط)\}/g, (_, k) => D.info[k] || `[${k}]`);
}
const commentOf = (id) => db.prepare("SELECT c.*, m.caption FROM comments c LEFT JOIN media m ON m.id = c.media_id WHERE c.id = ?").get(id);

function leadCard(c, done = null) {
  const lines = [`👋 <b>@${esc(c.username)}</b> علّق ${ago(c.timestamp)}:`, `«${esc(clean(c.text).slice(0, 120))}»`];
  if (c.caption) lines.push(`على: ${esc(firstLine(c.caption))}`);
  if (done) return { text: [...lines, "", done].join("\n"), html: true, buttons: [[{ text: "↩️ تراجع", data: `L:u:${c.id}` }]] };
  const dm = dmText(c.account_id, c);
  lines.push("", c.followed_at ? "آخر تذكير (انسخها):" : "رسالة المتابعة (انسخها):", `<pre>${esc(dm)}</pre>`);
  if (/\[(العرض|الموعد|السعر|الرابط)\]/.test(dm)) lines.push("⚠️ فيه معلومات ناقصة بين [ ]، عبّها من «رسائل الخاص ✎» في اللوحة.");
  return { text: lines.join("\n"), html: true, buttons: [
    [{ text: "✉️ افتح الخاص", url: `https://ig.me/m/${encodeURIComponent(c.username || "")}` }],
    [{ text: "✅ تابعته", data: `L:f:${c.id}` }, { text: "💰 سجّل", data: `L:w:${c.id}` }, { text: "❌ ما سجّل", data: `L:l:${c.id}` }],
  ] };
}

// يرجع true إذا انرسلت بطاقة وحدة على الأقل
export async function sendLeadCards(accountId, due, max = 8) {
  let ok = false;
  for (const c of due.slice(0, max)) {
    const cm = commentOf(c.id);
    if (!cm) continue; // التعليق انمسح بينهم
    const card = leadCard(cm);
    ok = (await sendTelegram(null, card.text, card.buttons, true)) || ok;
  }
  if (ok && due.length > max) await sendTelegram(null, `و${n(due.length - max)} غيرهم في اللوحة، قسم «العملاء».`);
  return ok;
}

// ضغطة زر من تيليجرام. L:f = تابعته، L:w = سجّل، L:l = ما سجّل، L:u = تراجع
export function botButton(data) {
  const [, act, id] = String(data || "").match(/^L:([fwlu]):(.+)$/) || [];
  if (!act) return { toast: "زر قديم" };
  const c = commentOf(id);
  if (!c) return { toast: "التعليق مو موجود" };
  if (act === "f") {
    markFollowed(id, true);
    return { toast: "✅ تمام", ...leadCard(commentOf(id), `✅ تابعته. أذكرك بعد ${SECOND_FOLLOWUP} أيام إذا ما سجّل.`) };
  }
  if (act === "w") {
    const price = +toLatin(getDm(c.account_id).info["السعر"]).replace(/[^\d.]/g, "") || null;
    setOutcome(id, { outcome: "سجّل", add_sale: true, amount: price });
    return { toast: "💰 مبروك!", ...leadCard(commentOf(id), `💰 سجّل. انضاف للمبيعات${price ? ` بـ ${n(price)} ريال` : "، والمبلغ تضيفه من اللوحة"}.`) };
  }
  if (act === "l") {
    setOutcome(id, { outcome: "ما سجّل" });
    return { toast: "تمام", ...leadCard(commentOf(id), "❌ ما سجّل. ما راح أذكرك فيه مرة ثانية.") };
  }
  // تراجع: يرجع مثل ما كان (ويشيل التسجيل من المبيعات إذا انضاف)
  if (c.outcome) setOutcome(id, { outcome: null });
  else markFollowed(id, false);
  return { toast: "رجعناه", ...leadCard(commentOf(id)) };
}
