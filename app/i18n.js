// اللغة: كل طلب من اللوحة يحمل كوكي ia_lang (ar أو en)، والخادم يشغّله داخل langStore
// فالنصائح والخطة والتقارير تكتب بلغة اللوحة. التنبيهات وتيليجرام تشتغل برا الطلبات فتظل عربي
import { AsyncLocalStorage } from "node:async_hooks";

export const langStore = new AsyncLocalStorage();
export const isEn = () => langStore.getStore() === "en";
// L("نص عربي", "English text"): يرجع النص حسب لغة الطلب
export const L = (ar, en) => (isEn() ? en : ar);

// أسماء ثابتة تطلع داخل الجمل وفي اللوحة (أنواع البوستات، الأهداف، الفترات، الأيام…)
// lbl(x) يترجمها بالإنجليزي، واللوحة تحمّلها من /i18n-labels.js وتترجم فيها النصوص المطابقة
export const LABELS = {
  "ريلز": "Reels",
  "صورة": "Photo",
  "كاروسيل": "Carousel",
  "جذب": "Reach",
  "إقناع": "Trust",
  "بيع": "Sell",
  "١٢–٤ بعد نص الليل": "12–4 am",
  "٤–٨ الفجر": "4–8 am",
  "٨–١٢ الصبح": "8 am–12 pm",
  "١٢–٤ الظهر والعصر": "12–4 pm",
  "٤–٨ المغرب": "4–8 pm",
  "٨–١٢ الليل": "8 pm–12 am",
  "الأحد": "Sunday",
  "الإثنين": "Monday",
  "الثلاثاء": "Tuesday",
  "الأربعاء": "Wednesday",
  "الخميس": "Thursday",
  "الجمعة": "Friday",
  "السبت": "Saturday",
  "فيديو": "Video",
  // نية التعليق ومراحل العميل
  "سعر": "Price",
  "تسجيل": "Sign-up",
  "سؤال": "Question",
  "جديد": "New",
  "رديت": "Replied",
  "يحتاج متابعة": "Needs follow-up",
  "سجّل": "Signed up",
  "ما سجّل": "Didn't sign up",
  // المواضيع: أسماءها بالإنجليزي تجي من ملف مجالك (profile.js)
  "أخرى": "Other",
  "عن مجالك": "Niche content",
  "محتوى عام": "General content",
  // فئات الهاشتاقات وعددها
  "عام": "General",
  "مجالك": "Your niche",
  "اسمك": "Your name",
  "بدون": "None",
  "١–٣": "1–3",
  "٤–٦": "4–6",
  "٧–١٠": "7–10",
  "أكثر من ١٠": "More than 10",
  // بداية الريل وطوله
  "بدون جملة": "No opening line",
  "رقم": "Number",
  "قصة": "Personal story",
  "نكتة": "Joke",
  "جملة مباشرة": "Direct statement",
  "أقل من ١٥ ثانية": "Under 15 sec",
  "١٥–٣٠ ثانية": "15–30 sec",
  "٣٠–٦٠ ثانية": "30–60 sec",
  "أكثر من دقيقة": "Over 1 min",
  // إعادة التدوير: ليش البوست قوي
  "وصول": "Reach",
  "اهتمام": "Intent",
  // الأهداف
  "متابعين جدد": "New followers",
  "تسجيلات": "Sign-ups",
  "الإيراد": "Revenue",
  // مصدر التسجيل (السيرفر يرجّعها لأصلها العربي بـ unlbl قبل الحفظ)
  "بوست أو ريل": "Post or Reel",
  "ستوري": "Story",
  "تعليق": "Comment",
  "الخاص": "DMs",
  "واتساب": "WhatsApp",
  "رابط البايو": "Bio link",
  "إحالة أو معرفة": "Referral or word of mouth",
  "إعلان ممول": "Paid ad",
  "غير معروف": "Unknown",
  // التجارب
  "بدون هاشتاق": "Drop a hashtag",
  "هاشتاق جديد": "New hashtag",
  "ريلز أقصر": "Shorter Reels",
  "ابدأ بسؤال": "Open with a question",
  "وقت نشر": "Posting time",
  "تغيير عام": "General change",
  "أول سطر سؤال": "First line is a question",
  "✅ نفعت": "✅ Worked",
  "❌ ما نفعت": "❌ Didn't work",
  "➖ ما فرقت": "➖ No difference",
  "⏳ ما فيه بوستات كفاية": "⏳ Not enough posts",
};
// قيم ثابتة توصل من اللوحة بالإنجليزي (مثل <option> بدون value) نرجّعها لأصلها العربي
export const unlbl = (x) => (x != null ? Object.keys(LABELS).find((k) => LABELS[k] === x) ?? x : x);
export const lbl = (x) => (isEn() && x != null ? LABELS[x] ?? x : x);

export const langOf = (req) => (/(?:^|;\s*)ia_lang=en(?:;|$)/.test(req.headers.cookie || "") ? "en" : "ar");
