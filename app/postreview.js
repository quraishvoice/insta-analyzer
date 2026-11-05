// تقرير كل بوست بعد يومين: كيف مشى مقارنة بعادتك، وليش على الأغلب، ووش الدرس للبوست الجاي
// يوصلك مرة وحدة لكل بوست (الماك وتيليجرام)، للبوستات اللي عمرها بين ٤٨ و٩٦ ساعة
import { db } from "./db.js";
import { report } from "./analysis.js";
import { bestTime } from "./planner.js";
import { topicOf } from "./topics.js";
import { tagsOf, median } from "./hashtags.js";
import { CTA } from "./advisor.js";
import { save as saveAlert } from "./alerts.js";
import { reelWatch } from "./watch.js";

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const KIND_NAMES = { REELS: "الريل", CAROUSEL_ALBUM: "الكاروسيل", IMAGE: "البوست", VIDEO: "الفيديو" };
const kindOf = (p) => (p.product_type === "REELS" ? "REELS" : p.media_type);
const intentOf = (p) => (p.reach ? ((p.saved || 0) + 1.5 * (p.shares || 0) + 2 * (p.profile_visits || 0) + 3 * (p.follows || 0)) / p.reach : null);
const n = (x) => Math.round(x).toLocaleString("en-US");
const clean = (c) => (c || "").replace(/[⁦-⁩‎‏\t]/g, "");
const firstLine = (c) => clean(c).split("\n").find((l) => l.trim())?.trim() || "";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const hourOf = (iso) => +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(iso));
const hourName = (h) => (h === 0 ? "١٢ بالليل" : h < 12 ? `${h} الصبح` : h === 12 ? "١٢ الظهر" : `${h - 12} ${h < 15 ? "الظهر" : h < 18 ? "العصر" : h < 20 ? "المغرب" : "الليل"}`);
const times = (r) => (r >= 1.95 ? `${r >= 2.05 ? Math.round(r * 10) / 10 + " أضعاف" : "ضعف"} عادتك` : r >= 1.05 ? `أعلى من عادتك بـ ${n((r - 1) * 100)}٪` : r <= 0.95 ? `أقل من عادتك بـ ${n((1 - r) * 100)}٪` : "مثل عادتك");

