// نصائح مبنية على قواعد ثابتة من أرقامك — مجانية وما تحتاج أي خدمة خارجية
// كل نص يطلع للمستخدم داخل L(عربي، إنجليزي). الأولوية (عالية/متوسطة/منخفضة) و verdict تظل عربي لأنها مفاتيح للترتيب والتنسيق
import { FIRST_FOLLOWUP } from "./leads.js";
import { L, lbl } from "./i18n.js";
import { P, T, rx } from "./profile.js";

// اسم اللي تبيعه (الدورة، الخدمة…) وكلمة التعليق، من ملف مجالك
const O = () => T(P.offer);
const W = P.cta_word;

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const SLOTS = ["١٢–٤ بعد نص الليل", "٤–٨ الفجر", "٨–١٢ الصبح", "١٢–٤ الظهر والعصر", "٤–٨ المغرب", "٨–١٢ الليل"];
const OFFER = rx(P.offer_words);
export const CTA = { test: (t) => (t = String(t ?? "")) && /رابط|البايو|بايو|سجّل|سجل|التسجيل|احجز|حجز|واتس|تواصل|راسل|الخاص|DM|اشترك|خصم|عرض|مقاعد|اطلب/i.test(t) || !!OFFER?.test(t.replace(/ة/g, "ه")) };

