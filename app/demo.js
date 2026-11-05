// بيانات تجريبية لحساب تدريب تعليق صوتي — عشان تجرب اللوحة قبل ربط حسابك
import { db, upsert } from "./db.js";
import "./audience.js"; // ينشئ جدول الجمهور
import "./tagged.js"; // ينشئ جدول الوسوم
import "./competitors.js"; // ينشئ جداول المنافسين
import { classify } from "./intent.js";

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const CAPTIONS = {
  REELS: [
    "٣ أخطاء تخلي صوتك يطلع مبتدئ في التعليق الصوتي 🎙️ رقم ٢ يسويه الكل!\nسجّل في الدورة من الرابط بالبايو",
    "قبل وبعد: نفس النص بصوت متدرب في أول يوم وبعد ٤ أسابيع 👂",
    "كيف تسجل بودكاست بجوالك بجودة استوديو؟ جرب هالترتيب",
    "تمرين ٣٠ ثانية يصحّي صوتك قبل التسجيل",
    "ليش صوتك في التسجيل غير عن صوتك الحقيقي؟",
    "يوم في استوديو البودكاست معنا 🎧",
    "جربنا ٣ مايكات بأسعار مختلفة… الفرق صدمنا",
  ],
  CAROUSEL_ALBUM: [
    "دليل كامل: معدات البودكاست للمبتدئ بميزانية ١٠٠٠ ريال 💾 احفظه",
    "٥ خطوات تبدأ فيها مسيرتك في التعليق الصوتي — ومن وين تجيب أول عميل",
    "الفرق بين التعليق الإعلاني والوثائقي والكرتوني (مع أمثلة)",
    "أسعار التعليق الصوتي في السوق الخليجي ٢٠٢٦",
  ],
  IMAGE: [
    "التسجيل للدفعة الجديدة مفتوح ✨",
    "رأي متدربتنا بعد الدورة 🤍",
    "اقتباس اليوم: الصوت الواثق يبيع",
    "خصم ٢٠٪ لأول ١٠ مسجلين",
  ],
};

const USERS = ["sara.voice", "abdullah_", "noura.k", "fahad.media", "reem_", "majed.pod", "lulwa", "khalid.vo"];
const COMMENTS = [
  "ما شاء الله 🔥", "صوتك جميل 👏", "❤️❤️", "فاده جداً شكراً", "رائع",
  "بكم الدورة؟", "كم سعر الاشتراك", "ابي اسجل كيف؟", "متى الدورة الجاية", "هل فيه دورة أونلاين؟", "راسلتك خاص",
  "وش المايك اللي تستخدمه؟", "كيف أعرف إن صوتي يصلح للتعليق؟", "ليش صوتي يطلع مكتوم بالتسجيل؟",
];

