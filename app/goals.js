// أهداف الشهر: متابعين جدد، تسجيلات، إيراد. وين وصلت، وهل أنت على الوتيرة، وكم تحتاج باليوم
import { db } from "./db.js";
import { save as saveAlert } from "./alerts.js";
import { L, isEn } from "./i18n.js";

db.exec(`CREATE TABLE IF NOT EXISTS goals (
  account_id TEXT, month TEXT, metric TEXT, target REAL,
  PRIMARY KEY (account_id, month, metric)
)`);

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
export const METRICS = {
  followers: { name: "متابعين جدد", unit: "متابع" },
  sales: { name: "تسجيلات", unit: "تسجيل" },
  revenue: { name: "الإيراد", unit: "ريال" },
};
const METRICS_EN = { followers: { name: "New followers", unit: "followers" }, sales: { name: "Sign-ups", unit: "sign-ups" }, revenue: { name: "Revenue", unit: "SAR" } };
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const n = (x) => Math.round(x).toLocaleString("en-US");

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const hourNow = () => +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date());
export const monthOf = (date = today()) => date.slice(0, 7);
const daysIn = (month) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
const prevMonth = (month) => { const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); };
export const monthName = (month) => `${(isEn() ? MONTHS_EN : MONTHS)[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`;

// كم وصلت في الشهر لكل مقياس
function actuals(accountId, month) {
  const from = `${month}-01`, to = `${month}-${String(daysIn(month)).padStart(2, "0")}`;
  const s = db.prepare("SELECT COALESCE(SUM(count), 0) c, SUM(amount) a FROM sales WHERE account_id = ? AND date BETWEEN ? AND ?").get(accountId, from, to);
  // المتابعين: الصافي (الحين ناقص نهاية الشهر اللي قبله) إذا عندنا عددهم وقتها، وإلا مجموع المتابعات الجديدة من Meta
  const start = db.prepare("SELECT followers FROM daily WHERE account_id = ? AND date < ? AND date >= ? AND followers IS NOT NULL ORDER BY date DESC LIMIT 1")
    .get(accountId, from, prevMonth(month) + "-28");
  const end = db.prepare("SELECT followers FROM daily WHERE account_id = ? AND date BETWEEN ? AND ? AND followers IS NOT NULL ORDER BY date DESC LIMIT 1").get(accountId, from, to);
  const gross = db.prepare("SELECT SUM(new_followers) g FROM daily WHERE account_id = ? AND date BETWEEN ? AND ?").get(accountId, from, to).g;
  const net = start && end ? end.followers - start.followers : null;
  return {
    followers: net ?? gross ?? 0, followers_note: net != null ? L("الصافي: الجدد ناقص اللي ألغوا المتابعة", "Net: new followers minus unfollows") : L("المتابعات الجديدة من Meta (بدون اللي ألغوا)، وتتأخر يوم أو يومين", "New follows reported by Meta (unfollows not subtracted), delayed by a day or two"),
    sales: s.c, revenue: s.a || 0,
  };
}

// اقتراح هدف: الشهر اللي راح + ٢٠٪ (مدوّر)
function suggest(accountId, month) {
  const last = actuals(accountId, prevMonth(month));
  const up = (x, step) => (x > 0 ? Math.max(step, Math.ceil((x * 1.2) / step) * step) : null);
  return { followers: up(last.followers, 50), sales: up(last.sales, 1), revenue: up(last.revenue, 500) };
}