const n = (x) => Math.round(x).toLocaleString("en-US");
const pct = (x) => L(`${(x * 100).toFixed(1)}٪`, `${(x * 100).toFixed(1)}%`);
const change = (cur, prev) => (cur != null && prev ? (cur - prev) / Math.abs(prev) : null);
const avg = (arr, f) => {
  const v = arr.map(f).filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const firstLine = (c) => (c || "").split("\n")[0].slice(0, 60);
// العدد مع التمييز الصحيح: ٢ مثنى، ٣–١٠ جمع، غيرها مفرد
// العدد مع الكلمة: «بوست واحد»، «بوستين»، «٣ بوستات»، «١١ بوست»
const count = (x, one, many, two) => (x === 1 ? `${one} ${/ة$/.test(one.split(" ")[0]) ? "وحدة" : "واحد"}` : x === 2 && two ? two : `${n(x)} ${x >= 3 && x <= 10 ? many : one}`);
// English: "1 post" / "2 posts"
const ce = (x, one, many = one + "s") => `${n(x)} ${x === 1 ? one : many}`;
const hourName = (h) => L(
  h === 0 ? "١٢ بالليل" : h < 12 ? `${h} الصبح` : h === 12 ? "١٢ الظهر" : `${h - 12} ${h < 18 ? "العصر" : "بالليل"}`,
  h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`,
);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// يقارن مجموعتين من البوستات ويرجع الفرق النسبي إذا العينة كافية
function compareGroups(a, b, f, min = 2) {
  if (a.length < min || b.length < min) return null;
  const x = avg(a, f), y = avg(b, f);
  return x != null && y ? { a: x, b: y, diff: (x - y) / y } : null;
}

function advisePosts(rep) {
  const { kpis: k, prev_kpis: pk, period, by_type: types, heatmap, posts, reels, account } = rep;
  const wins = [], problems = [], recs = [];
  const rec = (priority, title, detail) => recs.push({ priority, title, detail });

  if (!k.posts) {
    return {
      summary: L("ما نشرت أي بوست في هالفترة، فما فيه شي نحلله. اختر فترة أطول أو ابدأ تنشر.", "You didn't post anything in this period, so there's nothing to analyze. Pick a longer range or start posting."),
      wins: [], problems: [], post_insights: [], content_ideas: [],
      recommendations: [{ priority: "عالية", title: L("ارجع للنشر", "Get back to posting"), detail: L("الحساب اللي يوقف نشر يخسر وصوله بسرعة. ابدأ ببوستين بالأسبوع على الأقل.", "Accounts that stop posting lose reach fast. Start with at least 2 posts a week.") }],
      next_steps: L("انشر ٣ بوستات هالأسبوع وارجع للوحة بعد ٧ أيام.", "Publish 3 posts this week and check back in 7 days."),
    };
  }

  const weekly = (k.posts / period.days) * 7;
  // فترة المقارنة ممكن طولها غير (مثل سبتمبر ٣٠ يوم مقابل أكتوبر ٣١)
  const prevDays = period.prev_from && period.prev_to ? Math.round((Date.parse(period.prev_to) - Date.parse(period.prev_from)) / 864e5) + 1 : period.days;
  const prevWeekly = (pk.posts / prevDays) * 7;
  const small = k.posts < 5;

  // ١. معدل النشر
  if (weekly < 3) {
    problems.push(L(`تنشر ${weekly.toFixed(1)} بوست بالأسبوع بس. الخوارزمية تكافئ الاستمرارية، وأقل من ٣ بالأسبوع يخلي وصولك يتذبذب.`,
      `You're posting only ${weekly.toFixed(1)} times a week. The algorithm rewards consistency, and fewer than 3 posts a week makes your reach unstable.`));
    rec("عالية", L("زد عدد البوستات لـ ٣–٤ بالأسبوع", "Post 3–4 times a week"), L(`حالياً معدلك ${weekly.toFixed(1)} بالأسبوع. ما تحتاج محتوى جديد كل مرة: أعد صياغة أفضل بوستاتك بصيغة ثانية (ريل يتحول لكاروسيل والعكس). الأهم إنك تثبت جدول وتلتزم فيه.`,
      `You're at ${weekly.toFixed(1)} a week right now. You don't need a new idea every time: repurpose your best posts in another format (a reel becomes a carousel and vice versa). What matters most is setting a schedule and sticking to it.`));
  } else if (weekly >= 3) {
    wins.push(L(`ملتزم بالنشر: ${weekly.toFixed(1)} بوست بالأسبوع.`, `Consistent posting: ${weekly.toFixed(1)} posts a week.`));
  }

  // ٢. الوصول (المقارنة تحتاج ٣ بوستات على الأقل في كل فترة، وإلا النسبة تطلع كبيرة من بوست أو بوستين)
  const enough = k.posts >= 3 && pk.posts >= 3;
  const reachCh = enough ? change(k.avg_reach, pk.avg_reach) : null;
  if (reachCh != null && reachCh > 0.1) wins.push(L(`متوسط الوصول للبوست ارتفع ${pct(reachCh)} (من ${n(pk.avg_reach)} إلى ${n(k.avg_reach)}).`, `Average reach per post is up ${pct(reachCh)} (from ${n(pk.avg_reach)} to ${n(k.avg_reach)}).`));
  if (reachCh != null && reachCh < -0.1) problems.push(L(`متوسط الوصول للبوست نزل ${pct(-reachCh)} (من ${n(pk.avg_reach)} إلى ${n(k.avg_reach)}).`, `Average reach per post is down ${pct(-reachCh)} (from ${n(pk.avg_reach)} to ${n(k.avg_reach)}).`));
  const totalReachCh = change(k.reach, pk.reach);
  // بس إذا وصول البوست الواحد ما تغير كثير، وإلا الجملة «كل بوست يجيب نفس الوصول» تناقض اللي فوق
  if (enough && totalReachCh != null && totalReachCh < -0.15 && prevWeekly - weekly > 0.5 && (reachCh == null || Math.abs(reachCh) <= 0.1)) {
    problems.push(L(`إجمالي الوصول نزل ${pct(-totalReachCh)}، والسبب الأوضح إن عدد البوستات قل من ${pk.posts} إلى ${k.posts}. كل بوست يجيب تقريباً نفس الوصول، لكن البوستات أقل.`,
      `Total reach is down ${pct(-totalReachCh)}, mainly because you posted less (${pk.posts} → ${k.posts} posts). Each post gets about the same reach; there are just fewer of them.`));
  }

  // ٣. الاهتمام والتفاعل
  // بالحفظ والمشاركة (نفس المقياس لكل الأنواع)، عشان فترة فيها صور أكثر ما تطلع «أحسن» بس لأن Meta تعطي الصور زيارات بروفايل
  const intentCh = enough ? change(k.avg_fair, pk.avg_fair) : null;
  if (intentCh != null && intentCh > 0.1) wins.push(L(`الحفظ والمشاركة تحسّنوا ${pct(intentCh)}، يعني الناس صارت تحفظ بوستاتك وترسلها لغيرها أكثر.`, `Saves and shares are up ${pct(intentCh)}: more people are saving your posts and sending them on.`));
  if (intentCh != null && intentCh < -0.1) problems.push(L(`الحفظ والمشاركة نزلوا ${pct(-intentCh)}، يعني المحتوى يوصل لكن الناس ما يحفظونه ولا يرسلونه لغيرهم مثل قبل.`, `Saves and shares are down ${pct(-intentCh)}: your content reaches people, but fewer of them save it or send it on.`));

  // ٤. المتابعين ونقرات الرابط
  if (k.follower_growth != null) {
    // نقارن بس إذا الفترتين بنفس الطريقة (الصافي مع الصافي، أو المتابعات الجديدة مع الجديدة)
    // ونقارن المعدل باليوم، لأن عدد الأيام المحسوبة ممكن يختلف (Meta تتأخر يومين)
    const same = pk.follower_growth != null && pk.follower_net === k.follower_net && k.follower_days && pk.follower_days;
    const perDay = same ? k.follower_growth / k.follower_days : null, prevPerDay = same ? pk.follower_growth / pk.follower_days : null;
    const pd = (x) => `+${x >= 10 ? n(x) : x.toFixed(1)}`;
    if (k.follower_growth < 0) problems.push(L(`خسرت ${n(-k.follower_growth)} متابع في هالفترة.`, `You lost ${ce(-k.follower_growth, "follower")} in this period.`));
    else if (same && prevPerDay > 0 && perDay > prevPerDay * 1.1) wins.push(L(`المتابعين الجدد زادوا: ${pd(perDay)} باليوم مقابل ${pd(prevPerDay)} في الفترة السابقة.`, `New followers are up: ${pd(perDay)} a day vs ${pd(prevPerDay)} in the previous period.`));
    else if (same && prevPerDay > 0 && perDay < prevPerDay * 0.9) problems.push(L(`النمو أبطأ: ${pd(perDay)} متابع باليوم مقابل ${pd(prevPerDay)} في الفترة السابقة.`, `Growth has slowed: ${pd(perDay)} followers a day vs ${pd(prevPerDay)} in the previous period.`));
  }
  // نقرات الرابط مقسومة على وصول الحساب كله (من أرقام الحساب اليومية)، مو وصول بوستات الفترة بس
  if (k.link_taps != null && k.account_reach) {
    const rate = k.link_taps / k.account_reach * 1000;
    const prevRate = pk.link_taps != null && pk.account_reach ? pk.link_taps / pk.account_reach * 1000 : null;
    if (prevRate && rate < prevRate * 0.85) problems.push(L(`نقرات الرابط لكل ١٠٠٠ وصول نزلت من ${prevRate.toFixed(1)} إلى ${rate.toFixed(1)}. هذا أقرب رقم للمبيعات، فانتبه له.`, `Link taps per 1,000 reach fell from ${prevRate.toFixed(1)} to ${rate.toFixed(1)}. This is the number closest to sales, so keep an eye on it.`));
    if (prevRate && rate > prevRate * 1.15) wins.push(L(`نقرات الرابط لكل ١٠٠٠ وصول ارتفعت من ${prevRate.toFixed(1)} إلى ${rate.toFixed(1)}. الناس صارت تروح لصفحة التسجيل أكثر.`, `Link taps per 1,000 reach rose from ${prevRate.toFixed(1)} to ${rate.toFixed(1)}. More people are heading to your sign-up page.`));
  }

  // ٥. نوع المحتوى
  // المقارنة بالحفظ والمشاركة (avg_fair)، لأن زيارات البروفايل والمتابعة ما تجي للريلز فتظلمها
  const solid = types.filter((t) => t.count >= 2 && t.avg_fair != null);
  if (solid.length >= 2) {
    const byIntent = [...solid].sort((a, b) => b.avg_fair - a.avg_fair);
    const byReach = [...solid].sort((a, b) => b.avg_reach - a.avg_reach);
    const best = byIntent[0], worst = byIntent.at(-1);
    const gap = worst.avg_fair > 0 ? (best.avg_fair - worst.avg_fair) / worst.avg_fair : 0;
    if (gap > 0.15) {
      wins.push(L(`${best.name} أكثر نوع ينحفظ وينشارك عندك (${pct(best.avg_fair)} من الوصول) مقابل ${pct(worst.avg_fair)} لـ ${worst.name}.`,
        `${lbl(best.name)} get saved and shared the most (${pct(best.avg_fair)} of reach) vs ${pct(worst.avg_fair)} for ${lbl(worst.name)}.`));
    }
    if (byReach[0].kind !== best.kind) {
      const R = lbl(byReach[0].name), B = lbl(best.name);
      rec("عالية", L(`استخدم ${byReach[0].name} للوصول و${best.name} للإقناع`, `Use ${R} for reach and ${B} to build trust`),
        L(`${byReach[0].name} يجيب أعلى وصول (${n(byReach[0].avg_reach)} بالمتوسط)، لكن ${best.name} ينحفظ وينشارك أكثر. سوّ ${byReach[0].name} عشان توصل لناس جدد، و${best.name} يشرح ويقنع ويقود للتسجيل. وانشر ${best.name} بعد ${byReach[0].name} بيوم عشان يلقى الزوار الجدد.`,
          `${R} posts get the highest reach (${n(byReach[0].avg_reach)} on average), but ${B} posts get saved and shared more. Use ${R} to reach new people, and ${B} to explain, convince and lead to sign-ups. Publish the ${B} post the day after the ${R} post so it catches the new visitors.`));
    } else if (gap > 0.15) {
      rec("عالية", L(`زد نسبة ${best.name}`, `Post more ${lbl(best.name)} posts`), L(`${best.name} الأفضل عندك في الوصول والحفظ والمشاركة مع بعض. خلّه على الأقل نص محتواك، وقلل ${worst.name} اللي هو الأضعف (${pct(worst.avg_fair)} حفظ ومشاركة).`,
        `${lbl(best.name)} is your best format for reach, saves and shares. Make it at least half of your content, and cut back on ${lbl(worst.name)}, your weakest (${pct(worst.avg_fair)} saves and shares).`));
    }
    const carousel = solid.find((t) => t.kind === "CAROUSEL_ALBUM");
    if (carousel && carousel.avg_saved === Math.max(...solid.map((t) => t.avg_saved || 0))) {
      wins.push(L(`الكاروسيل يُحفظ أكثر شي (${carousel.avg_saved.toFixed(0)} حفظ بالمتوسط). الحفظ يعني إن المحتوى مفيد ويرجعون له.`, `Carousels get saved the most (${carousel.avg_saved.toFixed(0)} saves on average). Saves mean people find the content useful and come back to it.`));
    }
  } else if (types.length === 1 && k.posts >= 3) {
    rec("متوسطة", L("جرّب أنواع محتوى ثانية", "Try other content formats"), L(`كل بوستاتك ${types[0].name}. جرّب نوع ثاني ٢–٣ مرات عشان تقدر تقارن.`, `Every post you published is ${lbl(types[0].name)}. Try another format 2–3 times so you have something to compare.`));
  }

  // ٦. أفضل وقت
  const cells = [];
  heatmap.forEach((row, d) => row.forEach((c, s) => c && c.n >= 2 && cells.push({ d, s, ...c })));
  // من آخر ٣ شهور مثل خطة النشر، مو من فترة اللوحة
  const slotStats = (rep.time_slots || []).map((x) => ({ ...x, name: SLOTS[x.s] })).filter((x) => x.count >= 3); // نفس حد خطة النشر
  const online = account.online_followers;
  const peak = online ? online.indexOf(Math.max(...online)) : null;
  if (slotStats.length >= 2) {
    const sorted = [...slotStats].sort((a, b) => b.er - a.er);
    const best = sorted[0], worst = sorted.at(-1);
    const diff = worst.er > 0 ? (best.er - worst.er) / worst.er : 0;
    if (diff > 0.15) {
      let hint = "";
      if (peak != null) {
        hint = Math.floor(peak / 4) === best.s
          ? L(` وهذا يتوافق مع تواجد متابعينك، أكثرهم أونلاين الساعة ${hourName(peak)}، فانشر قبلها بساعة.`, ` That matches when your followers are online (most of them at ${hourName(peak)}), so post an hour before that.`)
          : L(` لكن أكثر متابعينك أونلاين الساعة ${hourName(peak)}. جرّب تنشر مرتين بالأسبوع قبلها بساعة وقارن النتيجة بعد أسبوعين.`, ` But most of your followers are online at ${hourName(peak)}. Try posting an hour before that twice a week and compare after two weeks.`);
      }
      rec("متوسطة", L(`انشر في فترة ${best.name}`, `Post in the ${lbl(best.name)} window`),
        L(`في آخر ٣ شهور، بوستاتك المنشورة ${best.name} تفاعلها ${pct(best.er)} (${count(best.count, "بوست", "بوستات", "بوستين")}) مقابل ${pct(worst.er)} لما تنشر ${worst.name} (فرق ${pct(diff)}).${hint}`,
          `Over the last 3 months, posts published ${lbl(best.name)} got ${pct(best.er)} engagement (${ce(best.count, "post")}) vs ${pct(worst.er)} when you post ${lbl(worst.name)} (a ${pct(diff)} gap).${hint}`));
    }
  } else if (peak != null) {
    rec("متوسطة", L(`انشر قبل الساعة ${hourName(peak)}`, `Post before ${hourName(peak)}`), L(`هذا الوقت اللي يكون فيه أكبر عدد من متابعينك أونلاين. انشر قبله بساعة عشان البوست ياخذ تفاعل بدري والخوارزمية توزعه أكثر.`, `That's when the most followers are online. Post an hour earlier so the post picks up engagement early and the algorithm pushes it further.`));
  }
  if (cells.length) {
    const top = cells.sort((a, b) => b.er - a.er)[0];
    wins.push(L(`أفضل خانة نشر عندك: ${DAYS[top.d]} ${SLOTS[top.s]} (${pct(top.er)} تفاعل من ${count(top.n, "بوست", "بوستات", "بوستين")}).`,
      `Your best posting slot: ${lbl(DAYS[top.d])}, ${lbl(SLOTS[top.s])} (${pct(top.er)} engagement across ${ce(top.n, "post")}).`));
  }

  // ٧. الكابشن: دعوة للتسجيل، الطول، الأسئلة
  const withCta = posts.filter((p) => CTA.test(p.caption));
  const noCta = posts.filter((p) => !CTA.test(p.caption));
  const visitRate = (p) => (p.reach && p.profile_visits != null ? p.profile_visits / p.reach : null);
  const ctaCmp = compareGroups(withCta, noCta, visitRate);
  if (ctaCmp && ctaCmp.diff > 0.15) {
    wins.push(L(`البوستات اللي فيها دعوة واضحة (رابط، تسجيل، تواصل) تجيب زيارات بروفايل أكثر بـ ${pct(ctaCmp.diff)}.`, `Posts with a clear call to action (link, sign-up, contact) get ${pct(ctaCmp.diff)} more profile visits.`));
  }
  const ctaShare = withCta.length / posts.length;
  if (ctaShare < 0.4) {
    const proven = ctaCmp && ctaCmp.diff > 0.15;
    rec(proven ? "عالية" : "متوسطة", L("حط دعوة واضحة في آخر كل بوست", "End every post with a clear call to action"),
      L(`${n(withCta.length)} من ${count(posts.length, "بوست", "بوستات", "بوستين")} بس فيها دعوة للتسجيل أو التواصل.${proven ? ` وأرقامك تثبت إنها تفرق: زيارات البروفايل أعلى بـ ${pct(ctaCmp.diff)}.` : ""} ما يلزم تكون بيع مباشر. أمثلة: «تبي تبدأ؟ الرابط في البايو»، «اكتب (تفاصيل) في التعليقات وأرسلها لك»، «المقاعد محدودة، احجز من البايو».`,
        `Only ${n(withCta.length)} of ${ce(posts.length, "post")} ask people to sign up or get in touch.${proven ? ` Your numbers show it matters: profile visits are ${pct(ctaCmp.diff)} higher.` : ""} It doesn't have to be a hard sell. For example: “Ready to start? Link in bio”, “Comment (details) and I'll send them over”, “Seats are limited, book from the link in bio”.`));
  }

  const shortCap = posts.filter((p) => p.caption.length < 150);
  const longCap = posts.filter((p) => p.caption.length >= 150);
  const lenCmp = compareGroups(longCap, shortCap, (p) => p.intent, 3);
  if (lenCmp && Math.abs(lenCmp.diff) > 0.2) {
    const longer = lenCmp.diff > 0;
    rec("منخفضة", longer ? L("اكتب كابشن أطول ومفيد", "Write longer, more useful captions") : L("اختصر الكابشن", "Keep captions short"),
      longer
        ? L(`الكابشن الطويل (أكثر من ١٥٠ حرف) يجيب اهتمام أعلى بـ ${pct(lenCmp.diff)}. جمهورك يقرأ، فاستغل الكابشن تشرح فيه وتعطي قيمة قبل الدعوة للتسجيل.`, `Long captions (150+ characters) get ${pct(lenCmp.diff)} more interest. Your audience reads, so use the caption to explain and give value before asking them to sign up.`)
        : L(`الكابشن القصير يجيب اهتمام أعلى بـ ${pct(-lenCmp.diff)}. خل الفكرة في أول سطر والدعوة في الثاني.`, `Short captions get ${pct(-lenCmp.diff)} more interest. Put the idea in the first line and the call to action in the second.`));
  }

  const withQ = posts.filter((p) => /[؟?]/.test(p.caption));
  const qCmp = compareGroups(withQ, posts.filter((p) => !/[؟?]/.test(p.caption)), (p) => (p.reach ? p.comments / p.reach : null));
  if (qCmp && qCmp.diff > 0.2) wins.push(L(`البوستات اللي فيها سؤال تجيب تعليقات أكثر بـ ${pct(qCmp.diff)}. التعليقات فرصة تبدأ منها محادثة بيع.`, `Posts that ask a question get ${pct(qCmp.diff)} more comments. Every comment is a chance to start a sales conversation.`));

  // ٨. الريلز
  const watched = reels.filter((r) => r.avg_watch_time != null);
  if (watched.length >= 2) {
    const w = avg(watched, (r) => r.avg_watch_time);
    const best = [...watched].sort((a, b) => b.avg_watch_time - a.avg_watch_time)[0];
    if (w < 5) {
      problems.push(L(`متوسط مدة مشاهدة الريلز ${w.toFixed(1)} ثانية بس. الناس تطلع بدري، والمشكلة غالباً في أول ثانيتين.`, `Average reel watch time is only ${w.toFixed(1)} seconds. People leave early, and the problem is usually the first two seconds.`));
      rec("عالية", L("قوّي أول ثانيتين في الريلز", "Make the first two seconds of your reels count"),
        L(`أطول ريل انشاف عندك «${firstLine(best.caption)}» (${best.avg_watch_time.toFixed(1)} ثانية). ابدأ كل ريل بجملة تثير الفضول أو تعد بنتيجة، مثل «الخطأ اللي يسويه أغلب المبتدئين…»، واكتبها نص على الشاشة، وادخل في الموضوع بدون مقدمات.`,
          `Your most-watched reel is “${firstLine(best.caption)}” (${best.avg_watch_time.toFixed(1)} seconds). Open every reel with a line that sparks curiosity or promises a result, like “The mistake most beginners make…”, show it as on-screen text, and get straight to the point.`));
    } else if (rep.watch?.by_pct && rep.watch.median_ret < 0.35) {
      // الثواني لحالها تخدع: ١٨ ثانية من ريل طوله دقيقة ونص يعني طلعوا بدري
      problems.push(L(`الناس يتفرجون ${w.toFixed(1)} ثانية بالمتوسط، يعني يشوفون ${pct(rep.watch.median_ret)} بس من الريل. قصّر ريلزك وادخل في الموضوع من أول ثانية.`, `People watch ${w.toFixed(1)} seconds on average, which is only ${pct(rep.watch.median_ret)} of the reel. Make your reels shorter and get to the point from the first second.`));
    } else {
      wins.push(L(`متوسط مدة مشاهدة الريلز ${w.toFixed(1)} ثانية${rep.watch?.by_pct ? `، والناس يشوفون ${pct(rep.watch.median_ret)} من الريل بالمتوسط` : ""}.`,
        `Average reel watch time is ${w.toFixed(1)} seconds${rep.watch?.by_pct ? `, and people watch ${pct(rep.watch.median_ret)} of each reel on average` : ""}.`));
    }
  }
  const shareRate = k.reach ? k.shares / k.reach : 0;
  if (k.reach > 1000 && shareRate < 0.003) {
    rec("متوسطة", L("سوّ محتوى يتشارك", "Make content people want to share"), L(`المشاركات قليلة (${(shareRate * 1000).toFixed(1)} لكل ١٠٠٠ وصول). المشاركة أقوى طريقة توصل فيها لناس جدد بدون إعلانات. المحتوى اللي يتشارك عادةً: قوائم، مقارنات، أخطاء شائعة، أو شي يخلي الشخص يقول «لازم فلان يشوف هذا».`,
      `Shares are low (${(shareRate * 1000).toFixed(1)} per 1,000 reach). Shares are the strongest way to reach new people without ads. Content that gets shared is usually lists, comparisons, common mistakes, or anything that makes someone think “my friend needs to see this”.`));
  }

  // ٩. تحليل كل بوست مقارنة بمتوسطك
  const avgReach = avg(posts, (p) => p.reach), avgSaved = avg(posts, (p) => p.saved), avgVisits = avg(posts, (p) => p.profile_visits), avgWatch = avg(watched, (r) => r.avg_watch_time);
  const bestSlot = slotStats.length ? [...slotStats].sort((a, b) => b.er - a.er)[0].s : null;
  const avgIntent = avg(posts, (p) => p.intent);
  // نذكر بس العوامل اللي تفسر الحكم: الإيجابية للناجح والسلبية للضعيف
  const explain = (p, good) => {
    const why = [];
    const rel = (v, a) => (v != null && a ? (v - a) / a : null);
    const fits = (x, min) => x != null && (good ? x > min : x < -min);
    const r = rel(p.reach, avgReach), s = rel(p.saved, avgSaved), v = rel(p.profile_visits, avgVisits), w = rel(p.avg_watch_time, avgWatch);
    const hl = good ? "higher" : "lower";
    if (fits(v, 0.3)) why.push(L(`زيارات البروفايل ${good ? "أعلى" : "أقل"} من متوسطك بـ ${pct(Math.abs(v))}`, `profile visits ${pct(Math.abs(v))} ${good ? "above" : "below"} your average`));
    if (fits(s, 0.3)) why.push(L(`الحفظ ${good ? "أعلى" : "أقل"} بـ ${pct(Math.abs(s))}`, `saves ${pct(Math.abs(s))} ${hl}`));
    if (fits(r, 0.25)) why.push(L(`الوصول ${good ? "أعلى" : "أقل"} بـ ${pct(Math.abs(r))}`, `reach ${pct(Math.abs(r))} ${hl}`));
    if (fits(w, 0.15)) why.push(L(`الناس كملت مشاهدته ${good ? "أكثر" : "أقل"}: ${p.avg_watch_time.toFixed(1)} ث مقابل متوسطك ${avgWatch.toFixed(1)}`, `people watched ${good ? "more" : "less"} of it: ${p.avg_watch_time.toFixed(1)}s vs your average ${avgWatch.toFixed(1)}s`));
    const hasCta = CTA.test(p.caption);
    if (good && hasCta) why.push(L("فيه دعوة واضحة للتسجيل", "has a clear call to sign up"));
    if (!good && !hasCta) why.push(L("ما فيه دعوة للتسجيل أو التواصل", "no call to sign up or get in touch"));
    const slot = Math.floor(localHour(p, period.timezone) / 4);
    if (bestSlot != null && slot === bestSlot && good) why.push(L(`نُشر في أفضل وقت (${SLOTS[slot]})`, `posted in your best window (${lbl(SLOTS[slot])})`));
    if (bestSlot != null && slot !== bestSlot && !good) why.push(L(`نُشر ${SLOTS[slot]} وأفضل وقت لك ${SLOTS[bestSlot]}`, `posted ${lbl(SLOTS[slot])}, but your best window is ${lbl(SLOTS[bestSlot])}`));
    // بوست ضعيف وصل لناس كثير: المشكلة إنه ما حرّكهم، مو إنه ما انشاف
    if (!good && r != null && r > 0.25) why.unshift(L(`وصل لناس أكثر من المعتاد بـ ${pct(r)} لكن ما حرّكهم: الاهتمام ${pct(p.intent)} مقابل متوسطك ${pct(avgIntent)}`, `reached ${pct(r)} more people than usual but didn't move them: ${pct(p.intent)} interest vs your average ${pct(avgIntent)}`));
    return why.length ? L(why.join("، ") + ".", cap(why.join("; ")) + ".") : L(`مؤشر الاهتمام ${pct(p.intent)} مقابل متوسطك ${pct(avgIntent)}.`, `Interest score ${pct(p.intent)} vs your average ${pct(avgIntent)}.`);
  };
  const post_insights = [
    ...rep.top.map((p) => ({ post_id: p.id, verdict: "ناجح", why: explain(p, true) })),
    ...rep.bottom.map((p) => ({ post_id: p.id, verdict: "ضعيف", why: explain(p, false) })),
  ];

  // ١٠. أفكار محتوى من أنجح بوستاتك
  // نوع واحد ما فيه مقارنة، فما نقول «أقوى نوع»
  const bestKind = solid.length >= 2 ? [...solid].sort((a, b) => b.avg_fair - a.avg_fair)[0] : null;
  const seen = new Set();
  const uniqueTop = rep.top.filter((p) => !seen.has(firstLine(p.caption)) && seen.add(firstLine(p.caption)));
  const content_ideas = uniqueTop.slice(0, 3).map((p, i) => {
    const hook = firstLine(p.caption) || L("نفس فكرة البوست", "Same idea as the original post");
    if (i === 0) return { title: L("جزء ثاني من أنجح بوست", "Part 2 of your best post"), format: lbl(p.kind_name), hook: L(`${hook} (الجزء ٢)`, `${hook} (Part 2)`), why: L(`هذا أعلى بوست في الاهتمام (${pct(p.intent)}). الجمهور أثبت إنه يبي هالموضوع، فكمّل عليه.`, `This is your top post for interest (${pct(p.intent)}). Your audience has shown they want this topic, so build on it.`) };
    if (p.kind === "REELS") return { title: L("حوّل الريل لكاروسيل خطوات", "Turn the reel into a step-by-step carousel"), format: lbl("كاروسيل"), hook, why: L(`الريل نجح (${pct(p.intent)} اهتمام). نفس المحتوى في كاروسيل ينحفظ أكثر ويوصل لناس ما شافوا الريل.`, `The reel worked (${pct(p.intent)} interest). The same content as a carousel gets saved more and reaches people who missed the reel.`) };
    return { title: L("حوّل البوست لريل", "Turn the post into a reel"), format: lbl("ريلز"), hook, why: L(`الفكرة نجحت (${pct(p.intent)} اهتمام). بصيغة ريل بتوصل لناس جدد من خارج متابعينك.`, `The idea worked (${pct(p.intent)} interest). As a reel it will reach new people beyond your followers.`) };
  });

  // الملخص
  const parts = [L(`خلال ${count(period.days, "يوم", "أيام")} نشرت ${count(k.posts, "بوست", "بوستات")}`, `In ${ce(period.days, "day")} you published ${ce(k.posts, "post")}`)];
  if (reachCh != null) parts.push(L(`ومتوسط الوصول للبوست ${reachCh >= 0 ? "ارتفع" : "نزل"} ${pct(Math.abs(reachCh))}`, `average reach per post ${reachCh >= 0 ? "rose" : "fell"} ${pct(Math.abs(reachCh))}`));
  if (intentCh != null) parts.push(L(`والحفظ والمشاركة ${intentCh >= 0 ? "ارتفعوا" : "نزلوا"} ${pct(Math.abs(intentCh))}`, `saves and shares ${intentCh >= 0 ? "rose" : "fell"} ${pct(Math.abs(intentCh))}`));
  if (k.follower_growth != null) parts.push(L(`${k.follower_net ? "وصافي المتابعين" : "والمتابعين الجدد"} ${k.follower_growth >= 0 ? "+" : ""}${n(k.follower_growth)}`, `${k.follower_net ? "net followers" : "new followers"} ${k.follower_growth >= 0 ? "+" : ""}${n(k.follower_growth)}`));
  let summary = parts.join(L("، ", ", ")) + ".";
  if (bestKind) summary += L(` أكثر نوع ينحفظ وينشارك عندك هو ${bestKind.name}.`, ` Your most saved and shared format is ${lbl(bestKind.name)}.`);
  if (small) summary += L(" عدد البوستات قليل، فاعتبر الاستنتاجات مبدئية لين تتجمع بيانات أكثر.", " That's only a few posts, so treat these conclusions as early until more data comes in.");

  // خطة الفترة الجاية
  const target = Math.max(3, Math.round(weekly));
  const mix = bestKind && solid.length >= 2
    ? (() => {
        const reachKind = [...solid].sort((a, b) => b.avg_reach - a.avg_reach)[0];
        if (reachKind.kind === bestKind.kind) return L(`${Math.ceil(target * 0.6)} ${bestKind.name} و${target - Math.ceil(target * 0.6)} من الأنواع الثانية`, `${ce(Math.ceil(target * 0.6), `${lbl(bestKind.name)} post`)} and ${target - Math.ceil(target * 0.6)} in other formats`);
        return L(`${Math.ceil(target / 2)} ${reachKind.name} (للوصول) و${Math.floor(target / 2)} ${bestKind.name} (للإقناع)`, `${ce(Math.ceil(target / 2), `${lbl(reachKind.name)} post`)} (for reach) and ${ce(Math.floor(target / 2), `${lbl(bestKind.name)} post`)} (to build trust)`);
      })()
    : L(`${target} بوستات متنوعة`, "a mix of formats");
  const bestSlotName = slotStats.length >= 2 ? [...slotStats].sort((a, b) => b.er - a.er)[0].name : null;
  const timeHint = bestSlotName ? L(` في فترة ${bestSlotName}`, `, in the ${lbl(bestSlotName)} window`) : peak != null ? L(` قبل الساعة ${hourName(peak)}`, `, before ${hourName(peak)}`) : "";
  const next_steps = L(`انشر ${target} بوستات بالأسبوع: ${mix}${timeHint}. حط دعوة للتسجيل في كل بوست، وابدأ بأفكار المحتوى اللي تحت. ارجع للوحة بعد أسبوعين وقارن.`,
    `Publish ${target} posts a week: ${mix}${timeHint}. Add a sign-up call to action to every post, and start with the content ideas below. Come back in two weeks and compare.`);

  const order = { "عالية": 0, "متوسطة": 1, "منخفضة": 2 };
  return { summary, wins, problems, post_insights, recommendations: recs.sort((a, b) => order[a.priority] - order[b.priority]), content_ideas, next_steps };
}

