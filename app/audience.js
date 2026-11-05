// مين جمهورك: الأعمار والجنس والدول والمدن من انستجرام، لمتابعينك كلهم وللي تفاعلوا معك هالشهر
// Meta تحدّثها مرة باليوم، وتعطيها بس للحسابات اللي فوق ١٠٠ متابع. نحفظ لقطة كل يوم عشان مع الوقت يبين التغيّر
import { db } from "./db.js";
import { ig } from "./instagram.js";

db.exec(`CREATE TABLE IF NOT EXISTS audience (
  account_id TEXT, date TEXT, kind TEXT, dim TEXT, key TEXT, value INTEGER,
  PRIMARY KEY (account_id, date, kind, dim, key))`);

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const AGES = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
export const GULF = ["SA", "KW", "AE", "QA", "BH", "OM"];

// followers = كل متابعينك، engaged = اللي تفاعلوا معك هالشهر (لايك، تعليق، حفظ، مشاركة، رد)
const FETCH = [
  ["followers", "follower_demographics", ["age", "gender", "country", "city"], {}],
  ["engaged", "engaged_audience_demographics", ["age", "gender", "country"], { timeframe: "this_month" }],
];

// يشتغل مع المزامنة الكاملة، ومرة وحدة باليوم بس
export async function syncAudience(acc, token) {
  const day = today();
  if (db.prepare("SELECT 1 FROM audience WHERE account_id = ? AND date = ? LIMIT 1").get(acc.id, day)) return;
  const put = db.prepare("INSERT OR REPLACE INTO audience (account_id, date, kind, dim, key, value) VALUES (?, ?, ?, ?, ?, ?)");
  for (const [kind, metric, dims, extra] of FETCH) {
    for (const dim of dims) {
      let r;
      try {
        r = await ig("/me/insights", { metric, period: "lifetime", metric_type: "total_value", breakdown: dim, ...extra }, token);
      } catch (e) {
        if ([4, 17, 32, 190].includes(e.code)) throw e;
        continue; // أقل من ١٠٠ متابع أو ما فيه تفاعل كفاية: Meta ترجع خطأ، نكمل بالباقي
      }
      for (const x of r.data?.[0]?.total_value?.breakdowns?.[0]?.results || []) {
        if (x.value > 0) put.run(acc.id, day, kind, dim, String(x.dimension_values[0]), x.value);
      }
    }
  }
}

function shares(rows, dim) {
  const list = rows.filter((r) => r.dim === dim);
  const total = list.reduce((s, r) => s + r.value, 0);
  return { total, list: list.map((r) => ({ key: r.key, value: r.value, share: total ? r.value / total : 0 })) };
}

export function audienceReport(accountId) {
  const last = db.prepare("SELECT MAX(date) d FROM audience WHERE account_id = ? AND kind = 'followers'").get(accountId)?.d;
  if (!last) return null;
  const rows = db.prepare("SELECT kind, dim, key, value FROM audience WHERE account_id = ? AND date = ?").all(accountId, last);
  const F = rows.filter((r) => r.kind === "followers"), E = rows.filter((r) => r.kind === "engaged");

  const age = (src) => {
    const s = shares(src, "age");
    return AGES.map((k) => s.list.find((x) => x.key === k) || { key: k, value: 0, share: 0 });
  };
  // الجنس: نسبة الرجال والنساء من اللي معروف جنسهم، و«غير معروف» لحاله
  const gender = (src) => {
    const s = shares(src, "gender");
    const known = s.list.filter((x) => x.key !== "U"), kt = known.reduce((a, x) => a + x.value, 0);
    return {
      list: ["M", "F"].map((k) => { const v = known.find((x) => x.key === k)?.value || 0; return { key: k, value: v, share: kt ? v / kt : 0 }; }),
      unknown: s.total ? (s.list.find((x) => x.key === "U")?.value || 0) / s.total : 0,
    };
  };
  const top = (src, dim, k = 6) => {
    const s = shares(src, dim);
    const sorted = s.list.sort((a, b) => b.value - a.value);
    const rest = sorted.slice(k).reduce((a, x) => a + x.share, 0);
    return { list: sorted.slice(0, k), other: rest, total: s.total };
  };

  const fAge = age(F), fGender = gender(F), fCountry = top(F, "country"), fCity = top(F, "city");
  const engagedTotal = shares(E, "age").total;
  // المتفاعلين يحتاجون عدد معقول قبل ما نقارنهم بالمتابعين
  const eOk = engagedTotal >= 100;
  const eAge = eOk ? age(E) : null, eGender = eOk ? gender(E) : null, eCountry = eOk ? shares(E, "country") : null;
  const gulf = shares(F, "country").list.filter((x) => GULF.includes(x.key));

  return {
    date: last,
    total: shares(F, "age").total,
    engaged_total: engagedTotal,
    followers: { age: fAge, gender: fGender, country: fCountry, city: fCity },
    engaged: eOk ? {
      age: eAge, gender: eGender,
      // نسبة كل دولة من المتفاعلين
      country: Object.fromEntries(eCountry.list.map((x) => [x.key, x.share])),
    } : null,
    // كل الدول اللي فيها ١٪ أو أكثر من متابعينك (للنصائح: دول ما تتفاعل، ودول تتفاعل أكثر من حجمها)
    countries: shares(F, "country").list.filter((x) => x.share >= 0.01).sort((a, b) => b.share - a.share).map((x) => ({ key: x.key, value: x.value, share: x.share })),
    // كل الدول اللي يعطيها انستجرام (أكبر ٤٥ دولة)، للخريطة
    map: shares(F, "country").list.map((x) => ({ key: x.key, value: x.value, share: x.share })),
    gulf_share: gulf.reduce((a, x) => a + x.share, 0),
    gulf: gulf.sort((a, b) => b.share - a.share),
  };
}