export function goalStatus(accountId, month = monthOf()) {
  const set = Object.fromEntries(db.prepare("SELECT metric, target FROM goals WHERE account_id = ? AND month = ?").all(accountId, month).map((r) => [r.metric, r.target]));
  const days = daysIn(month), t = today();
  const isNow = monthOf(t) === month;
  // الأيام اللي راحت (اليوم ينحسب نص يوم)
  const elapsed = isNow ? Math.max(0.5, +t.slice(8, 10) - 0.5) : t > month ? days : 0;
  const act = actuals(accountId, month);
  const goals = Object.entries(METRICS).filter(([k]) => set[k] > 0).map(([k, m]) => {
    const target = set[k], actual = act[k];
    const expected = (target * elapsed) / days;
    const pace = expected ? actual / expected : null;
    const left = Math.max(0, target - actual), daysLeft = Math.max(0, days - elapsed);
    return {
      metric: k, ...m, ...(isEn() ? METRICS_EN[k] : {}), target, actual, progress: actual / target, expected, pace,
      status: actual >= target ? "done" : pace == null || elapsed < 3 ? "early" : pace >= 1 ? "ahead" : pace >= 0.8 ? "close" : "behind",
      projection: elapsed ? (actual / elapsed) * days : null,
      per_day: daysLeft ? left / daysLeft : null, per_week: daysLeft ? (left / daysLeft) * 7 : null,
      note: k === "followers" ? act.followers_note : null,
    };
  });
  return { month, month_name: monthName(month), days, elapsed, days_left: Math.max(0, Math.ceil(days - elapsed)), goals, targets: set, suggest: suggest(accountId, month) };
}

export function setGoals(accountId, month, targets) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) throw new Error(L("الشهر غلط", "Invalid month"));
  for (const k of Object.keys(METRICS)) {
    if (!(k in targets)) continue;
    const v = targets[k] === "" || targets[k] == null ? null : +targets[k];
    if (v != null && !(v >= 0 && Number.isFinite(v))) throw new Error(L(`${METRICS[k].name}: اكتب رقم`, `${METRICS_EN[k].name}: enter a number`));
    if (v) db.prepare("INSERT INTO goals (account_id, month, metric, target) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, month, metric) DO UPDATE SET target = excluded.target").run(accountId, month, k, v);
    else db.prepare("DELETE FROM goals WHERE account_id = ? AND month = ? AND metric = ?").run(accountId, month, k);
  }
  return goalStatus(accountId, month);
}

// العدد مع الكلمة: ٣–١٠ جمع، والباقي مفرد (يوم/أيام، متابع/متابعين، تسجيل/تسجيلات)
const PLURAL = { "يوم": "أيام", "متابع": "متابعين", "تسجيل": "تسجيلات" };
const count = (x, word) => { const k = Math.round(x); return `${n(k)} ${k >= 3 && k <= 10 ? PLURAL[word] || word : word}`; };
const line = (g) => `${g.name}: ${n(g.actual)} من ${n(g.target)}${g.metric === "revenue" ? " ريال" : ""}`;

// تنبيهات: يوم ١٥ إذا متأخر، وأول الشهر الجاي ملخص الشهر اللي راح
export function goalReminders(accountIds) {
  const t = today();
  if (hourNow() < 10) return;
  const day = +t.slice(8, 10);
  for (const id of accountIds) {
    const month = monthOf(t);
    if (day >= 15) {
      const st = goalStatus(id, month);
      const late = st.goals.filter((g) => g.status === "behind");
      if (late.length) saveAlert(id, null, `goal-mid:${month}`, "🎯 متأخر عن هدف الشهر",
        late.map((g) => `${line(g)}، تحتاج ${g.metric === "revenue" ? n(g.per_week) + " ريال" : count(g.per_week, g.unit)} بالأسبوع عشان تلحق`).join(". ") + `. باقي ${count(st.days_left, "يوم")}.`);
    }
    const prev = goalStatus(id, prevMonth(month));
    if (prev.goals.length) {
      const done = prev.goals.filter((g) => g.actual >= g.target).length;
      saveAlert(id, null, `goal-end:${prev.month}`, done === prev.goals.length ? `🏆 حققت أهداف ${prev.month_name}` : `🎯 نتيجة أهداف ${prev.month_name}`,
        prev.goals.map((g) => `${line(g)} ${g.actual >= g.target ? "✓" : `(${Math.round(g.progress * 100)}٪)`}`).join(" · ") + ". حدد أهداف الشهر الجديد من اللوحة.");
    }
  }
}
