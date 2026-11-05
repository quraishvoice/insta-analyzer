// خطة نشر للأيام السبعة الجاية — من أرقامك أنت: أفضل الأيام والأوقات والأنواع، وأفكار من أنجح بوستاتك
import { report } from "./analysis.js";
import { topicOf } from "./topics.js";
import { listIdeas } from "./ideas.js";
import { L, lbl } from "./i18n.js";

import { P, T, OFFER_TOPIC } from "./profile.js";
const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const SLOTS = ["١٢–٤ بعد نص الليل", "٤–٨ الفجر", "٨–١٢ الصبح", "١٢–٤ الظهر والعصر", "٤–٨ المغرب", "٨–١٢ الليل"];
const GOALS = {
  "جذب": ["يوصل لناس جدد ما يعرفونك", "Reaches new people who don't know you yet"],
  "إقناع": ["يبني ثقة ويخلي المتابع يحس إنه يحتاجك", "Builds trust so followers feel they need you"],
  "بيع": ["دعوة مباشرة للتسجيل", "A direct call to sign up"],
};
// اسم النوع بالجمع داخل الجملة الإنجليزية
const KIND_EN = { REELS: "Reels", CAROUSEL_ALBUM: "Carousels", IMAGE: "Photos", VIDEO: "Videos" };
const kindPl = (k) => KIND_EN[k.kind] || lbl(k.name);
const posts_ = (k) => `${n(k)} ${k === 1 ? "post" : "posts"}`;

const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const pct = (x) => `${(x * 100).toFixed(1)}${L("٪", "%")}`;
const n = (x) => Math.round(x).toLocaleString("en-US");
const firstLine = (c) => (c || "").split("\n")[0].trim().slice(0, 70);
const addDays = (d, k) => new Date(Date.parse(d + "T00:00:00Z") + k * 864e5).toISOString().slice(0, 10);
const local = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), hour: +p.hour };
};

// أفضل فترة نشر (بنفس قاعدة النصائح) والساعة المقترحة فيها
const slotEr = (list) => {
  const g = {};
  for (const p of list) (g[Math.floor(p.hour / 4)] ||= []).push(p.er);
  return Object.entries(g).map(([s, v]) => ({ s: +s, n: v.length, er: avg(v) }));
};
const hourIn = (slot, online) => {
  // قبل ذروة تواجد متابعينك داخل الفترة بساعة، عشان البوست يكون جاهز لما يفتحون
  if (!online) return slot * 4 + 2;
  const hrs = [0, 1, 2, 3].map((i) => slot * 4 + i);
  const peak = hrs.reduce((a, b) => (online[b] > online[a] ? b : a));
  return Math.max(slot * 4, peak - 1);
};
export function bestTime(rep) {
  const posts = rep.posts.filter((p) => p.er != null).map((p) => ({ ...p, ...local(p.timestamp) }));
  const slot = slotEr(posts).filter((x) => x.n >= 3).sort((a, b) => b.er - a.er)[0];
  return slot ? { ...slot, name: SLOTS[slot.s], hour: hourIn(slot.s, rep.account.online_followers) } : null;
}

