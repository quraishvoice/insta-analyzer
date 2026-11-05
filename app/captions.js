// فاحص الكابشن قبل النشر: قواعد ثابتة + مقارنة بأرقام بوستاتك أنت
import { report } from "./analysis.js";
import { CTA } from "./advisor.js";
import { scoredPosts, tagsOf, median } from "./hashtags.js";
import { bestTime } from "./planner.js";
import { topicOf } from "./topics.js";
import { L, lbl, unlbl } from "./i18n.js";

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const MIN = 8; // أقل عدد بوستات في كل جهة عشان نقارن
const pct = (x) => `${Math.round(Math.abs(x) * 100)}${L("٪", "%")}`;
const n = (x) => Math.round(x).toLocaleString("en-US");
// العدد مع التمييز: ٣–١٠ جمع، وغيرها مفرد
const count = (x, one, many) => L(x === 2 ? { "بوست": "بوستين", "هاشتاق": "هاشتاقين" }[one] : `${n(x)} ${x >= 3 && x <= 10 ? many : one}`, `${n(x)} ${{ "بوست": "post", "هاشتاق": "hashtag" }[one]}${x === 1 ? "" : "s"}`);
const firstLine = (c) => (c || "").split("\n").find((l) => l.trim())?.trim() || "";
const normalize = (t) => t.replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase();
const words = (t) => new Set(normalize(t.replace(/#[\p{L}\p{N}_]+/gu, " ")).match(/[\p{L}]{3,}/gu) || []);
const hourName = (h) => L(h === 0 ? "١٢ بالليل" : h < 12 ? `${h} الصبح` : h === 12 ? "١٢ الظهر" : `${h - 12} ${h < 15 ? "الظهر" : h < 18 ? "العصر" : h < 20 ? "المغرب" : "الليل"}`,
  h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`);

// كم يفرق وجود صفة معينة في بوستاتك (على الاهتمام مقارنة بعادتك)؟
function featureLift(posts, has) {
  const yes = posts.filter(has), no = posts.filter((p) => !has(p));
  if (yes.length < MIN || no.length < MIN) return null;
  const m = (l) => median(l.map((p) => p.rel_intent).filter((x) => x != null));
  const a = m(yes), b = m(no);
  return a != null && b ? { lift: a / b - 1, n: yes.length } : null;
}

export function checkCaption(accountId, { caption = "", kind = "REELS", goal: goalIn = "" }) {
  // الهدف ممكن يوصل بالإنجليزي من قائمة اللوحة المترجمة
  const goal = unlbl(goalIn);
  const items = [];
  const add = (level, title, detail) => items.push({ level, title, detail });
  const text = String(caption);
  const line = firstLine(text);
  const posts = scoredPosts(accountId);
  const kindPosts = posts.filter((p) => p.kind === kind);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const rep = report(accountId, new Date(Date.parse(today) - 89 * 864e5).toISOString().slice(0, 10), today);

  // ١. أول سطر: هو اللي ينشاف قبل «المزيد»
  if (!line) add("bad", L("الكابشن فاضي", "The caption is empty"), L("اكتب على الأقل سطر يشرح وش في البوست ويشد الناس يكملون.", "Write at least one line that says what the post is about and makes people keep reading."));
  else if (/^[#@]/.test(line) || !/[\p{L}]/u.test(line)) add("bad", L("أول سطر ما فيه كلام", "The first line has no words"), L("أول سطر هو اللي ينشاف تحت البوست. خله جملة تشد، مو هاشتاقات أو إيموجي بس.", "The first line is what people see under the post. Make it a hook, not just hashtags or emoji."));
  else if (line.length > 80) add("warn", L("أول سطر طويل", "The first line is long"), L(`أول سطر ${n(line.length)} حرف، وانستجرام يقطعه تقريباً بعد ٨٠. خل الفكرة الأساسية في أول كم كلمة.`, `The first line is ${n(line.length)} characters, and Instagram cuts it off around 80. Put the main idea in the first few words.`));
  else add("ok", L("أول سطر واضح", "Clear first line"), `«${line.slice(0, 60)}»`);

  if (line) {
    const q = featureLift(posts, (p) => /[؟?]/.test(firstLine(p.caption)));
    if (q && q.lift > 0.1 && !/[؟?]/.test(line)) add("tip", L("جرّب تبدأ بسؤال", "Try opening with a question"), L(`بوستاتك اللي أول سطرها سؤال اهتمامها أعلى بـ ${pct(q.lift)} من عادتك (${count(q.n, "بوست", "بوستات")}).`, `Your posts that open with a question get ${pct(q.lift)} more intent than usual (${count(q.n, "بوست", "بوستات")}).`));
    const num = featureLift(posts, (p) => /[0-9٠-٩]/.test(firstLine(p.caption)));
    if (num && num.lift > 0.1 && !/[0-9٠-٩]/.test(line)) add("tip", L("جرّب رقم في أول سطر", "Try a number in the first line"), L(`مثل «٣ أخطاء…». بوستاتك اللي فيها رقم في أول سطر اهتمامها أعلى بـ ${pct(num.lift)} (${count(num.n, "بوست", "بوستات")}).`, `Like “3 mistakes…”. Your posts with a number in the first line get ${pct(num.lift)} more intent (${count(num.n, "بوست", "بوستات")}).`));
  }

  // ٢. دعوة للتسجيل
  const cta = featureLift(posts, (p) => CTA.test(p.caption || ""));
  const ctaNote = cta && cta.lift > 0.05 ? L(` بوستاتك اللي فيها دعوة اهتمامها أعلى بـ ${pct(cta.lift)} من عادتك.`, ` Your posts with a call to action get ${pct(cta.lift)} more intent than usual.`) : "";
  if (CTA.test(text)) add("ok", L("فيه دعوة واضحة", "Clear call to action"), L("الناس يعرفون الخطوة الجاية (رابط، تسجيل، خاص).", "People know the next step (link, sign-up, DM)."));
  else if (goal === "بيع") add("bad", L("بوست بيع بدون دعوة للتسجيل", "Sales post with no call to sign up"), L(`اختم بجملة مثل «اكتب "صوت" بالتعليقات وأرسل لك التفاصيل» أو «الرابط في البايو».${ctaNote}`, `End with a line like “Comment «صوت» and I'll send you the details” or “Link in bio”.${ctaNote}`));
  else add("tip", L("ما فيه دعوة للخطوة الجاية", "No call to action"), L(`حتى لو البوست مو بيع، سطر مثل «تابعني عشان الجزء الثاني» أو «احفظه» يفرق.${ctaNote}`, `Even if it's not a sales post, a line like “Follow for part two” or “Save this” makes a difference.${ctaNote}`));

  // ٢ب. الموضوع وكيف يمشي عندك
  const tp = rep.topics?.ready && line ? rep.topics.topics.find((t) => t.name === topicOf(text)) : null;
  if (tp && tp.name !== "أخرى" && tp.enough) {
    const r = tp.reach_lift, i = tp.intent_lift;
    const say = (x, w) => (x == null || Math.abs(x) < 0.05 ? `${w} عادي` : `${w} ${x > 0 ? "أعلى" : "أقل"} بـ ${pct(x)}`);
    const sayEn = (x, w) => (x == null || Math.abs(x) < 0.05 ? `typical ${w}` : `${pct(x)} ${x > 0 ? "more" : "less"} ${w}`);
    const sells = rep.topics.best.sell === tp.name;
    const level = sells || (r > 0.1 && (i ?? 0) > -0.1) ? "ok" : goal === "جذب" && r < -0.2 ? "warn" : "tip";
    add(level, L(`الموضوع: ${tp.name}`, `Topic: ${lbl(tp.name)}`), L(`بوستاتك في هالموضوع ${say(r, "وصولها")} و${say(i, "اهتمامها")} من عادتك (${count(tp.n, "بوست", "بوستات")})${sells ? "، وهو أكثر موضوع يجيب عملاء" : ""}.${level === "warn" ? ` لو هدفك الوصول، «${rep.topics.best.reach || "موضوع ثاني"}» يمشي أحسن عندك.` : ""}`,
      `Your posts on this topic get ${sayEn(r, "reach")} and ${sayEn(i, "intent")} than usual (${count(tp.n, "بوست", "بوستات")})${sells ? ", and it's the topic that brings in the most leads" : ""}.${level === "warn" ? ` If your goal is reach, ${rep.topics.best.reach ? `“${lbl(rep.topics.best.reach)}”` : "another topic"} does better for you.` : ""}`));
  }

  // ٣. الروابط في الكابشن ما تنضغط
  if (/https?:\/\/|www\.|\.com\b/i.test(text)) add("warn", L("فيه رابط في الكابشن", "There's a link in the caption"), L("الروابط في كابشن انستجرام ما تنضغط. اكتب «الرابط في البايو» بداله، أو استخدم ملصق الرابط في الستوري.", "Links in Instagram captions aren't clickable. Write “link in bio” instead, or use the link sticker in a Story."));

  // ٤. الهاشتاقات
  const tags = tagsOf(text);
  const h = rep.hashtags;
  if (tags.length > 30) add("bad", count(tags.length, "هاشتاق", "هاشتاقات"), L("انستجرام يسمح بـ ٣٠ هاشتاق بالكثير، وإذا زادت ممكن ما ينشر الكابشن.", "Instagram allows 30 hashtags at most. Go over that and the caption may not post."));
  if (h.ready) {
    const known = Object.fromEntries(h.tags.map((t) => [t.tag, t]));
    // هاشتاقات مجالك طبيعية في بوستات الإقناع والبيع حتى لو وصولها أقل
    const weak = tags.map((t) => known[t]).filter((t) => t && t.category !== "اسمك" && t.reach_lift < -0.2 && !(t.category === "مجالك" && (goal === "بيع" || goal === "إقناع")));
    if (weak.length) add("warn", L(`هاشتاقات جات مع وصول أقل: ${weak.map((t) => t.tag).join(" ")}`, `Hashtags linked to lower reach: ${weak.map((t) => t.tag).join(" ")}`),
      L(weak.map((t) => `${t.tag} أقل من عادتك بـ ${pct(t.reach_lift)} (${count(t.n, "بوست", "بوستات")})`).join("، ") + ". ممكن السبب الموضوع، فشيلها إذا ما لها علاقة بالبوست.",
        weak.map((t) => `${t.tag}: ${pct(t.reach_lift)} below usual (${count(t.n, "بوست", "بوستات")})`).join(", ") + ". The topic may be the real reason, so drop them if they don't fit the post."));
    const ok = goal === "جذب" || !goal ? (t) => true : (t) => t.category === "عام" || t.category === "مجالك";
    const suggest = h.tags.filter((t) => !tags.includes(t.tag) && t.reach_lift > 0.1 && ok(t)).slice(0, 4).map((t) => t.tag);
    if (suggest.length) add("tip", L(`هاشتاقات جات مع أرقام أعلى عندك: ${suggest.join(" ")}`, `Hashtags linked to better numbers for you: ${suggest.join(" ")}`), L("حط اللي يناسب موضوع البوست منها.", "Use the ones that fit the post's topic."));
    if (!tags.length && h.with_tags / h.posts > 0.7) add("tip", L("ما فيه هاشتاقات", "No hashtags"), L(`أغلب بوستاتك فيها هاشتاقات (متوسط ${h.avg_count.toFixed(1)}).`, `Most of your posts use hashtags (${h.avg_count.toFixed(1)} on average).`));
    else if (tags.length && tags.length <= 30) add("ok", count(tags.length, "هاشتاق", "هاشتاقات"), h.best_count ? L(`أفضل عدد عندك ${h.best_count.label}.`, `Your best range is ${lbl(h.best_count.label)}.`) : L(`متوسطك ${h.avg_count.toFixed(1)}.`, `Your average is ${h.avg_count.toFixed(1)}.`));
  }

  // ٥. الطول
  if (text.length > 2200) add("bad", L("الكابشن أطول من المسموح", "The caption is over the limit"), L(`${n(text.length)} حرف، والحد ٢٢٠٠. اختصره.`, `${n(text.length)} characters; the limit is 2,200. Shorten it.`));

  // ٦. الوقت
  const best = bestTime(rep);
  if (best) {
    const hourNow = +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date());
    if (Math.floor(hourNow / 4) === best.s) add("ok", L("الوقت مناسب للنشر الحين", "Now is a good time to post"), L(`فترة ${best.name} أفضل وقت لك (تفاعل ${(best.er * 100).toFixed(1)}٪ من ${count(best.n, "بوست", "بوستات")}).`, `${lbl(best.name)} is your best time slot (${(best.er * 100).toFixed(1)}% engagement across ${count(best.n, "بوست", "بوستات")}).`));
    else add("tip", L(`أفضل وقت تنشره: ${hourNow < best.hour ? "اليوم" : "بكرة"} الساعة ${hourName(best.hour)}`, `Best time to post: ${hourNow < best.hour ? "today" : "tomorrow"} at ${hourName(best.hour)}`),
      L(`فترة ${best.name} تفاعلها ${(best.er * 100).toFixed(1)}٪ (من ${count(best.n, "بوست", "بوستات")})، قبل ذروة تواجد متابعينك.`, `The ${lbl(best.name)} slot gets ${(best.er * 100).toFixed(1)}% engagement (across ${count(best.n, "بوست", "بوستات")}), just before your followers are most active.`));
  }

  // ٧. بوستات سابقة شبيهة بنفس الموضوع
  const mine = words(text);
  const similar = mine.size < 3 ? [] : kindPosts.concat(posts.filter((p) => p.kind !== kind)).map((p) => {
    const w = words(p.caption || "");
    const common = [...mine].filter((x) => w.has(x)).length;
    return { p, common, sim: common / (Math.min(mine.size, w.size) || 1) };
  }).filter((x) => x.common >= 3 && x.sim >= 0.35).sort((a, b) => b.sim - a.sim).slice(0, 3).map(({ p }) => ({
    caption: firstLine(p.caption).slice(0, 70), permalink: p.permalink, kind: p.kind, reach: p.reach, rel_reach: p.rel_reach, rel_intent: p.rel_intent,
  }));

  const order = { bad: 0, warn: 1, tip: 2, ok: 3 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  return { items, similar, checks: items.filter((x) => x.level !== "tip").length, passed: items.filter((x) => x.level === "ok").length };
}