function localHour(p, tz) {
  return +new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(p.timestamp));
}

// نصائح الستوري تنضاف لنصائح البوستات
export function advise(rep) {
  const out = advisePosts(rep);
  adviseComments(rep, out);
  adviseStories(rep, out);
  adviseSales(rep, out);
  adviseHashtags(rep, out);
  adviseTopics(rep, out);
  adviseGoals(rep, out);
  adviseAudience(rep, out);
  adviseUnfollows(rep, out);
  adviseCompetitors(rep, out);
  const order = { "عالية": 0, "متوسطة": 1, "منخفضة": 2 };
  out.recommendations.sort((a, b) => order[a.priority] - order[b.priority]);
  return out;
}

function adviseComments(rep, out) {
  const cm = rep.comments;
  if (!cm || !cm.kpis.total) return;
  const k = cm.kpis;
  const add = (priority, title, detail) => out.recommendations.push({ priority, title, detail });
  if (k.open) {
    const price = cm.list.filter((c) => c.intent === "سعر" && c.stage === "جديد").length;
    add("عالية", L(`رد على ${count(k.open, "عميل محتمل", "عملاء محتملين", "عميلين محتملين")}`, `Reply to ${ce(k.open, "potential customer")}`),
      L(`فيه ${count(k.open, "تعليق", "تعليقات", "تعليقين")} ${k.open === 1 ? "يسأل" : "تسأل"} عن السعر أو التسجيل وما رديت ${k.open === 1 ? "عليه" : "عليها"}${price && k.open > 1 ? ` (منها ${count(price, "تعليق", "تعليقات", "تعليقين")} عن السعر)` : ""}. هذول أقرب ناس للشراء، والرد السريع يفرق. القائمة في قسم «عملاء محتملين من التعليقات».`,
        `${ce(k.open, "comment")} asking about price or sign-up ${k.open === 1 ? "is" : "are"} still waiting for your reply${price && k.open > 1 ? ` (${n(price)} of them about price)` : ""}. These are the people closest to buying, and a quick reply makes a difference. The list is in the “Leads from comments” section.`));
  } else if (k.leads) {
    out.wins.push(L(`رديت على كل اللي سألوا عن السعر أو التسجيل (${count(k.leads, "تعليق", "تعليقات", "تعليقين")}).`, `You replied to everyone who asked about price or sign-up (${ce(k.leads, "comment")}).`));
  }
  // المتابعة: اللي رديت عليهم وما سجّلوا
  if (cm.due) {
    add("عالية", L(`تابع ${count(cm.due, "عميل", "عملاء", "عميلين")} رديت عليهم وما سجّلوا`, `Follow up with ${ce(cm.due, "lead")} who haven't signed up`),
      L(`سألوا عن السعر أو التسجيل، ورديت عليهم من ${FIRST_FOLLOWUP} أيام أو أكثر، وما وصلتهم نتيجة. رسالة قصيرة بالخاص مثل «هلا، حبيت أتأكد وصلتك تفاصيل ${O()}؟» ترجّع كثير منهم. القائمة في «عملاء محتملين» تحت «يحتاج متابعة».`,
        `They asked about price or sign-up and you replied ${FIRST_FOLLOWUP}+ days ago, but nothing has come of it yet. A short DM like “Hi, just checking you got the details about ${O()}?” brings many of them back. The list is in “Leads” under “Needs follow-up”.`));
  }
  const pl = cm.pipeline;
  if (pl?.stages["سجّل"] >= 2) {
    out.wins.push(L(`${count(pl.stages["سجّل"], "شخص", "أشخاص", "شخصين")} سجّلوا من اللي سألوا في التعليقات (${pct(pl.conversion)} من ${count(pl.leads, "عميل محتمل", "عملاء محتملين", "عميلين محتملين")})${pl.median_days != null ? `، وعادةً يسجّلون بعد ${pl.median_days < 1 ? "أقل من يوم" : count(Math.round(pl.median_days), "يوم", "أيام", "يومين")} من التعليق` : ""}.`,
      `${ce(pl.stages["سجّل"], "person", "people")} who asked in the comments signed up (${pct(pl.conversion)} of ${ce(pl.leads, "lead")})${pl.median_days != null ? `, usually ${pl.median_days < 1 ? "less than a day" : ce(Math.round(pl.median_days), "day")} after commenting` : ""}.`));
  }
  const ch = change(k.leads, rep.comments.prev_kpis.leads);
  if (ch != null && rep.comments.prev_kpis.leads >= 3 && ch > 0.2) out.wins.push(L(`التعليقات اللي فيها نية شراء زادت ${pct(ch)} عن الفترة السابقة.`, `Comments showing buying intent are up ${pct(ch)} from the previous period.`));
  if (k.total >= 30 && k.leads / k.total < 0.03) {
    add("متوسطة", L("خل التعليقات تتحول لأسئلة شراء", "Turn comments into buying questions"),
      L(`من ${n(k.total)} تعليق، ${n(k.leads)} بس يسألون عن السعر أو التسجيل. جرّب تختم البوست بجملة مثل «اكتب "${W}" وأرسل لك تفاصيل ${O()}»، عشان التفاعل يتحول لمحادثة بيع.`,
        `Out of ${ce(k.total, "comment")}, only ${n(k.leads)} ask about price or sign-up. Try ending posts with a line like “Comment "${W}" and I'll send you the details about ${O()}”, so engagement turns into a sales conversation.`));
  }
}

