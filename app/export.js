// تصدير الفترة المختارة لملف إكسل: الملخص، والبوستات، والأيام، والعملاء، والمبيعات، والستوري، والجمهور
import { db } from "./db.js";
import { report, localStart } from "./analysis.js";
import { stage } from "./leads.js";
import { buildXlsx } from "./xlsx.js";
import { L, isEn, lbl } from "./i18n.js";

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const when = (ts) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const firstLine = (s) => (s || "").replace(/[‎‏⁦-⁩\t]+/g, " ").split("\n").map((l) => l.trim()).find(Boolean) || "";
const pct = (v) => ({ v, pct: true });
const round = (x) => (x == null ? null : Math.round(x));
const nextDay = (d) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
const KIND = { REELS: ["ريل", "Reel"], CAROUSEL_ALBUM: ["كاروسيل", "Carousel"], IMAGE: ["صورة", "Photo"], VIDEO: ["فيديو", "Video"] };
const kind = (k) => (KIND[k] ? L(...KIND[k]) : k || "");

export function exportXlsx(accountId, from, to) {
  const rep = report(accountId, from, to);
  const k = rep.kpis, pk = rep.prev_kpis, acc = rep.account;

  const summary = [
    [L("المقياس", "Metric"), L("هالفترة", "This period"), L("الفترة اللي قبلها", "Previous period")],
    [L("من", "From"), from, rep.period.prev_from],
    [L("إلى", "To"), to, rep.period.prev_to],
    [L("البوستات", "Posts"), k.posts, pk.posts],
    [L("وصول البوستات", "Post reach"), k.reach, pk.reach],
    [L("متوسط الوصول للبوست", "Avg reach per post"), round(k.avg_reach), round(pk.avg_reach)],
    [L("نسبة التفاعل", "Engagement rate"), pct(k.avg_er), pct(pk.avg_er)],
    [L("الحفظ والمشاركة", "Saves & shares"), pct(k.avg_fair), pct(pk.avg_fair)],
    [L("الحفظ", "Saves"), k.saved, pk.saved],
    [L("المشاركات", "Shares"), k.shares, pk.shares],
    [L("وصول الحساب", "Account reach"), k.account_reach, pk.account_reach],
    [L("زيارات البروفايل", "Profile visits"), k.profile_visits, pk.profile_visits],
    [L("نقرات الرابط", "Link taps"), k.link_taps, pk.link_taps],
    // بدون الصافي، «متابعين جدد» = «تابعوك» تحت، فما نكررها
    ...(k.follower_net ? [[L("صافي المتابعين", "Net followers"), k.follower_growth, pk.follower_net ? pk.follower_growth : null]] : []),
    [L("تابعوك", "Followed"), k.follows, pk.follows],
    [L("ألغوا متابعتك", "Unfollowed"), k.unfollows, pk.unfollows],
    [L("أسئلة السعر والتسجيل", "Price & sign-up questions"), rep.comments.kpis.leads, rep.comments.prev_kpis.leads],
    [L("التسجيلات", "Sign-ups"), rep.sales?.kpis?.count ?? null, rep.sales?.prev_kpis?.count ?? null],
    [L("المبيعات (ريال)", "Revenue (SAR)"), rep.sales?.kpis?.revenue ?? null, rep.sales?.prev_kpis?.revenue ?? null],
    [],
    [L("الحساب", "Account"), "@" + acc.username],
    [L("المتابعين الحين", "Followers now"), acc.followers],
    [L("التوقيت", "Time zone"), TZ],
  ];

  const posts = [
    [L("التاريخ", "Date"), L("النوع", "Type"), L("أول سطر", "First line"), L("الوصول", "Reach"), L("المشاهدات", "Views"), L("اللايكات", "Likes"), L("التعليقات", "Comments"),
      L("الحفظ", "Saves"), L("المشاركات", "Shares"), L("نسبة التفاعل", "Engagement"), L("الحفظ والمشاركة", "Saves & shares"), L("متوسط المشاهدة (ث)", "Avg watch (s)"), L("الرابط", "Link")],
    ...[...rep.posts].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map((p) => [when(p.timestamp), kind(p.kind), firstLine(p.caption).slice(0, 120), p.reach, p.views, p.likes, p.comments,
      p.saved, p.shares, pct(p.er), pct(p.fair), p.avg_watch_time != null ? Math.round(p.avg_watch_time * 10) / 10 : null, p.permalink]),
  ];

  const days = [
    [L("اليوم", "Day"), L("المتابعين", "Followers"), L("تابعوك", "Followed"), L("ألغوا", "Unfollowed"), L("وصول الحساب", "Account reach"), L("المشاهدات", "Views"), L("زيارات البروفايل", "Profile visits"), L("نقرات الرابط", "Link taps")],
    ...db.prepare("SELECT * FROM daily WHERE account_id = ? AND date >= ? AND date <= ? ORDER BY date").all(accountId, from, to)
      .map((d) => [d.date, d.followers, d.follows, d.unfollows, d.reach, d.views, d.link_ok ? d.profile_views : null, d.link_ok ? d.link_taps : null]),
  ];

  const stageName = (s) => (s ? (isEn() ? lbl(s) : s) : "");
  const dmName = { sent: L("انرسلت", "Sent"), failed: L("ما وصلت", "Failed"), skipped: L("تخطّاه", "Skipped") };
  const leads = [
    [L("التاريخ", "Date"), L("الشخص", "Person"), L("التعليق", "Comment"), L("النوع", "Type"), L("المرحلة", "Stage"), L("الخاص التلقائي", "Auto DM"), L("البوست", "Post")],
    ...db.prepare(`SELECT c.*, m.permalink FROM comments c LEFT JOIN media m ON m.id = c.media_id
      WHERE c.account_id = ? AND c.intent IS NOT NULL AND c.timestamp >= ? AND c.timestamp < ? ORDER BY c.timestamp`).all(accountId, localStart(from), localStart(nextDay(to)))
      .map((c) => [when(c.timestamp), "@" + (c.username || ""), c.text, isEn() ? lbl(c.intent) : c.intent, stageName(stage(c)) || (c.replied ? L("رديت", "Replied") : ""), dmName[c.dm_status] || "", c.permalink]),
  ];

  const sales = [
    [L("التاريخ", "Date"), L("العدد", "Count"), L("المبلغ", "Amount"), L("المصدر", "Source"), L("ملاحظة", "Note"), L("البوست", "Post")],
    ...db.prepare(`SELECT s.*, m.permalink FROM sales s LEFT JOIN media m ON m.id = s.media_id WHERE s.account_id = ? AND s.date >= ? AND s.date <= ? ORDER BY s.date`).all(accountId, from, to)
      .map((s) => [s.date, s.count, s.amount, isEn() ? lbl(s.source || "") : s.source, s.note, s.permalink]),
  ];

  const stories = [
    [L("الوقت", "Time"), L("الوصول", "Reach"), L("المشاهدات", "Views"), L("الردود", "Replies"), L("المشاركات", "Shares"), L("زيارات البروفايل", "Profile visits"), L("متابعين", "Follows"), L("طلعوا", "Exits"), L("الرابط", "Link")],
    ...[...rep.stories.list].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((s) => [when(s.timestamp), s.reach, s.views, s.replies, s.shares, s.profile_visits, s.follows, s.exits, s.permalink]),
  ];

  const sheets = [
    { name: L("الملخص", "Summary"), rows: summary, widths: [28, 22, 34] },
    { name: L("البوستات", "Posts"), rows: posts, widths: [17, 10, 50, 10, 11, 10, 10, 9, 10, 11, 14, 14, 44] },
    { name: L("الأيام", "Days"), rows: days, widths: [12, 12, 10, 10, 13, 12, 15, 12] },
    { name: L("العملاء", "Leads"), rows: leads, widths: [17, 20, 50, 10, 14, 14, 44] },
    { name: L("المبيعات", "Sales"), rows: sales, widths: [12, 8, 10, 18, 30, 44] },
    { name: L("الستوري", "Stories"), rows: stories, widths: [17, 10, 11, 10, 11, 15, 10, 10, 44] },
  ];

  const a = rep.audience;
  if (a) {
    const region = new Intl.DisplayNames([L("ar", "en")], { type: "region" });
    const cname = (c) => { try { return region.of(c); } catch { return c; } };
    const e = a.engaged;
    const rows = [[L("الفئة", "Group"), L("القيمة", "Value"), L("من المتابعين", "Of followers"), L("من المتفاعلين هالشهر", "Of engaged this month")]];
    for (const x of a.followers.age) rows.push([L("العمر", "Age"), x.key, pct(x.share), e ? pct(e.age.find((y) => y.key === x.key)?.share || 0) : null]);
    for (const x of a.followers.gender.list) rows.push([L("الجنس", "Gender"), x.key === "M" ? L("رجال", "Men") : L("نساء", "Women"), pct(x.share), e ? pct(e.gender.list.find((y) => y.key === x.key)?.share || 0) : null]);
    for (const x of a.countries) rows.push([L("الدولة", "Country"), cname(x.key), pct(x.share), e ? pct(e.country[x.key] || 0) : null]);
    for (const x of a.followers.city.list) rows.push([L("المدينة", "City"), x.key.split(",")[0], pct(x.share), null]);
    sheets.push({ name: L("الجمهور", "Audience"), rows, widths: [12, 26, 14, 20] });
  }

  return { file: buildXlsx(sheets, { rtl: !isEn() }), name: `${acc.username}-${from}-${to}.xlsx` };
}
