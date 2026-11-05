// ملف مجالك: كلمات المواضيع، اسم اللي تبيعه، الردود والرسائل الجاهزة، وقوالب الكاروسيل والستوري والريل
// الأداة تقرا data/profile.json (حقك، ما يتغير مع التحديثات). أي شي ما كتبته فيه ياخذه من profiles/general.json
// وتقدر تبدأ من ملف جاهز بـ "extends": "voice-over" (اسم ملف من مجلد profiles)
import { readFileSync, existsSync } from "node:fs";
import { L, LABELS } from "./i18n.js";

const load = (f) => JSON.parse(readFileSync(f, "utf8"));
const OWN = "data/profile.json";
const merge = (a, b) => ({ ...a, ...b, templates: { ...a.templates, ...b.templates }, info: { ...a.info, ...b.info }, dm: { ...a.dm, ...b.dm } });

function loadProfile() {
  let p = load("profiles/general.json");
  let own = {};
  try { if (existsSync(OWN)) own = load(OWN); } catch (e) { console.error("data/profile.json فيه خطأ، نستخدم الملف العام:", e.message); }
  if (own.extends && existsSync(`profiles/${own.extends}.json`)) p = merge(p, load(`profiles/${own.extends}.json`));
  return merge(p, own);
}
export const P = loadProfile();

// [عربي، إنجليزي] حسب لغة الطلب
export const T = (pair) => (Array.isArray(pair) ? L(pair[0], pair[1] ?? pair[0]) : pair);
// قائمة كلمات ← تعبير. القائمة الفاضية = null (يعني «أي شي» عند الشروط)
export const rx = (list, flags = "") => (list?.length ? new RegExp(list.join("|"), flags) : null);

export const NICHE = rx(P.niche_words);
export const nicheTest = (t) => !NICHE || NICHE.test(t);
export const OFFER_TOPIC = P.topics.find((t) => t.offer)?.name || null;
export const fill = (s) => (s || "").replaceAll("{العرض}", T(P.offer)).replaceAll("{كلمة}", P.cta_word).replaceAll("{إيموجي}", P.emoji || "").replaceAll("{مجالك}", T(P.niche));

// أسماء المواضيع بالإنجليزي للوحة
for (const t of P.topics) if (t.en) LABELS[t.name] = t.en;