function adviseStories(rep, out) {
  const st = rep.stories;
  if (!st || st.kpis.count < 5) return;
  const k = st.kpis, pk = st.prev_kpis, list = st.list;
  const add = (priority, title, detail) => out.recommendations.push({ priority, title, detail });

  const perDay = k.count / Math.max(1, k.days);
  const actCh = change(k.avg_action_rate, pk.avg_action_rate);
  if (actCh != null && pk.count >= 5 && actCh > 0.15) out.wins.push(L(`الستوري صارت تحرّك الناس أكثر: نسبة الإجراء (رد، زيارة، رابط، متابعة) ارتفعت ${pct(actCh)}.`, `Your stories are driving more action: the action rate (replies, profile visits, link taps, follows) is up ${pct(actCh)}.`));
  if (actCh != null && pk.count >= 5 && actCh < -0.15) out.problems.push(L(`نسبة الإجراء من الستوري نزلت ${pct(-actCh)} عن الفترة السابقة.`, `Your story action rate is down ${pct(-actCh)} from the previous period.`));

  // وين يطيح الجمهور في سلسلة اليوم
  const drop = st.retention.find((r) => r.position > 1 && r.kept < 0.6);
  if (drop) {
    add("عالية", L("حط دعوة التسجيل بدري في الستوري", "Put the sign-up call early in your stories"),
      L(`بالمتوسط تنزّل ${perDay.toFixed(1)} ستوري باليوم، وعند الستوري رقم ${drop.position} يبقى معك ${pct(drop.kept)} بس من اللي شافوا الأولى. أهم ستوري (عرض ${O()} أو الرابط) خلها ضمن أول ${count(drop.position - 1, "ستوري", "ستوريات", "ستوريتين")}، مو في آخر السلسلة.`,
        `You post ${perDay.toFixed(1)} stories a day on average, and by story #${drop.position} only ${pct(drop.kept)} of the people who saw the first one are still watching. Put your most important story (the offer or the link) within the first ${drop.position - 1 === 1 ? "story" : ce(drop.position - 1, "story", "stories")}, not at the end of the sequence.`));
  } else if (st.retention.length >= 3) {
    out.wins.push(L(`جمهورك يكمل سلسلة الستوري: حتى الستوري رقم ${st.retention.at(-1).position} يبقى معك ${pct(st.retention.at(-1).kept)}.`, `Your audience sticks with your stories: ${pct(st.retention.at(-1).kept)} are still watching by story #${st.retention.at(-1).position}.`));
  }

  if (k.avg_exit_rate != null && k.avg_exit_rate > 0.12) {
    const worst = [...list].filter((x) => x.exit_rate != null).sort((a, b) => b.exit_rate - a.exit_rate)[0];
    out.problems.push(L(`${pct(k.avg_exit_rate)} من مشاهدي الستوري يطلعون منها بالمتوسط${worst ? `، وأعلى ستوري خروج كانت ${pct(worst.exit_rate)}` : ""}. الخروج يعني الستوري ما شدّتهم، وانستجرام يقلل ظهور اللي بعدها.`,
      `On average ${pct(k.avg_exit_rate)} of story viewers exit${worst ? `, and your highest-exit story hit ${pct(worst.exit_rate)}` : ""}. An exit means the story didn't hold them, and Instagram shows the next ones to fewer people.`));
  }

  if (k.avg_reach && k.replies / (k.avg_reach * k.count) < 0.002) {
    add("متوسطة", L("خل الستوري تفتح محادثات", "Use stories to start conversations"),
      L(`الردود على الستوري قليلة (${n(k.replies)} رد). جرّب ستوري فيها سؤال مباشر مثل «تبي التفاصيل؟ ارسل لي كلمة ${W}»، لأن كل رد هو محادثة بيع تبدأ في الخاص.`,
        `Story replies are low (${ce(k.replies, "reply", "replies")}). Try a story with a direct question like “Want the details? DM me the word ${W}”, because every reply is a sales conversation starting in your DMs.`));
  }

  // أفضل وقت للستوري حسب نسبة الإجراء
  const bySlot = {};
  for (const x of list) if (x.action_rate != null) (bySlot[Math.floor(x.hour / 4)] ||= []).push(x.action_rate);
  const slots = Object.entries(bySlot).filter(([, v]) => v.length >= 2).map(([sl, v]) => ({ sl: +sl, r: v.reduce((a, b) => a + b, 0) / v.length }));
  if (slots.length >= 2) {
    const best = slots.sort((a, b) => b.r - a.r)[0];
    out.wins.push(L(`أكثر وقت الستوري تحرّك فيه الناس: ${SLOTS[best.sl]} (${pct(best.r)} إجراء).`, `Stories drive the most action in the ${lbl(SLOTS[best.sl])} window (${pct(best.r)} action rate).`));
  }

  out.summary += L(` وفي الستوري: ${count(k.count, "ستوري", "ستوريات")} بمتوسط وصول ${n(k.avg_reach || 0)}${k.link_clicks ? ` و${count(k.link_clicks, "نقرة على الرابط", "نقرات على الرابط", "نقرتين على الرابط")}` : ""}.`,
    ` Stories: ${ce(k.count, "story", "stories")} with an average reach of ${n(k.avg_reach || 0)}${k.link_clicks ? ` and ${ce(k.link_clicks, "link tap")}` : ""}.`);
}