export function reviewPost(accountId, post, rep) {
  const kind = kindOf(post);
  // نقارن بنفس النوع خلال آخر ٦٠ يوم (البوستات اللي اكتملت أرقامها)
  const t = Date.parse(post.timestamp);
  const peers = db.prepare(`SELECT * FROM media WHERE account_id = ? AND id != ? AND product_type != 'STORY' AND NOT trial AND reach > 0 AND timestamp BETWEEN ? AND ?`)
    .all(accountId, post.id, new Date(t - 60 * 864e5).toISOString().slice(0, 19), new Date(t - 3 * 864e5).toISOString().slice(0, 19))
    .filter((p) => kindOf(p) === kind);
  if (peers.length < 5 || !post.reach) return null;
  const rReach = post.reach / median(peers.map((p) => p.reach));
  const mi = median(peers.map(intentOf).filter((x) => x != null));
  const rIntent = mi && intentOf(post) != null ? intentOf(post) / mi : null;
  const leads = db.prepare("SELECT COUNT(*) n FROM comments WHERE media_id = ? AND intent IN ('سعر', 'تسجيل')").get(post.id).n;
  // الحكم على الوصول أول، والاهتمام يعدّله: وصول أقل مع اهتمام أعلى (أو العكس) = «مختلط»، مو «مثل عادتك»
  const ri = rIntent ?? 1;
  const verdict = rReach >= 1.3 ? (ri <= 0.9 ? "mixed" : "strong")
    : rReach <= 0.75 ? (ri >= 1.1 ? "mixed" : "weak")
    : ri >= 1.3 ? "strong" : ri <= 0.75 ? "weak" : "normal";

  // العوامل: كل واحد إيجابي أو سلبي، ومعه الدرس
  const f = [];
  const topic = topicOf(post.caption);
  const ts = rep.topics?.ready ? rep.topics.topics.find((x) => x.name === topic) : null;
  if (ts?.enough && ts.reach_lift > 0.15) f.push({ good: true, why: `موضوع «${topic}» يوصل عندك أعلى من عادتك`, lesson: `كمّل على «${topic}»` });
  if (ts?.enough && ts.reach_lift < -0.15) f.push({ good: false, why: `موضوع «${topic}» وصوله عندك عادةً أقل`, lesson: rep.topics.best.reach ? `للوصول، «${rep.topics.best.reach}» يمشي أحسن عندك، أو اربط هالموضوع فيه` : "جرّب زاوية ثانية لنفس الموضوع" });

  const best = bestTime(rep), h = hourOf(post.timestamp);
  if (best && Math.floor(h / 4) === best.s) f.push({ good: true, why: `نزل في أفضل فترة لك (${best.name})`, lesson: `ثبّت النشر الساعة ${hourName(best.hour)}` });
  else if (best) f.push({ good: false, why: `نزل الساعة ${hourName(h)}، وأفضل فترة لك ${best.name}`, lesson: `انشر الجاي الساعة ${hourName(best.hour)}` });

  const line = firstLine(post.caption);
  if (!line || /^[#@]/.test(line)) f.push({ good: false, why: "أول سطر ما فيه جملة تشد", lesson: "ابدأ بجملة أو سؤال، مو هاشتاقات" });
  else if (line.length > 80) f.push({ good: false, why: "أول سطر طويل وينقطع قبل «المزيد»", lesson: "خل الفكرة في أول ٨٠ حرف" });
  else if (/[؟?]/.test(line) || /[0-9٠-٩]/.test(line)) f.push({ good: true, why: `أول سطر فيه ${/[؟?]/.test(line) ? "سؤال" : "رقم"} يشد`, lesson: "كرر نفس أسلوب البداية" });

  const tags = tagsOf(post.caption), H = rep.hashtags;
  if (H?.ready) {
    const weak = tags.map((x) => H.tags.find((y) => y.tag === x)).filter((x) => x && x.category !== "اسمك" && x.reach_lift < -0.2 && !(x.category === "مجالك" && (x.intent_lift ?? 0) >= 0));
    if (weak.length) f.push({ good: false, why: `فيه هاشتاقات تجي عادةً مع وصول أقل (${weak.map((x) => x.tag).join(" ")})`, lesson: "جرّب بدونها" });
    if (H.best_count && (tags.length < H.best_count.lo || tags.length > H.best_count.hi)) f.push({ good: false, why: `فيه ${tags.length === 1 ? "هاشتاق واحد" : tags.length === 2 ? "هاشتاقين" : `${n(tags.length)} ${tags.length <= 10 ? "هاشتاقات" : "هاشتاق"}`}، وأفضل عدد عندك ${H.best_count.label}`, lesson: `استخدم ${H.best_count.label} هاشتاقات` });
  }

  // الريلز: كم كمّلوا منه مقارنة بعادتك
  const w = kind === "REELS" ? reelWatch(accountId, post) : null;
  if (w?.ratio != null && w.ratio >= 1.15) f.push({ good: true, why: w.by_pct ? `الناس شافوا ${n(w.ret * 100)}٪ منه، أكثر من عادتك` : `الناس تفرجوا عليه أطول من عادتك (${n(w.watch)} ثانية)`, lesson: "شوف وش سويت في أول ٣ ثواني وكرره" });
  if (w?.ratio != null && w.ratio <= 0.85) f.push({ good: false, why: w.by_pct ? `الناس شافوا ${n(w.ret * 100)}٪ بس منه${w.duration > 60 ? ` (طوله ${n(w.duration)} ثانية)` : ""}` : `الناس طلعوا منه بدري (${n(w.watch)} ثانية)`, lesson: w.duration > 60 ? "خل الريل الجاي أقل من دقيقة" : "ادخل في الموضوع من أول ثانية" });

  const cta = CTA.test(post.caption || "");
  if (leads) f.push({ good: true, why: `جاب ${leads === 1 ? "سؤال" : n(leads) + " أسئلة"} عن السعر أو التسجيل${cta ? "، والدعوة في الآخر اشتغلت" : ""}`, lesson: "تابعهم بالخاص اليوم" });
  else if (!cta) f.push({ good: false, why: "ما فيه دعوة للخطوة الجاية", lesson: "اختم بـ «اكتب (صوت) بالتعليقات»" });

  const good = f.filter((x) => x.good), bad = f.filter((x) => !x.good);
  const pick = verdict === "strong" ? good.slice(0, 3) : verdict === "weak" ? bad.slice(0, 3) : [...good.slice(0, 1), ...bad.slice(0, 1)];
  const lesson = (verdict === "strong" ? good[0] : bad[0] || good[0])?.lesson;

  const kn = KIND_NAMES[kind] || "البوست";
  const days = Math.max(2, Math.floor((Date.now() - t) / 864e5));
  const ago = days === 2 ? "قبل يومين" : `قبل ${["", "", "", "٣", "٤"][days] || days} أيام`;
  const title = { strong: `🔥 ${kn} اللي نزّلته ${ago} أقوى من عادتك`, weak: `📉 ${kn} اللي نزّلته ${ago} أضعف من عادتك`, normal: `📊 ${kn} اللي نزّلته ${ago} مثل عادتك`,
    mixed: rReach >= 1 ? `🔀 ${kn} اللي نزّلته ${ago} وصل لناس أكثر، بس تفاعلهم أقل` : `🔀 ${kn} اللي نزّلته ${ago} وصوله أقل، بس اللي شافوه تفاعلوا أكثر` }[verdict];
  const body = [
    `«${line.slice(0, 60) || "بدون كابشن"}»`,
    `الوصول ${n(post.reach)} (${times(rReach)})${rIntent != null ? ` · الاهتمام ${times(rIntent)}` : ""}${w?.ret != null ? ` · شافوا ${n(w.ret * 100)}٪ منه` : ""}${leads ? ` · ${leads === 1 ? "سؤال" : n(leads) + " أسئلة"} عن السعر والتسجيل` : ""}.`,
    pick.length ? `${verdict === "weak" ? "الأسباب المحتملة" : verdict === "strong" ? "اللي ساعده" : "الملاحظات"}: ${pick.map((x) => x.why).join("، ")}.` : null,
    lesson ? `للبوست الجاي: ${lesson}.` : null,
  ].filter(Boolean).join("\n");
  return { verdict, rReach, rIntent, leads, title, body, factors: f, watch: w };
}

// يشتغل كل نص ساعة: أي بوست عمره ٤٨–٩٦ ساعة وما وصلك تقريره
export function postReviews(accountIds) {
  const now = Date.now();
  for (const id of accountIds) {
    const posts = db.prepare(`SELECT * FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial AND timestamp BETWEEN ? AND ?`)
      .all(id, new Date(now - 96 * 3600e3).toISOString().slice(0, 19), new Date(now - 48 * 3600e3).toISOString().slice(0, 19))
      .filter((p) => !db.prepare("SELECT 1 FROM alerts WHERE account_id = ? AND kind = ?").get(id, `post48:${p.id}`));
    if (!posts.length) continue;
    const t = today();
    const rep = report(id, new Date(Date.parse(t) - 89 * 864e5).toISOString().slice(0, 10), t);
    for (const p of posts) {
      const r = reviewPost(id, p, rep);
      if (r) saveAlert(id, p.id, `post48:${p.id}`, r.title, r.body);
    }
  }
}
