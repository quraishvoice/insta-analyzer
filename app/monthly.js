// التقرير الشهري: الشهر كامل مقارنة بالشهر اللي قبله، وآخر ٦ شهور، والأهداف، والتجارب اللي خلصت فيه
// وأول كل شهر يوصلك ملخص الشهر اللي راح مع رابط التقرير
import { db } from "./db.js";
import { report, localStart } from "./analysis.js";
import { advise } from "./advisor.js";
import { goalStatus, monthName, monthOf } from "./goals.js";
import { median } from "./hashtags.js";
import { evaluate, verdictName } from "./experiments.js";
import { save as saveAlert } from "./alerts.js";
import { L } from "./i18n.js";

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const daysIn = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
export const shiftMonth = (m, k) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + k, 1)).toISOString().slice(0, 7);
const bounds = (m) => ({ from: `${m}-01`, to: `${m}-${String(daysIn(m)).padStart(2, "0")}` });
// أول سطر بدون ما نقص كلمة بالنص
const short = (c, k = 45) => { const l = (c || "").replace(/[⁦-⁩‎‏]/g, "").split("\n").find((x) => x.trim())?.trim() || "بدون كابشن"; return l.length <= k ? l : l.slice(0, k).replace(/\s+\S*$/, "") + "…"; };
const n = (x) => Math.round(x || 0).toLocaleString("en-US");