function adviseSales(rep, out) {
  const sl = rep.sales;
  if (!sl) return;
  const k = sl.kpis, pk = sl.prev_kpis;
  const add = (priority, title, detail) => out.recommendations.push({ priority, title, detail });
  if (!k.count) {
    add("متوسطة", L("سجّل التسجيلات عشان تعرف أي محتوى يبيع", "Log your sign-ups to see which content sells"),
      L("اللايكات والوصول ما تقول لك أي بوست جاب فلوس. كل ما سجّل أحد أو اشترى منك، أضفه في قسم «التسجيلات والمبيعات» ومن وين جاك، والأداة تربطه بالبوستات اللي نزلت قبله.",
        "Likes and reach don't tell you which post made money. Every time someone signs up or buys from you, add them in the “Sign-ups & sales” section along with where they came from, and the tool will link it to the posts published before."));
    return;
  }

  const ch = change(k.count, pk.count);
  if (ch != null && pk.count >= 3 && ch > 0.2) out.wins.push(L(`التسجيلات زادت ${pct(ch)} عن الفترة السابقة (من ${n(pk.count)} إلى ${n(k.count)}).`, `Sign-ups are up ${pct(ch)} from the previous period (from ${n(pk.count)} to ${n(k.count)}).`));
  if (ch != null && pk.count >= 3 && ch < -0.2) out.problems.push(L(`التسجيلات نزلت ${pct(-ch)} عن الفترة السابقة (من ${n(pk.count)} إلى ${n(k.count)}).`, `Sign-ups are down ${pct(-ch)} from the previous period (from ${n(pk.count)} to ${n(k.count)}).`));

  const src = sl.by_source[0];
  if (src && k.count >= 3 && src.count / k.count >= 0.4) out.wins.push(L(`أكثر مصدر يجيب لك مسجلين: ${src.source} (${n(src.count)} من ${n(k.count)}).`, `Your top source of sign-ups: ${lbl(src.source)} (${n(src.count)} of ${n(k.count)}).`));

  // النوع اللي يبيع مقابل النوع اللي ينتشر
  const types = sl.by_type.filter((t) => t.posts >= 2);
  if (types.length >= 2 && k.count >= 5) {
    const seller = types[0];
    const spreader = [...types].sort((a, b) => (b.avg_reach || 0) - (a.avg_reach || 0))[0];
    if (seller.kind !== spreader.kind && seller.per_post > 0) {
      const ratio = spreader.per_post ? seller.per_post / spreader.per_post : null;
      const S = lbl(seller.name), P = lbl(spreader.name);
      add("عالية", L(`${seller.name} يبيع أكثر من ${spreader.name}`, `${S} sells better than ${P}`),
        L(`${spreader.name} يوصل لناس أكثر (متوسط ${n(spreader.avg_reach)})، لكن بعد ${seller.name} يجيك ${seller.per_post.toFixed(1)} مسجل للبوست${ratio ? ` (${ratio.toFixed(1)} ضعف)` : ` مقابل ولا مسجل بعد ${spreader.name}`}. خل ${spreader.name} لجذب ناس جدد، ولا توقف ${seller.name} لأنه اللي يحوّلهم لمسجلين.`,
          `${P} posts reach more people (${n(spreader.avg_reach)} on average), but ${S} posts bring in ${seller.per_post.toFixed(1)} sign-ups per post${ratio ? ` (${ratio.toFixed(1)}x as many)` : `, vs none after ${P}`}. Keep ${P} for attracting new people, and don't drop ${S}: it's what turns them into sign-ups.`));
    } else if (seller.per_post > 0) {
      out.wins.push(L(`${seller.name} يوصل ويبيع بنفس الوقت: ${seller.per_post.toFixed(1)} مسجل للبوست بالمتوسط.`, `${lbl(seller.name)} posts reach and sell at the same time: ${seller.per_post.toFixed(1)} sign-ups per post on average.`));
    }
  }

  // أنجح بوست بالمبيعات، وهل هو نفسه أعلى بوست وصول؟
  const best = sl.top_posts[0];
  if (best && best.attributed >= 2) {
    const topReach = [...rep.posts].sort((a, b) => (b.reach || 0) - (a.reach || 0))[0];
    const same = topReach && topReach.id === best.id;
    out.wins.push(L(`أكثر بوست جاب تسجيلات: «${firstLine(best.caption) || best.kind_name}» (${count(Math.round(best.attributed), "مسجل", "مسجلين", "مسجلَين")}${best.direct === best.attributed ? "" : " تقريباً"})${same ? "، وهو نفسه أعلى بوست وصول" : topReach ? `، مع إن وصوله ${n(best.reach || 0)} بس مقابل ${n(topReach.reach || 0)} لأعلى بوست` : ""}.`,
      `Your top post for sign-ups: “${firstLine(best.caption) || lbl(best.kind_name)}” (${best.direct === best.attributed ? "" : "about "}${ce(Math.round(best.attributed), "sign-up")})${same ? ", and it's also your highest-reach post" : topReach ? `, even though it reached only ${n(best.reach || 0)} vs ${n(topReach.reach || 0)} for your top post` : ""}.`));
    out.content_ideas.unshift({ title: L("أعد البوست اللي باع", "Remake the post that sold"), format: lbl(best.kind_name), hook: firstLine(best.caption) || L("نفس الفكرة بزاوية جديدة", "Same idea, new angle"), why: L(`هذا البوست جاب أكثر تسجيلات في الفترة. الجمهور اللي يشتري تفاعل معه، فنزّل نسخة جديدة منه أو كمّل عليه.`, `This post brought in the most sign-ups this period. The people who buy engaged with it, so post a new version or a follow-up.`) });
    out.content_ideas.length = Math.min(out.content_ideas.length, 4);
  }

  if (sl.unattributed / k.count > 0.5 && k.count >= 4) {
    add("منخفضة", L("حدد البوست أو المصدر لما تسجّل", "Add the post or source when you log a sign-up"),
      L(`${n(sl.unattributed)} من ${n(k.count)} تسجيل ما قدرت الأداة تربطه بأي بوست. لما تضيف تسجيل، اختر المصدر، وإذا قال لك العميل أي بوست شافه حدده، عشان التحليل يصير أدق.`,
        `${n(sl.unattributed)} of ${ce(k.count, "sign-up")} couldn't be linked to any post. When you add a sign-up, pick the source, and if the customer tells you which post they saw, select it so the analysis gets more accurate.`));
  }

  out.summary += L(` وسجلت ${count(k.count, "تسجيل", "تسجيلات", "تسجيلين")}${k.revenue != null ? ` بقيمة ${n(k.revenue)} ريال` : ""}.`,
    ` You logged ${ce(k.count, "sign-up")}${k.revenue != null ? ` worth ${n(k.revenue)} SAR` : ""}.`);
}