export function plan(accountId) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const rep = report(accountId, addDays(today, -89), today);
  const posts = rep.posts.filter((p) => p.er != null).map((p) => ({ ...p, ...local(p.timestamp) }));
  if (posts.length < 6) return { ready: false, posts: posts.length };

  // كم بوست بالأسبوع: معدلك الحالي، بحد أدنى ٣ وأعلى ٧
  const perWeek = Math.min(7, Math.max(3, Math.round((posts.length / 90) * 7)));

  // الأنواع: اللي يوصل، واللي يقنع، واللي يبيع (من التسجيلات إذا فيه كفاية)
  const kinds = rep.by_type.filter((t) => t.count >= 3);
  const byReach = [...kinds].sort((a, b) => (b.avg_reach || 0) - (a.avg_reach || 0))[0];
  // الإقناع بالحفظ والمشاركة (avg_fair): زيارات البروفايل والمتابعة ما تجي للريلز فتظلمها
  const byIntent = [...kinds].sort((a, b) => (b.avg_fair || 0) - (a.avg_fair || 0))[0];
  const salesTypes = rep.sales.by_type.filter((t) => t.posts >= 2 && t.attributed > 0);
  const salesReady = rep.sales.kpis.count >= 5 && salesTypes.length;
  const bySales = salesReady ? salesTypes[0] : null;
  const kindFor = { "جذب": byReach, "إقناع": byIntent, "بيع": bySales ? kinds.find((k) => k.kind === bySales.kind) || byIntent : byIntent };

  // أفضل الأيام: متوسط الحفظ والمشاركة لكل يوم (يوم فيه بوستين على الأقل). بالحفظ والمشاركة عشان يوم كله ريلز ما يطلع أضعف
  const globalIntent = avg(posts.map((p) => p.fair ?? 0));
  const dayScore = DAYS.map((_, d) => {
    const v = posts.filter((p) => p.day === d).map((p) => p.fair ?? 0);
    return { d, n: v.length, score: v.length >= 2 ? avg(v) : globalIntent * 0.95 };
  });

  // أفضل فترة عامة، وكل يوم ممكن يكون له فترة أقوى
  const globalSlot = bestTime(rep);
  const online = rep.account.online_followers;

  // الأيام السبعة الجاية (من بكرة)، ونختار أعلاها مع تجنب يومين ورا بعض إذا العدد قليل
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i + 1);
    return { date, ...dayScore[new Date(date + "T00:00:00Z").getUTCDay()] };
  });
  const chosen = [];
  for (const c of [...upcoming].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= perWeek) break;
    const adjacent = chosen.some((x) => Math.abs(Date.parse(x.date) - Date.parse(c.date)) === 864e5);
    if (perWeek <= 4 && adjacent) continue;
    chosen.push(c);
  }
  for (const c of [...upcoming].sort((a, b) => b.score - a.score)) if (chosen.length < perWeek && !chosen.includes(c)) chosen.push(c);

  // الأهداف: ثلث بيع على أقوى الأيام، والباقي بالتناوب جذب وإقناع
  const sells = Math.max(1, Math.round(perWeek / 3));
  const ranked = [...chosen].sort((a, b) => b.score - a.score);
  ranked.forEach((c, i) => (c.goal = i < sells ? "بيع" : null));
  let flip = true;
  for (const c of [...chosen].sort((a, b) => a.date.localeCompare(b.date))) if (!c.goal) { c.goal = flip ? "جذب" : "إقناع"; flip = !flip; }

  // أفكار من بوستاتك: الأعلى وصول للجذب، والأعلى اهتمام للإقناع، واللي باع للبيع
  const uniq = (list) => { const seen = new Set(); return list.filter((p) => firstLine(p.caption) && !seen.has(firstLine(p.caption)) && seen.add(firstLine(p.caption))); };
  const pools = {
    "جذب": uniq([...posts].sort((a, b) => (b.reach || 0) - (a.reach || 0))),
    "إقناع": uniq([...posts].sort((a, b) => (b.fair || 0) - (a.fair || 0))),
    "بيع": uniq(rep.sales.top_posts),
  };
  // موضوع لكل هدف من «المواضيع»: الجذب لأعلى وصول، والإقناع لأقوى موضوع من مجالك، والبيع للي يجيب عملاء
  const tp = rep.topics?.ready ? rep.topics : null;
  const nicheBy = (k) => tp?.topics.filter((t) => t.niche && t.n >= 3 && t[k] != null).sort((a, b) => b[k] - a[k]).map((t) => t.name) || [];
  const topicLists = {
    "جذب": [tp?.best.reach, ...nicheBy("reach_lift")].filter(Boolean),
    "إقناع": nicheBy("intent_lift").filter((x) => x !== OFFER_TOPIC),
    "بيع": [tp?.best.sell, OFFER_TOPIC].filter(Boolean),
  };
  const turn = { "جذب": 0, "إقناع": 0, "بيع": 0 };
  const nextTopic = (goal) => { const l = [...new Set(topicLists[goal])]; return l.length ? l[turn[goal]++ % l.length] : null; };

  const used = new Set();
  const nextIdea = (goal, topic) => {
    const free = pools[goal].filter((x) => !used.has(firstLine(x.caption)));
    const p = (topic && free.find((x) => topicOf(x.caption) === topic)) || free[0];
    if (p) used.add(firstLine(p.caption));
    return p;
  };

  const days = upcoming.map((u) => {
    const c = chosen.find((x) => x.date === u.date);
    const base = { date: u.date, day: DAYS[new Date(u.date + "T00:00:00Z").getUTCDay()] };
    if (!c) return { ...base, rest: true };

    // نفس أفضل فترة اللي في النصائح، إلا إذا هاليوم له فترة أقوى منها بعينة كافية (٥ بوستات أو أكثر)
    const ownSlot = slotEr(posts.filter((p) => p.day === c.d)).filter((x) => x.n >= 5).sort((a, b) => b.er - a.er)[0];
    const daySlot = ownSlot && (!globalSlot || ownSlot.er > globalSlot.er) ? ownSlot : null;
    const slot = daySlot || globalSlot;
    const hour = slot ? hourIn(slot.s, online) : 20;
    const kind = kindFor[c.goal] || byIntent || kinds[0];
    const topic = nextTopic(c.goal);
    const idea = nextIdea(c.goal, topic);

    let hook, source;
    if (c.goal === "بيع") {
      hook = idea ? L(`نفس فكرة «${firstLine(idea.caption)}» وفي آخرها دعوة للتسجيل`, `Same idea as “${firstLine(idea.caption)}”, ending with a call to sign up`)
        : L(`عرض ${T(P.offer)}: وش ياخذ، ولمين، ومتى`, `Pitch ${T(P.offer)}: what they get, who it's for, and when`);
      source = idea ? L("هذا البوست جاب تسجيلات قبل", "This post brought in sign-ups before") : null;
    } else if (idea) {
      hook = c.goal === "جذب" ? L(`نسخة جديدة من «${firstLine(idea.caption)}»`, `A fresh take on “${firstLine(idea.caption)}”`) : L(`جزء ثاني من «${firstLine(idea.caption)}»`, `Part two of “${firstLine(idea.caption)}”`);
      source = c.goal === "جذب" ? L(`وصل لـ ${n(idea.reach || 0)}`, `Reached ${n(idea.reach || 0)}`) : L(`حفظ ومشاركة ${pct(idea.fair || 0)}`, `${pct(idea.fair || 0)} saves & shares`);
    } else hook = c.goal === "جذب" ? L(`معلومة سريعة تفيد أي أحد مهتم بـ${T(P.niche)}`, `A quick tip for anyone into ${T(P.niche)}`) : L("خطوات عملية من تجربتك مع عملائك", "Practical steps from your work with clients");

    const why = [];
    const cnt = c.n === 2 ? "بوستين" : c.n >= 3 && c.n <= 10 ? `${c.n} بوستات` : `${c.n} بوست`;
    if (c.n >= 2) why.push(L(`${base.day} ${c.score > globalIntent ? "من أفضل أيامك" : "يوم مناسب لك"} (حفظ ومشاركة ${pct(c.score)} من ${cnt})`,
      `${lbl(base.day)} ${c.score > globalIntent ? "is one of your best days" : "works well for you"} (${pct(c.score)} saves & shares across ${posts_(c.n)})`));
    if (slot) why.push(L(`فترة ${SLOTS[slot.s]} تفاعلها ${pct(slot.er)}${daySlot ? " في هاليوم" : ""} (من ${slot.n === 2 ? "بوستين" : slot.n >= 3 && slot.n <= 10 ? `${slot.n} بوستات` : `${slot.n} بوست`})`,
      `The ${lbl(SLOTS[slot.s])} slot gets ${pct(slot.er)} engagement${daySlot ? " on this day" : ""} (across ${posts_(slot.n)})`));
    if (kind) why.push(c.goal === "جذب" ? L(`${kind.name} أعلى وصول عندك (${n(kind.avg_reach)})`, `${kindPl(kind)} get your highest reach (${n(kind.avg_reach)})`)
      : c.goal === "بيع" && bySales ? L(`${bySales.name} يجيب أكثر تسجيلات للبوست`, `${kindPl(bySales)} bring in the most sign-ups per post`)
      : L(`${kind.name} أكثر نوع ينحفظ وينشارك عندك (${pct(kind.avg_fair)})`, `${kindPl(kind)} get saved and shared the most (${pct(kind.avg_fair)})`));

    const ts = tp?.topics.find((t) => t.name === topic);
    if (ts?.enough) {
      const k = c.goal === "جذب" ? "reach_lift" : "intent_lift";
      if (c.goal === "بيع" && ts.leads) why.push(L(`مواضيع «${topic}» جابت ${ts.leads} سؤال عن السعر والتسجيل`, `${lbl(topic)} posts brought in ${ts.leads} ${ts.leads === 1 ? "question" : "questions"} about price and sign-up`));
      else if (ts[k] > 0.05) why.push(L(`مواضيع «${topic}» ${c.goal === "جذب" ? "وصولها" : "اهتمامها"} أعلى من عادتك بـ ${Math.round(ts[k] * 100)}٪`,
        `${lbl(topic)} posts get ${Math.round(ts[k] * 100)}% more ${c.goal === "جذب" ? "reach" : "intent"} than usual`));
    }

    // هاشتاقات من اللي أثبتت نفسها عندك: للجذب حسب الوصول، وللإقناع والبيع حسب الاهتمام
    const key = c.goal === "جذب" ? "reach_lift" : "intent_lift";
    // هاشتاقات المواضيع (مثل #كوميديا) تناسب بوستات الجذب بس، والإقناع والبيع ياخذ العامة وهاشتاقات مجالك
    const tags = rep.hashtags?.ready ? rep.hashtags.tags.filter((t) => t[key] != null && t[key] > 0 && t.reach_lift > -0.1 && (c.goal === "جذب" || t.category === "عام" || t.category === "مجالك"))
      .sort((a, b) => b[key] - a[key]).slice(0, 5).map((t) => t.tag) : [];

    return {
      ...base, goal: c.goal, hashtags: tags, goal_note: GOALS[c.goal] && L(...GOALS[c.goal]), time: `${String(hour).padStart(2, "0")}:00`,
      kind: kind?.kind, kind_name: kind?.name, topic, hook, idea_link: idea?.permalink || null, idea_note: source,
      cta: c.goal === "بيع" ? L(`اختم بـ: اكتب «${P.cta_word}» بالتعليقات وأرسل لك تفاصيل ${T(P.offer)}`, `End with: “Comment «${P.cta_word}» and I'll send you the details about ${T(P.offer)}”`) : null,
      why: why.join(L("، ", ". ")) + ".",
    };
  });

  // أفكارك من «بنك الأفكار»: أول شي كل فكرة لليوم اللي نفس موضوعها، والباقي للأيام اللي ما عندها (مو أيام البيع)
  const bank = listIdeas(accountId).open.slice().reverse();
  const give = (d, i) => { const x = bank.splice(i, 1)[0]; d.bank_idea = { id: x.id, text: x.text.split("\n")[0].slice(0, 120) }; };
  for (const d of days) { if (d.rest) continue; const i = bank.findIndex((x) => x.topic === d.topic); if (i >= 0) give(d, i); }
  for (const d of days) if (!d.rest && !d.bank_idea && d.goal !== "بيع" && bank.length) give(d, 0);

  // أيام الريلز: الطول والبداية اللي تخلي الناس يكملون (من «مدة المشاهدة»)
  const w = rep.watch?.ready ? rep.watch : null;
  if (w) {
    const len = w.lengths.filter((x) => x.enough).sort((a, b) => b.reach_lift - a.reach_lift)[0];
    const hook = w.hooks.filter((x) => x.enough && x.name !== "بدون جملة" && x.name !== "جملة مباشرة").sort((a, b) => b.lift - a.lift)[0];
    const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
    const bits = [len && len.reach_lift > 0.05 ? L(`خله ${len.name}`, `keep it ${low(lbl(len.name))}`) : null,
      hook && hook.lift > 0.05 ? L(`وابدأ ${{ "سؤال": "بسؤال", "رقم": "برقم", "قصة": "بقصة", "نكتة": "بنكتة" }[hook.name] || "بـ" + hook.name}`,
        `open with ${{ "سؤال": "a question", "رقم": "a number", "قصة": "a personal story", "نكتة": "a joke" }[hook.name] || low(lbl(hook.name))}`) : null].filter(Boolean);
    const tip = bits.join(L("، ", ", "));
    if (bits.length) for (const d of days) if (!d.rest && d.kind === "REELS") d.reel_tip = L(tip, tip.charAt(0).toUpperCase() + tip.slice(1));
  }

  return {
    ready: true, timezone: TZ, per_week: perWeek, days,
    basis: { posts: posts.length, sales: rep.sales.kpis.count, sales_used: !!bySales },
  };
}