// الريلز في الفترة: كم طولها وكم شافوا منها
const nextDay = (d) => new Date(Date.parse(d + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
function reelsOf(accountId, from, to) {
  const list = db.prepare("SELECT avg_watch_time, duration FROM media WHERE account_id = ? AND product_type = 'REELS' AND NOT trial AND avg_watch_time > 0 AND timestamp >= ? AND timestamp < ?")
    .all(accountId, localStart(from), localStart(nextDay(to)));
  const withDur = list.filter((r) => r.duration > 0);
  return {
    count: list.length, watch: median(list.map((r) => r.avg_watch_time)),
    duration: withDur.length >= 2 ? median(withDur.map((r) => r.duration)) : null,
    ret: withDur.length >= 2 ? median(withDur.map((r) => Math.min(1, r.avg_watch_time / r.duration))) : null,
    under_minute: withDur.filter((r) => r.duration < 60).length,
  };
}

// ملخص خفيف لكل شهر (للجدول)
function monthRow(accountId, m) {
  const { from, to } = bounds(m);
  const p = db.prepare("SELECT COUNT(*) posts, SUM(reach) reach, SUM(views) views, SUM(saved) saved, SUM(shares) shares, SUM(follows) follows FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial AND timestamp >= ? AND timestamp < ?")
    .get(accountId, localStart(from), localStart(shiftMonth(m, 1) + "-01"));
  const s = db.prepare("SELECT COALESCE(SUM(count), 0) c, SUM(amount) a FROM sales WHERE account_id = ? AND date BETWEEN ? AND ?").get(accountId, from, to);
  const leads = db.prepare("SELECT COUNT(*) c FROM comments WHERE account_id = ? AND intent IN ('سعر', 'تسجيل') AND timestamp >= ? AND timestamp < ?")
    .get(accountId, localStart(from), localStart(shiftMonth(m, 1) + "-01")).c;
  return { month: m, name: monthName(m), posts: p.posts, reach: p.reach || 0, avg_reach: p.posts ? (p.reach || 0) / p.posts : null, views: p.views || 0, follows: p.follows || 0, leads, sales: s.c, revenue: s.a };
}

const posts = (k) => L(k === 1 ? "بوست واحد" : k === 2 ? "بوستين" : `${n(k)} ${k <= 10 ? "بوستات" : "بوست"}`, `${n(k)} ${k === 1 ? "post" : "posts"}`);

// جملة الخلاصة: أهم ٣ أشياء صارت في الشهر
function summary(r, prev, reels, prevReels, goals) {
  const k = r.kpis, pk = r.prev_kpis, out = [];
  const ch = (a, b) => (a != null && b ? (a - b) / b : null);
  const reach = ch(k.avg_reach, pk.avg_reach);
  if (reach != null && Math.abs(reach) >= 0.1) out.push(L(`متوسط وصول البوست ${reach > 0 ? "زاد" : "نزل"} ${Math.round(Math.abs(reach) * 100)}٪ عن ${prev}`, `Average reach per post ${reach > 0 ? "rose" : "fell"} ${Math.round(Math.abs(reach) * 100)}% vs. ${prev}`));
  if (k.posts !== pk.posts && pk.posts) out.push(L(`نزّلت ${posts(k.posts)} (${k.posts > pk.posts ? "أكثر" : "أقل"} من ${prev} بـ ${n(Math.abs(k.posts - pk.posts))})`, `You published ${posts(k.posts)} (${n(Math.abs(k.posts - pk.posts))} ${k.posts > pk.posts ? "more" : "fewer"} than ${prev})`));
  // الصافي «المتابعين»، والمتابعات الجديدة من Meta (بدون اللي ألغوا) «متابعين جدد»
  if (k.follower_growth != null) out.push(L(`${k.follower_net ? "صافي المتابعين" : "متابعين جدد"} ${k.follower_growth >= 0 ? "+" : ""}${n(k.follower_growth)}`, `${k.follower_net ? "Net followers" : "New followers"} ${k.follower_growth >= 0 ? "+" : ""}${n(k.follower_growth)}`));
  if (reels.ret != null && prevReels.ret != null && Math.abs(reels.ret - prevReels.ret) >= 0.03)
    out.push(L(`الناس شافوا ${Math.round(reels.ret * 100)}٪ من ريلزك (${prevReels.ret < reels.ret ? "أحسن" : "أقل"} من ${Math.round(prevReels.ret * 100)}٪)`, `People watched ${Math.round(reels.ret * 100)}% of your Reels (${prevReels.ret < reels.ret ? "up" : "down"} from ${Math.round(prevReels.ret * 100)}%)`));
  if (r.sales.kpis.count) out.push(L(`${{ 1: "تسجيل واحد", 2: "تسجيلين" }[r.sales.kpis.count] || `${n(r.sales.kpis.count)} ${r.sales.kpis.count <= 10 ? "تسجيلات" : "تسجيل"}`}${r.sales.kpis.revenue ? ` بـ ${n(r.sales.kpis.revenue)} ريال` : ""}`,
    `${n(r.sales.kpis.count)} ${r.sales.kpis.count === 1 ? "sign-up" : "sign-ups"}${r.sales.kpis.revenue ? ` worth ${n(r.sales.kpis.revenue)} SAR` : ""}`));
  const done = goals.goals.filter((g) => g.actual >= g.target).length;
  if (goals.goals.length) out.push(done === goals.goals.length ? L("حققت كل أهدافك 🏆", "You hit all your goals 🏆") : L(`حققت ${done} من ${goals.goals.length} أهداف`, `You hit ${done} of ${goals.goals.length} goals`));
  return out.length ? out.join(L("، ", ". ")) + "." : L("ما فيه نشاط كفاية في هالشهر.", "Not enough activity this month.");
}

export function monthly(accountId, month = shiftMonth(monthOf(today()), -1)) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(L("الشهر غلط", "Invalid month"));
  const { from, to } = bounds(month);
  const pm = shiftMonth(month, -1);
  const isNow = month === monthOf(today());
  // الشهر الحالي: لين اليوم، ومقارنة بنفس عدد الأيام من الشهر اللي قبله
  const end = isNow ? today() : to;
  const prev = isNow ? { from: `${pm}-01`, to: `${pm}-${String(Math.min(daysIn(pm), +end.slice(8, 10))).padStart(2, "0")}` } : bounds(pm);
  const r = report(accountId, from, end, prev);
  const goals = goalStatus(accountId, month);
  const reels = reelsOf(accountId, from, end), prevReels = reelsOf(accountId, prev.from, prev.to);
  // أرقام المتابعين اليومية: Meta تعطي آخر ٣٠ يوم بس، فأول شهر بعد ربط الحساب ناقص
  const cov = db.prepare("SELECT COUNT(*) n, MIN(date) first FROM daily WHERE account_id = ? AND date BETWEEN ? AND ? AND (followers IS NOT NULL OR new_followers IS NOT NULL)").get(accountId, from, end);
  const days = Math.round((Date.parse(end) - Date.parse(from)) / 864e5) + 1;
  const followers_note = cov.n < days * 0.7 ? (cov.n ? L(`أرقام المتابعين اليومية عندنا من ${new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(cov.first))} بس، فما نقدر نحسب نمو الشهر كامل.`,
    `Daily follower numbers only go back to ${new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(cov.first))}, so the full month's growth can't be calculated.`)
    : L("ما عندنا أرقام المتابعين لهالشهر (Meta تعطي آخر ٣٠ يوم بس).", "No follower numbers for this month (Meta only provides the last 30 days).")) : null;
  const experiments = db.prepare("SELECT * FROM experiments WHERE account_id = ? AND end BETWEEN ? AND ? ORDER BY end").all(accountId, from, to).map(evaluate);
  return {
    month, month_name: monthName(month), prev_month: pm, prev_name: monthName(pm), partial: isNow, to: end, prev,
    summary: summary(r, monthName(pm).split(" ")[0], reels, prevReels, goals),
    report: { ...r, advice: advise({ ...r, goals }) }, goals, reels, prev_reels: prevReels, experiments,
    followers_note, months: Array.from({ length: 6 }, (_, i) => monthRow(accountId, shiftMonth(month, i - 5))),
  };
}

// نص تيليجرام (يستخدمه التنبيه وأمر /الشهر)
export function monthText(accountId, month) {
  const M = monthly(accountId, month), k = M.report.kpis, pk = M.report.prev_kpis;
  const d = (a, b) => { if (a == null || !b) return ""; const x = Math.round(((a - b) / b) * 100); return x > 0 ? ` (↑ ${x}٪)` : x < 0 ? ` (↓ ${-x}٪)` : ""; };
  const lines = [M.partial ? `📈 ${M.month_name} لين اليوم (مقارنة بنفس الأيام من ${M.prev_name.split(" ")[0]})` : `📈 تقرير ${M.month_name}`, "", M.summary, ""];
  lines.push(`🎬 البوستات: ${n(k.posts)}${d(k.posts, pk.posts)}`);
  lines.push(`👁 متوسط الوصول للبوست: ${n(k.avg_reach)}${d(k.avg_reach, pk.avg_reach)}`);
  if (k.follower_growth != null) lines.push(`👥 ${k.follower_net ? "صافي المتابعين" : "متابعين جدد"}: ${k.follower_growth >= 0 ? "+" : ""}${n(k.follower_growth)}`);
  if (M.reels.count) lines.push(`⏱ الريلز: ${n(M.reels.count)}${M.reels.ret != null ? `، شافوا ${Math.round(M.reels.ret * 100)}٪ منها` : ""}${M.reels.duration ? `، وطولها ${Math.round(M.reels.duration)} ثانية بالمتوسط` : ""}`);
  const cm = M.report.comments.kpis;
  if (cm.leads) lines.push(`🙋 سألوا عن السعر أو التسجيل: ${n(cm.leads)}`);
  if (M.report.sales.kpis.count) lines.push(`💰 التسجيلات: ${n(M.report.sales.kpis.count)}${M.report.sales.kpis.revenue ? ` · ${n(M.report.sales.kpis.revenue)} ريال` : ""}`);
  const best = M.report.top[0];
  if (best) lines.push("", `🏆 أقوى بوست: «${short(best.caption)}» (وصل لـ ${n(best.reach)})`);
  for (const e of M.experiments) lines.push(`🧪 تجربة «${e.name}»: ${verdictName(e.verdict)}`);
  const step = M.report.advice.recommendations[0];
  if (step) lines.push("", `👉 أهم خطوة ${M.partial ? "لباقي الشهر" : "للشهر الجاي"}: ${step.title}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// أول الشهر من الساعة ٩ (أو أول ما يصحى الماك بعدها، لين يوم ٧): تقرير الشهر اللي راح
export function monthlyDigest(accountIds) {
  const t = today();
  const h = +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date());
  // بس أول أسبوع من الشهر، عشان ما يوصلك تقرير شهر قديم
  if ((+t.slice(8, 10) === 1 && h < 9) || +t.slice(8, 10) > 7) return;
  const m = shiftMonth(monthOf(t), -1);
  for (const id of accountIds) {
    if (db.prepare("SELECT 1 FROM alerts WHERE account_id = ? AND kind = ?").get(id, `monthly:${m}`)) continue;
    if (!db.prepare("SELECT 1 FROM media WHERE account_id = ? AND timestamp >= ? LIMIT 1").get(id, `${m}-01`)) continue;
    const text = monthText(id, m).split("\n").slice(2).join("\n");
    saveAlert(id, null, `monthly:${m}`, `📈 تقرير ${monthName(m)} جاهز`, text + "\n\nالتقرير كامل في اللوحة ← «التقرير الشهري».", `/monthly.html?id=${encodeURIComponent(id)}&month=${m}`);
  }
}