// أهداف الشهر: إذا متأخر، وش تحتاج
const GOAL_EN = { followers: ["new followers", "follower"], sales: ["sign-ups", "sign-up"], revenue: ["revenue", null] };
function adviseGoals(rep, out) {
  const g = rep.goals;
  if (!g?.goals.length) return;
  const amount = (x, goal) => L(
    goal.metric === "revenue" ? `${n(x)} ريال` : count(Math.ceil(x), goal.unit, goal.unit === "متابع" ? "متابعين" : "تسجيلات", goal.unit === "متابع" ? "متابعَين" : "تسجيلين"),
    goal.metric === "revenue" ? `${n(x)} SAR` : ce(Math.ceil(x), GOAL_EN[goal.metric]?.[1] || lbl(goal.unit)),
  );
  const goalName = (x) => L(x.name, GOAL_EN[x.metric]?.[0] || lbl(x.name));
  const monthEn = g.month ? new Date(`${g.month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : lbl(g.month_name);
  for (const x of g.goals) {
    if (x.status === "done") out.wins.push(L(`حققت هدف ${x.name} لـ ${g.month_name} (${amount(x.actual, x)} من ${amount(x.target, x)}).`, `You hit your ${goalName(x)} goal for ${monthEn} (${amount(x.actual, x)} of ${amount(x.target, x)}).`));
    else if (x.status === "ahead") out.wins.push(L(`ماشي أسرع من هدف ${x.name}: لو كملت كذا توصل ${amount(x.projection, x)} من ${amount(x.target, x)}.`, `You're ahead of your ${goalName(x)} goal: at this pace you'll reach ${amount(x.projection, x)} against a target of ${amount(x.target, x)}.`));
    else if (x.status === "behind") {
      const tip = x.metric === "followers"
        ? L(`انشر أكثر من محتوى الجذب${rep.topics?.best?.reach ? ` («${rep.topics.best.reach}» أعلى وصول عندك)` : ""}.`, `Post more reach content${rep.topics?.best?.reach ? ` (“${lbl(rep.topics.best.reach)}” gets your highest reach)` : ""}.`)
        : L(`ركّز على بوستات البيع، وتابع اللي سألوا عن السعر${rep.comments?.due ? ` (عندك ${n(rep.comments.due)} يحتاجون متابعة)` : ""}.`, `Focus on sales posts, and follow up with people who asked about price${rep.comments?.due ? ` (${n(rep.comments.due)} need a follow-up)` : ""}.`);
      out.recommendations.push({ priority: "عالية", title: L(`متأخر عن هدف ${x.name}`, `Behind on your ${goalName(x)} goal`),
        detail: L(`وصلت ${n(x.actual)} من ${amount(x.target, x)}، والمفروض تكون عند ${n(x.expected)} الحين. ${g.days_left >= 7 ? `باقي ${count(g.days_left, "يوم", "أيام")} وتحتاج ${amount(x.per_week, x)} بالأسبوع` : `تحتاج ${amount(x.target - x.actual, x)} في ${g.days_left === 1 ? "آخر يوم" : g.days_left === 2 ? "آخر يومين" : `آخر ${count(g.days_left, "يوم", "أيام")}`}`}. ${tip}`,
          `You're at ${n(x.actual)} of ${amount(x.target, x)}; by now you should be at ${n(x.expected)}. ${g.days_left >= 7 ? `With ${ce(g.days_left, "day")} left, you need ${amount(x.per_week, x)} a week` : `You need ${amount(x.target - x.actual, x)} in ${g.days_left === 1 ? "the last day" : `the last ${ce(g.days_left, "day")}`}`}. ${tip}`) });
    }
  }
}

// اللي ألغوا متابعتك: النسبة مقارنة بالفترة اللي قبلها، والأيام اللي فيها إلغاء غير عادي
// المنافسين: نقارن بنفس المقياس المتاح للكل (لايكات + تعليقات ÷ المتابعين)
function adviseCompetitors(rep, out) {
  const C = rep.competitors;
  if (!C?.rows?.length) return;
  const me = C.rows[0], others = C.rows.slice(1).filter((r) => r.eng != null && r.posts >= 6);
  if (!others.length || me.eng == null) return;
  const add = (priority, title, detail) => out.recommendations.push({ priority, title, detail });
  if (others.every((r) => me.eng > r.eng * 1.2))
    out.wins.push(L(`تفاعل جمهورك أعلى من كل منافسينك (${pct(me.eng)} للبوست، وأقربهم ${pct(Math.max(...others.map((r) => r.eng)))}).`,
      `Your audience engages more than every competitor's (${pct(me.eng)} per post; the closest is ${pct(Math.max(...others.map((r) => r.eng)))}).`));
  // منافس ينشر أكثر منك بوضوح وتفاعله ما نزل
  const busy = others.filter((r) => r.per_week >= Math.max(2, me.per_week * 1.5) && r.eng >= me.eng * 0.8).sort((a, b) => b.per_week - a.per_week)[0];
  if (busy) add("منخفضة", L(`@${busy.username} ينشر ${n(busy.per_week)} بالأسبوع وأنت ${me.per_week < 1 ? "أقل من وحدة" : n(me.per_week)}`, `@${busy.username} posts ${n(busy.per_week)} a week; you post ${me.per_week < 1 ? "less than one" : n(me.per_week)}`),
    L(`آخر ٤ أسابيع، وتفاعله للبوست ${pct(busy.eng)} مقابل ${pct(me.eng)} عندك، يعني كثرة النشر ما نزّلت تفاعله. لو تقدر تزيد بوست واحد بالأسبوع، جرّبه شهر وشوف.`,
      `Over the last 4 weeks, with ${pct(busy.eng)} engagement per post vs your ${pct(me.eng)}, so posting more hasn't hurt them. If you can add one post a week, try it for a month.`));
  // نوع شغّال عند أغلبهم وأنت ما تستخدمه
  const KIND = { REELS: ["الريلز", "Reels"], CAROUSEL_ALBUM: ["الكاروسيل", "carousels"], IMAGE: ["الصور", "photos"] };
  const votes = {};
  for (const r of others) if (r.best_kind) votes[r.best_kind] = (votes[r.best_kind] || 0) + 1;
  const [kind, v] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || [];
  if (kind && v >= 2 && v >= others.length / 2 && (me.mix[kind] || 0) / Math.max(me.posts, 1) < 0.15)
    add("منخفضة", L(`${KIND[kind][0]} أقوى نوع عند ${v} من منافسينك`, `${cap(KIND[kind][1])} are the strongest format for ${v} of your competitors`),
      L(`وأنت ${me.mix[kind] ? `نزّلت ${n(me.mix[kind])} بس آخر شهرين` : "ما نزّلت منها آخر شهرين"}. جرّب ٣ بوستات منها وقارن.`,
        `You ${me.mix[kind] ? `posted only ${n(me.mix[kind])} in the last two months` : "haven't posted any in the last two months"}. Try 3 and compare.`));
}