export function loadDemo() {
  db.prepare("DELETE FROM media WHERE account_id = 'demo'").run();
  db.prepare("DELETE FROM daily WHERE account_id = 'demo'").run();
  db.prepare("DELETE FROM stories WHERE account_id = 'demo'").run();
  db.prepare("DELETE FROM comments WHERE account_id = 'demo'").run();
  db.prepare("DELETE FROM sales WHERE account_id = 'demo'").run();
  // مين جمهورك: متابعين (٣٦٧٥) ومتفاعلين هالشهر، فيها دولة ما تتفاعل ودولة تتفاعل أكثر من حجمها
  db.prepare("DELETE FROM audience WHERE account_id = 'demo'").run();
  db.prepare("DELETE FROM tagged WHERE account_id = 'demo'").run();
  for (const [i, [user, cap, days]] of [["noura.voice", "أول تعليق صوتي لي بعد الدورة 🎙️ شكراً على كل شي", 2], ["studio.sada", "من كواليس تسجيل الإعلان الجديد", 9], ["fahad.records", "شكراً على الورشة الرائعة", 23]].entries()) {
    db.prepare("INSERT INTO tagged (id, account_id, username, timestamp, permalink, caption, media_type) VALUES (?, 'demo', ?, ?, 'https://www.instagram.com/', ?, 'VIDEO')")
      .run(`demo_tag_${i}`, user, new Date(Date.now() - days * 864e5).toISOString().slice(0, 19) + "+0000", cap);
  }
  // منافسين وهميين: واحد ينشر كثير بتفاعل قريب، وواحد أقل نشر وكاروسيلاته قوية. ٣٥ يوم لقطات عشان يبين النمو
  for (const t of ["competitors", "competitor_daily", "competitor_media"]) db.prepare(`DELETE FROM ${t} WHERE account_id = 'demo'`).run();
  const cday = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TIMEZONE || "Asia/Riyadh" }).format(new Date(Date.now() - n * 864e5));
  for (const [i, [user, name, start, perDay, everyDays, base, strong]] of [
    ["sada.studio.demo", "استوديو صدى (تجريبي)", 11800, 14, 1.6, 0.021, "REELS"],
    ["podcast.lab.demo", "مختبر البودكاست (تجريبي)", 6400, 4, 3.5, 0.028, "CAROUSEL_ALBUM"],
  ].entries()) {
    db.prepare("INSERT INTO competitors (account_id, username, name, added_at) VALUES ('demo', ?, ?, ?)").run(user, name, i);
    for (let d = 35; d >= 0; d--) db.prepare("INSERT INTO competitor_daily (account_id, username, date, followers, media_count) VALUES ('demo', ?, ?, ?, ?)")
      .run(user, cday(d), Math.round(start + (35 - d) * perDay + (rand() - 0.5) * 20), 300 + Math.floor((35 - d) / everyDays));
    const followers = Math.round(start + 35 * perDay);
    for (let k = 0, t = 1.2; t < 60; k++, t += everyDays * (0.6 + rand() * 0.8)) {
      const type = k % 3 === 0 ? "CAROUSEL_ALBUM" : k % 5 === 0 ? "IMAGE" : "REELS";
      const boost = (type === strong ? 1.6 : 0.85) * (k === 4 ? 4.2 : k === 11 ? 2.6 : 0.7 + rand() * 0.6);
      const likes = Math.round(followers * base * boost), comments = Math.round(likes * (0.03 + rand() * 0.04));
      db.prepare(`INSERT INTO competitor_media (id, account_id, username, timestamp, media_type, product_type, caption, likes, comments, permalink, alerted)
        VALUES (?, 'demo', ?, ?, ?, ?, ?, ?, ?, 'https://www.instagram.com/', 1)`)
        .run(`demo_comp_${i}_${k}`, user, new Date(Date.now() - t * 864e5).toISOString().slice(0, 19) + "+0000", type === "REELS" ? "VIDEO" : type, type === "REELS" ? "REELS" : "FEED",
          pick(CAPTIONS[type]), likes, comments);
    }
  }
  const aud = db.prepare("INSERT INTO audience (account_id, date, kind, dim, key, value) VALUES ('demo', ?, ?, ?, ?, ?)");
  const audDay = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TIMEZONE || "Asia/Riyadh" }).format(new Date());
  for (const [kind, dim, rows] of [
    ["followers", "age", { "13-17": 40, "18-24": 1020, "25-34": 1450, "35-44": 690, "45-54": 330, "55-64": 110, "65+": 35 }],
    ["followers", "gender", { M: 1480, F: 1610, U: 585 }],
    ["followers", "country", { SA: 2240, KW: 330, AE: 240, BH: 150, IN: 210, EG: 120, QA: 110, OM: 90, US: 50, JO: 45, IQ: 40, MA: 50 }],
    ["followers", "city", { "Riyadh, Riyadh Region": 820, "Jeddah, Makkah Region": 530, "Dammam, Eastern Province": 290, "Kuwait City, Al Asimah Governorate": 210, "Dubai, Dubai": 150, "Mecca, Makkah Region": 120, "Doha, Doha": 80 }],
    ["engaged", "age", { "13-17": 6, "18-24": 210, "25-34": 260, "35-44": 90, "45-54": 34, "55-64": 9, "65+": 2 }],
    ["engaged", "gender", { M: 210, F: 340, U: 61 }],
    ["engaged", "country", { SA: 360, KW: 120, AE: 45, BH: 22, IN: 1, EG: 6, QA: 20, OM: 15, US: 4, JO: 6, IQ: 5, MA: 3 }],
  ]) for (const [key, value] of Object.entries(rows)) aud.run(audDay, kind, dim, key, value);

  upsert("accounts", {
    id: "demo", username: "voice.academy.demo", name: "أكاديمية الصوت (تجريبي)", picture: null,
    token: null, token_expires: null, is_demo: 1, followers: 0,
    business: "تدريب على التعليق الصوتي وصناعة البودكاست — دورات أونلاين وحضوري. الجمهور: شباب وبنات في السعودية والخليج ٢٠-٣٥ مهتمين بالصوت والإعلام والعمل الحر",
    goal: "بيع الدورات والخدمات (تسجيل في الدورة عبر الرابط أو الواتساب)",
    online_followers: JSON.stringify([60, 30, 15, 10, 8, 12, 40, 90, 140, 170, 180, 190, 210, 230, 240, 260, 290, 330, 380, 450, 520, 560, 480, 260]),
    last_sync: Math.floor(Date.now() / 1000),
  }, ["id"]);

  const days = 120;
  let followers = 3100;
  const today = new Date();
  for (let d = days; d >= 0; d--) {
    const date = new Date(today - d * 864e5);
    const iso = date.toISOString().slice(0, 10);

    // بوست تقريباً كل يومين، والريلز أكثر في الشهر الأخير
    let reach = 400 + Math.floor(rand() * 300);
    if (rand() < 0.5) {
      const recent = d < 30;
      const kind = rand() < (recent ? 0.6 : 0.35) ? "REELS" : rand() < 0.5 ? "CAROUSEL_ALBUM" : "IMAGE";
      const caption = pick(CAPTIONS[kind]);
      const hour = pick([9, 13, 17, 20, 21, 22, 23]);
      date.setUTCHours(hour - 3, Math.floor(rand() * 60));
      const evening = hour >= 20 && hour <= 22;
      const cta = /رابط|سجّل|التسجيل|خصم/.test(caption);

      const base = { REELS: 2600, CAROUSEL_ALBUM: 1300, IMAGE: 700 }[kind];
      const r = Math.round(base * (0.5 + rand()) * (evening ? 1.4 : 1) * (1 + (days - d) / 300));
      const likes = Math.round(r * (0.04 + rand() * 0.03));
      const comments = Math.round(likes * (0.05 + rand() * 0.1));
      const saved = Math.round(r * (kind === "CAROUSEL_ALBUM" ? 0.035 : 0.008) * (0.6 + rand()));
      const shares = Math.round(r * (kind === "REELS" ? 0.012 : 0.004) * (0.6 + rand()));
      const profile_visits = Math.round(r * (cta ? 0.03 : 0.012) * (0.6 + rand()));
      const follows = Math.round(profile_visits * (0.1 + rand() * 0.15));
      reach += r;
      followers += follows;

      upsert("media", {
        id: `demo_${iso}`, account_id: "demo", caption, media_type: kind === "REELS" ? "VIDEO" : kind,
        product_type: kind === "REELS" ? "REELS" : "FEED", media_url: null, thumbnail_url: null,
        permalink: "https://instagram.com", timestamp: date.toISOString().replace("Z", "+0000"),
        likes, comments, views: Math.round(r * (kind === "REELS" ? 1.8 : 1.3)), reach, saved, shares,
        total_interactions: likes + comments + saved + shares, profile_visits, follows,
        avg_watch_time: kind === "REELS" ? Math.round((4 + rand() * 9) * 10) / 10 : null,
        synced_at: Math.floor(Date.now() / 1000),
      }, ["id"]);

      // عينة من التعليقات: مدح، أسئلة، وناس تسأل عن السعر والتسجيل (الأقدم غالباً تم الرد عليها)
      for (let c = 0; c < Math.min(comments, 6); c++) {
        const text = pick(COMMENTS);
        const t = new Date(date.getTime() + (1 + rand() * 30) * 3600e3);
        upsert("comments", {
          id: `demo_c_${iso}_${c}`, account_id: "demo", media_id: `demo_${iso}`, username: pick(USERS) + Math.floor(rand() * 90 + 10),
          text, timestamp: t.toISOString().replace("Z", "+0000"), intent: classify(text), replied: rand() < (d > 5 ? 0.75 : 0.3) ? 1 : 0, handled: 0,
        }, ["id"]);
      }
    }
    followers += Math.floor(rand() * 6) - 2;
    const nf = Math.floor(rand() * 15);
    upsert("daily", {
      account_id: "demo", date: iso, followers, new_followers: nf,
      // تابعوك وألغوا: Meta تعطيها لآخر ٣٠ يوم بس
      follows: d <= 30 ? nf : null, unfollows: d <= 30 ? Math.floor(rand() * 4) + (d === 12 ? 14 : 0) : null,
      reach, views: Math.round(reach * 1.6), profile_views: Math.round(reach * 0.02), link_taps: Math.round(reach * 0.003), link_ok: 1,
    }, ["account_id", "date"]);

    // ستوري آخر ٦٠ يوم: سلسلة ٢–٦ باليوم، والوصول ينزل مع كل ستوري، وستوري الرابط بس بعض الأيام
    if (d <= 60 && rand() < 0.7) {
      const n = 2 + Math.floor(rand() * 5);
      let r = Math.round(followers * (0.08 + rand() * 0.04));
      for (let i = 0; i < n; i++) {
        const t = new Date(date);
        t.setUTCHours(13 + i, Math.floor(rand() * 60)); // ٤ العصر وطالع بتوقيت الرياض
        upsert("stories", {
          id: `demo_s_${d}_${i}`, account_id: "demo", media_type: rand() < 0.4 ? "VIDEO" : "IMAGE", caption: "",
          permalink: null, timestamp: t.toISOString(), image: null,
          views: Math.round(r * 1.2), reach: r, replies: Math.round(r * rand() * 0.01), shares: Math.round(r * rand() * 0.004),
          follows: Math.round(r * rand() * 0.003), profile_visits: Math.round(r * (0.01 + rand() * 0.02)),
          link_clicks: null, total_interactions: null, // نقرات ملصق الرابط ما يعطيها Instagram API
          taps_forward: Math.round(r * 0.5), taps_back: Math.round(r * 0.03), exits: Math.round(r * (0.06 + rand() * 0.1)), swipes: Math.round(r * 0.05),
          synced_at: Math.floor(Date.now() / 1000),
        }, ["id"]);
        r = Math.round(r * (0.7 + rand() * 0.15));
      }
    }
  }
  db.prepare("UPDATE accounts SET followers = ? WHERE id = 'demo'").run(followers);

  // تسجيلات: الكاروسيل والبوستات اللي فيها دعوة تسجيل تبيع أكثر من الريلز حتى لو وصولها أقل
  const addSale = db.prepare("INSERT INTO sales (account_id, date, count, amount, source, media_id, note, created_at) VALUES ('demo', ?, ?, ?, ?, ?, ?, ?)");
  for (const p of db.prepare("SELECT id, caption, product_type, media_type, timestamp FROM media WHERE account_id = 'demo'").all()) {
    const cta = /رابط|سجّل|التسجيل|خصم/.test(p.caption);
    const chance = (p.product_type === "REELS" ? 0.25 : p.media_type === "CAROUSEL_ALBUM" ? 0.55 : 0.4) + (cta ? 0.3 : 0);
    if (rand() > chance) continue;
    const n = 1 + Math.floor(rand() * (cta ? 3 : 2));
    const day = new Date(Date.parse(p.timestamp.replace("+0000", "Z")) + Math.floor(rand() * 3) * 864e5).toISOString().slice(0, 10);
    if (day > today.toISOString().slice(0, 10)) continue;
    const known = rand() < 0.4;
    const source = known ? "بوست أو ريل" : pick(["الخاص", "واتساب", "ستوري", "رابط البايو", "تعليق", "غير معروف"]);
    const price = /خصم/.test(p.caption) ? 360 : 450;
    addSale.run(day, n, n * price, source, known ? p.id : null, /خصم/.test(p.caption) ? "خصم ٢٠٪" : "", Math.floor(Date.now() / 1000));
  }
  for (let d = 0; d < 120; d += 9 + Math.floor(rand() * 6)) {
    addSale.run(new Date(today - d * 864e5).toISOString().slice(0, 10), 1, 450, pick(["إحالة أو معرفة", "إعلان ممول"]), null, "", Math.floor(Date.now() / 1000));
  }
}