function adviseUnfollows(rep, out) {
  const k = rep.kpis, pk = rep.prev_kpis;
  const per100 = (x) => Math.round(x * 100);
  // المقارنة بعدد اللي يلغون باليوم، مو بالنسبة: يوم فيه متابعين جدد كثير ينزّل النسبة ويخلي الفترة الجاية تبين أسوأ وهي مو كذا
  const perDay = (x) => (x.unfollows != null && x.flow_days ? x.unfollows / x.flow_days : null);
  const now = perDay(k), before = perDay(pk);
  const d1 = (x) => (Math.round(x * 10) / 10).toLocaleString("en-US");
  if (now != null && before != null && k.unfollows >= 10 && now >= before * 1.5 && now - before >= 1) {
    out.problems.push(L(`اللي يلغون متابعتك زادوا: ${d1(now)} باليوم، مقابل ${d1(before)} في الفترة السابقة.`,
      `More people are unfollowing: ${d1(now)} a day, vs ${d1(before)} in the previous period.`));
  } else if (k.unfollow_rate != null && k.follows >= 30 && k.unfollow_rate <= 0.15) {
    out.wins.push(L(`المتابعين الجدد يبقون: ${n(k.follows)} تابعوك و${n(k.unfollows)} بس ألغوا (${per100(k.unfollow_rate)} من كل ١٠٠).`,
      `New followers are sticking: ${n(k.follows)} followed you and only ${n(k.unfollows)} unfollowed (${per100(k.unfollow_rate)} per 100).`));
  }
  // أكبر يوم إلغاء في الفترة، لو قبله بوست
  const spike = [...(rep.unfollow_spikes || [])].filter((s) => s.posts.length).sort((a, b) => b.unfollows - a.unfollows)[0];
  if (spike) {
    const post = spike.posts.at(-1);
    const d = new Date(spike.date + "T12:00:00Z").toLocaleDateString(L("ar-SA-u-nu-latn-ca-gregory", "en-US"), { day: "numeric", month: "long", timeZone: "UTC" });
    out.recommendations.push({ priority: "متوسطة", title: L(`${n(spike.unfollows)} ألغوا متابعتك في يوم واحد (${d})`, `${n(spike.unfollows)} people unfollowed you in one day (${d})`),
      detail: L(`عادتك ${n(spike.usual)} باليوم. قبلها نزّلت «${post.caption || "بوست بدون كابشن"}». شوف إذا موضوعه أو طريقته بعيدة عن اللي تابعوك عشانه، أو كان بيع مباشر بدون قيمة قبله.`,
        `You usually lose ${n(spike.usual)} a day. Just before, you posted “${post.caption || "a post with no caption"}”. Check whether its topic or style is far from what people followed you for, or whether it was a hard sell with no value first.`) });
  }
}

// مين جمهورك: الفرق بين اللي يتابعونك واللي يتفاعلون معك، والدول (للسعر والعملة)
function adviseAudience(rep, out) {
  const a = rep.audience;
  if (!a?.total) return;
  const add = (priority, title, detail) => out.recommendations.push({ priority, title, detail });
  const ageName = (k) => k.replace("-", "–");
  const pp = (x) => L(`${Math.round(x * 100)}٪`, `${Math.round(x * 100)}%`);
  const region = new Intl.DisplayNames([L("ar", "en")], { type: "region" });
  const country = (k) => { try { return region.of(k); } catch { return k; } };

  if (a.engaged) {
    // العمر: أكبر فئة تتفاعل أكثر من حجمها بين متابعينك
    const rows = a.followers.age.map((f, i) => ({ key: f.key, f: f.share, e: a.engaged.age[i]?.share || 0, i }));
    const mean = (k) => rows.reduce((s, r) => s + r[k] * r.i, 0);
    const up = rows.filter((r) => r.e - r.f >= 0.08).sort((x, y) => (y.e - y.f) - (x.e - x.f))[0];
    if (up) {
      const topF = [...rows].sort((x, y) => y.f - x.f)[0];
      // أكبر فئة بين متابعينك ما تتفاعل بقدر حجمها؟
      const lag = topF.key !== up.key && topF.f - topF.e >= 0.05;
      const younger = mean("e") < mean("f");
      add("منخفضة", L(`اللي يتفاعلون معك هالشهر ${younger ? "أصغر" : "أكبر"} من متابعينك`, `The people engaging with you this month are ${younger ? "younger" : "older"} than your followers`),
        L(`عمر ${ageName(up.key)} هم ${pp(up.e)} من اللي تفاعلوا معك هالشهر، مع إنهم ${pp(up.f)} من متابعينك. يعني محتواك الأخير يحرّك هالفئة أكثر. إذا هم اللي تبي تبيع لهم ${O()}، كمّل على نفس الخط.${lag ? ` وإذا تبي توصل لأكبر فئة عندك (${ageName(topF.key)}، ${pp(topF.f)} من متابعينك و${pp(topF.e)} بس من المتفاعلين)، جرّب أمثلة ومواضيع تناسب أعمارهم.` : ""}`,
          `People aged ${ageName(up.key)} are ${pp(up.e)} of those who engaged with you this month, but only ${pp(up.f)} of your followers. Your recent content is moving this group more. If they're who you want to sell to, keep going.${lag ? ` To reach your biggest group (${ageName(topF.key)}: ${pp(topF.f)} of followers but only ${pp(topF.e)} of those engaging), try examples and topics that fit their age.` : ""}`));
    }
    // الجنس
    const fW = a.followers.gender.list.find((x) => x.key === "F")?.share || 0, eW = a.engaged.gender.list.find((x) => x.key === "F")?.share || 0;
    if (Math.abs(eW - fW) >= 0.1) {
      const more = eW > fW;
      add("منخفضة", L(`${more ? "النساء" : "الرجال"} يتفاعلون معك أكثر من نسبتهم بين متابعينك`, `${more ? "Women" : "Men"} engage with you more than their share of your followers`),
        L(`النساء ${pp(eW)} من اللي تفاعلوا معك هالشهر، و${pp(fW)} من متابعينك (من اللي جنسهم معروف). ${more ? "فيه اهتمام من النساء أكثر من المتوقع، فأمثلة وأصوات نسائية في المحتوى ممكن توسّعه." : "الرجال يتفاعلون أكثر، فلو تبي توصل للنساء من متابعينك جرّب أمثلة تناسبهم."}`,
          `Women are ${pp(eW)} of those who engaged this month and ${pp(fW)} of your followers (where gender is known). ${more ? "Women are more interested than expected, so featuring female voices and examples could grow that." : "Men engage more, so if you want to reach the women who follow you, try examples that speak to them."}`));
    }
  }

  const all = a.countries || [];
  const eShare = (k) => a.engaged?.country[k] || 0;
  const join = (list) => list.map((c) => country(c.key)).join(L("، ", ", "));
  if (a.engaged) {
    // دول عندها متابعين وما تتفاعل أبد: غالباً حسابات خاملة أو وهمية
    const silent = all.filter((c) => c.share >= 0.01 && eShare(c.key) < c.share / 10);
    const silentShare = silent.reduce((s, c) => s + c.share, 0);
    if (silentShare >= 0.05) {
      add("منخفضة", L(`${pp(silentShare)} من متابعينك ما يتفاعلون أبد`, `${pp(silentShare)} of your followers never engage`),
        L(`متابعينك من ${join(silent.slice(0, 4))} (${n(silent.reduce((s, c) => s + c.value, 0))} متابع) تقريباً ما تفاعلوا معك هالشهر. غالباً حسابات خاملة أو وهمية، وهي تنزّل نسبة تفاعلك لأنها تنحسب من متابعينك. لا تبني محتواك عليهم، وتجنّب أي شي يجيب متابعين عشوائيين (مسابقات عامة أو شراء متابعين).`,
          `Your followers in ${join(silent.slice(0, 4))} (${n(silent.reduce((s, c) => s + c.value, 0))} accounts) have barely engaged this month. They're most likely inactive or fake, and they pull your engagement rate down. Don't build content around them, and avoid anything that brings random followers (open giveaways or bought followers).`));
    }
    // دولة تتفاعل أكثر بكثير من حجمها بين متابعينك
    const hot = all.filter((c) => c.share >= 0.02 && eShare(c.key) >= 0.05 && eShare(c.key) >= c.share * 2).sort((x, y) => eShare(y.key) / y.share - eShare(x.key) / x.share)[0];
    if (hot) {
      out.wins.push(L(`${country(hot.key)} ${pp(hot.share)} بس من متابعينك، لكنها ${pp(eShare(hot.key))} من اللي تفاعلوا معك هالشهر. جمهورها من أكثر الناس اهتماماً بمحتواك، فمثال أو قصة من ${country(hot.key)} أو إعلان موجّه لهم يستاهل التجربة.`,
        `${country(hot.key)} is only ${pp(hot.share)} of your followers but ${pp(eShare(hot.key))} of the people who engaged this month. It's one of your most engaged audiences, so an example or story from ${country(hot.key)}, or an ad aimed there, is worth a try.`));
    }
  }

  // الدول: لو جمهورك المتفاعل موزّع على أكثر من دولة، السعر بعملة وحدة ممكن يضيّعهم
  const topC = all[0];
  // بس الدول اللي تتفاعل فعلاً (لو عندنا أرقام التفاعل)، عشان ما نقترح عملة دولة متابعينها خاملين
  const others = all.slice(1).filter((c) => (a.engaged ? eShare(c.key) >= 0.03 : c.share >= 0.03));
  if (topC && topC.share < 0.85 && others.length) {
    const names = others.slice(0, 4).map((c) => `${country(c.key)} ${pp(c.share)}`).join(L("، ", ", "));
    add("متوسطة", L("جمهورك من أكثر من دولة: وضّح السعر لهم", "Your audience is in several countries: make the price clear for them"),
      L(`${country(topC.key)} ${pp(topC.share)} من متابعينك، وبعدها ${names}. لما تعلن سعر ${O()}، حط جنب السعر تقريبه بعملات هالدول، ووضّح إذا ${O()} ينفع لمن هو برا ${country(topC.key)}. هذا يقلل سؤال «أنا من برا، ينفع؟» بالتعليقات.`,
        `${country(topC.key)} is ${pp(topC.share)} of your followers, followed by ${names}. When you announce the price of ${O()}, add the rough equivalent in those currencies and say whether people outside ${country(topC.key)} can join. That cuts down on “I'm abroad, can I join?” comments.`));
  }
}

// المواضيع: أي موضوع يجيب وصول وأيه يجيب عملاء
function adviseTopics(rep, out) {
  const t = rep.topics;
  if (!t?.ready) return;
  const add = (priority, title, detail) => out.recommendations.push({ priority, title, detail });
  const get = (name) => t.topics.find((x) => x.name === name);
  const by = (k) => L(`${k >= 0 ? "أعلى" : "أقل"} بـ ${pct(Math.abs(k))}`, `${pct(Math.abs(k))} ${k >= 0 ? "higher" : "lower"}`);

  // الموضوع اللي يجيب عملاء (من التسجيلات أو أسئلة السعر)
  const sell = get(t.best.sell);
  if (sell) {
    const what = sell.sales
      ? L(`جابت ${count(sell.sales, "تسجيل", "تسجيلات", "تسجيلين")}`, `brought in ${ce(sell.sales, "sign-up")}`)
      : L(`تجيب أسئلة سعر وتسجيل ${sell.leads_x >= 1.5 ? `${sell.leads_x.toFixed(1)} أضعاف عادتك` : "أكثر من عادتك"}`, `get ${sell.leads_x >= 1.5 ? `${sell.leads_x.toFixed(1)}x your usual number of` : "more than your usual"} price and sign-up questions`);
    add("عالية", L(`زِد بوستات «${sell.name}»`, `Post more about “${lbl(sell.name)}”`),
      L(`بوستات هالموضوع ${what} (${count(sell.n, "بوست", "بوستات", "بوستين")}). هذا أقرب موضوع للبيع عندك، فخله في بوستات البيع والإقناع.`,
        `Posts on this topic ${what} (${ce(sell.n, "post")}). It's your topic closest to sales, so use it in your selling and trust-building posts.`));
  }

  // الموضوع اللي يجيب وصول
  const reach = get(t.best.reach);
  if (reach && reach.reach_lift > 0.2) {
    out.wins.push(L(`بوستات «${reach.name}» وصولها ${by(reach.reach_lift)} من عادتك (${count(reach.n, "بوست", "بوستات", "بوستين")}).`, `“${lbl(reach.name)}” posts get ${by(reach.reach_lift)} reach than usual (${ce(reach.n, "post")}).`));
    // الوصول جاي من محتوى عام ومحتوى مجالك أضعف: اربطهم
    const [mine, gen] = t.sides;
    if (!reach.niche && mine.n >= 5 && mine.reach_lift != null && mine.reach_lift < -0.15) {
      add("متوسطة", L(`اربط «${reach.name}» بمجالك`, `Tie “${lbl(reach.name)}” back to your niche`),
        L(`محتواك العام يوصل أكثر، وبوستات مجالك وصولها ${by(mine.reach_lift)} من عادتك. الناس اللي تجيهم من المحتوى العام ما يعرفون إنك ${T(P.role)}. جرّب نفس الأسلوب بموضوع من مجالك: مقطع بنفس الروح، وفي آخره سطر عن ${O()}.`,
          `Your general content reaches more people, while your niche posts get ${by(mine.reach_lift)} reach than usual. People who find you through general content don't know you're ${T(P.role)}. Try the same style with a topic from your niche: a clip with the same vibe, ending with a line about ${O()}.`));
    }
  }

  // مواضيع ضعيفة في الوصول والاهتمام (المواضيع العامة بس، مجالك نتركه لأنه يخدم البيع)
  const weak = t.topics.filter((x) => x.enough && !x.niche && x.name !== "أخرى" && x.reach_lift < -0.25 && (x.intent_lift ?? 0) < -0.1);
  if (weak.length) out.problems.push(L(
    weak.map((x) => `بوستات «${x.name}» وصولها ${by(x.reach_lift)} واهتمامها ${by(x.intent_lift)} من عادتك (${count(x.n, "بوست", "بوستات", "بوستين")})`).join("، ") + ". ما تجيب جمهور ولا عملاء، فقلّلها أو غيّر طريقتها.",
    weak.map((x) => `“${lbl(x.name)}” posts get ${by(x.reach_lift)} reach and ${by(x.intent_lift)} interest than usual (${ce(x.n, "post")})`).join("; ") + ". They bring in neither audience nor customers, so post fewer of them or change the approach.",
  ));

  // المتابعين ما يعرفون إنك تبيع؟
  const mine = t.sides[0];
  if (mine.share < 0.3 && rep.account.goal !== "brand") {
    add("متوسطة", L("خل بوست من كل ثلاثة عن مجالك", "Make one in three posts about your niche"),
      L(`آخر سنة ${pct(mine.share)} بس من بوستاتك عن ${T(P.niche)} و${O()}. الناس ما يسألون عن ${O()} إذا ما شافوك تتكلم عنها. النصائح والأخطاء الشائعة والكواليس تبني ثقة قبل البيع.`,
        `Over the last year, only ${pct(mine.share)} of your posts were about ${T(P.niche)} or ${O()}. People won't ask about it if they never see you talk about it. Tips, common mistakes and behind-the-scenes build trust before the sale.`));
  }
}

function adviseHashtags(rep, out) {
  const h = rep.hashtags;
  if (!h?.ready || !h.tags.length) return;
  const add = (priority, title, detail) => out.recommendations.push({ priority, title, detail });
  const sign = (x) => L(`${x >= 0 ? "أعلى" : "أقل"} بـ ${pct(Math.abs(x))}`, `${pct(Math.abs(x))} ${x >= 0 ? "higher" : "lower"}`);
  const score = (t) => t.reach_lift + (t.intent_lift ?? 0);

  const good = h.tags.filter((t) => t.reach_lift > 0.15 && (t.intent_lift ?? 0) > -0.1).sort((a, b) => score(b) - score(a)).slice(0, 4);
  // هاشتاق اسمك للهوية مو للوصول، فما نحكم عليه
  const bad = h.tags.filter((t) => t.category !== "اسمك" && t.reach_lift < -0.2 && (t.intent_lift ?? 0) < 0 && t.n >= 10);
  if (good.length) {
    add("متوسطة", L(`الهاشتاقات اللي تجي مع وصول أعلى: ${good.map((t) => t.tag).join(" ")}`, `Hashtags linked to higher reach: ${good.map((t) => t.tag).join(" ")}`),
      L(`${good.map((t) => `${t.tag}: الوصول ${sign(t.reach_lift)} من عادتك (${n(t.n)} بوست)`).join("، ")}. هذا ارتباط مو سبب أكيد: ممكن الهاشتاق يجي مع نوع موضوع ينتشر أصلاً. جرّبها على بوستات مختلفة وشوف تثبت أو لا.`,
        `${good.map((t) => `${t.tag}: reach ${sign(t.reach_lift)} than usual (${ce(t.n, "post")})`).join("; ")}. This is a correlation, not proof: a hashtag may just come with a topic that spreads anyway. Test them on different posts and see if it holds.`));
  }
  if (bad.length) {
    out.problems.push(L(`بوستات ${bad.map((t) => t.tag).join(" و")} وصولها أقل من عادتك (${bad.map((t) => `${t.tag} ${pct(Math.abs(t.reach_lift))}`).join("، ")}). ممكن السبب الموضوع مو الهاشتاق، بس ما يستاهل تعتمد عليها.`,
      `Posts with ${bad.map((t) => t.tag).join(", ")} get lower reach than usual (${bad.map((t) => `${t.tag} −${pct(Math.abs(t.reach_lift))}`).join(", ")}). It may be the topic rather than the hashtag, but they're not worth relying on.`));
  }

  // هاشتاقات مجالك: هل تجيب جمهور مهتم؟
  const niche = h.categories.find((c) => c.name === "مجالك");
  if (niche?.intent_lift != null && niche.intent_lift > 0.15) out.wins.push(L(`البوستات اللي فيها هاشتاقات مجالك (${P.niche_tag_names[0]}) اهتمامها ${sign(niche.intent_lift)} من عادتك، يعني تجيب ناس قريبين من الشراء.`, `Posts with niche hashtags (${P.niche_tag_names[1]}) get ${sign(niche.intent_lift)} interest than usual, so they attract people closer to buying.`));

  // كم هاشتاق؟ بس إذا الفرق واضح، ومتوسطك الحالي مو أصلاً في هالمدى
  if (h.best_count && !(h.avg_count >= h.best_count.lo && h.avg_count <= h.best_count.hi)) {
    {
      const bc = h.best_count;
      const labelEn = bc.lo > 10 ? "more than 10" : bc.lo === bc.hi ? `${bc.lo}` : `${bc.lo}–${bc.hi}`;
      add("منخفضة", L(`استخدم ${h.best_count.label} هاشتاقات بالبوست`, `Use ${labelEn} hashtags per post`),
        L(`البوستات اللي فيها ${h.best_count.label} هاشتاقات وصولها ${sign(h.best_count.reach_lift)} من عادتك، أحسن من باقي الأعداد. حالياً متوسطك ${h.avg_count.toFixed(1)} هاشتاق.`,
          `Posts with ${labelEn} hashtags get ${sign(bc.reach_lift)} reach than usual, better than any other count. You currently average ${h.avg_count.toFixed(1)} hashtags.`));
    }
  }
}
