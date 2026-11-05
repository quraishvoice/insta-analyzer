// مدة المشاهدة في الريلز: كم ثانية يتفرجون، وكم بالمية من الريل (طول الريل نقراه من ملف الفيديو نفسه)
// وأي طول وأي بداية وأي موضوع يخلي الناس يكملون، وهل اللي يكملونه يوصل أكثر
import { execFile } from "node:child_process";
import { db } from "./db.js";
import { ig, refreshTokenIfNeeded } from "./instagram.js";
import { scoredPosts, median } from "./hashtags.js";
import { topicOf } from "./topics.js";
import { L, lbl } from "./i18n.js";

const clean = (c) => (c || "").replace(/[⁦-⁩‎‏\t]/g, "");
const firstLine = (c) => clean(c).split("\n").find((l) => l.trim())?.trim() || "";

// طول الفيديو من صندوق mvhd في أول الملف (الريلز ملفاتها تبدأ فيه، فنحمّل أول ٢٥٦ كيلو بس)
async function durationOf(url) {
  const res = await fetch(url, { headers: { range: "bytes=0-262143" } });
  if (res.ok) {
    const b = Buffer.from(await res.arrayBuffer());
    const i = b.indexOf("mvhd");
    if (i > 0) {
      const v = b[i + 4];
      const scale = v === 1 ? b.readUInt32BE(i + 24) : b.readUInt32BE(i + 16);
      const dur = v === 1 ? Number(b.readBigUInt64BE(i + 28)) : b.readUInt32BE(i + 20);
      if (scale && dur) return dur / scale;
    }
  }
  // احتياط: ffprobe إذا موجود (يقرا الطول من الرابط بدون تحميل الملف كامل)
  return new Promise((ok) => execFile("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", url], { timeout: 20000 },
    (err, out) => ok(err ? null : +out.trim() || null)));
}

// يعبّي طول الريلز اللي ما نعرف طولها (كم ريل كل مرة عشان ما نضغط على API انستجرام). ٠ = حاولنا وما قدرنا
export async function fillDurations(accountId, max = 30) {
  const acc = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
  if (!acc) return 0;
  const todo = db.prepare("SELECT id, avg_watch_time FROM media WHERE account_id = ? AND product_type = 'REELS' AND duration IS NULL AND avg_watch_time > 0 ORDER BY timestamp DESC LIMIT ?").all(accountId, max);
  const put = db.prepare("UPDATE media SET duration = ? WHERE id = ?");
  if (acc.is_demo) {
    // الحساب التجريبي ما عنده ملفات: طول تقريبي ثابت لكل ريل
    for (const r of todo) put.run(Math.round(r.avg_watch_time / (0.25 + (parseInt(r.id.slice(-4), 36) % 50) / 100)), r.id);
    return todo.length;
  }
  if (!todo.length) return 0;
  const token = await refreshTokenIfNeeded(acc);
  let done = 0;
  for (const r of todo) {
    try {
      // رابط الفيديو المحفوظ ينتهي بعد كم يوم، فناخذ رابط جديد
      const m = await ig(`/${r.id}`, { fields: "media_url" }, token);
      const d = m.media_url ? await durationOf(m.media_url) : null;
      put.run(d && d > 0 ? Math.round(d * 10) / 10 : 0, r.id);
      done++;
    } catch (e) {
      if (e.code === 4 || e.code === 17 || e.code === 32) break; // وصلنا حد الطلبات، نكمل المرة الجاية
      put.run(0, r.id);
    }
  }
  return done;
}

// نوع أول جملة في الكابشن
export function hookOf(caption) {
  const l = firstLine(caption);
  if (!l || /^[#@]/.test(l)) return "بدون جملة";
  if (/[؟?]/.test(l)) return "سؤال";
  if (/[0-9٠-٩]/.test(l)) return "رقم";
  if (/^(مرة|كنت|يوم|لما|قبل|أول مرة|اول مرة|قصة|قصتي)/.test(l)) return "قصة";
  if (/[😂🤣😭😅😆]/u.test(l)) return "نكتة";
  return "جملة مباشرة";
}

const LENGTHS = [[0, 15, "أقل من ١٥ ثانية"], [15, 30, "١٥–٣٠ ثانية"], [30, 60, "٣٠–٦٠ ثانية"], [60, 1e9, "أكثر من دقيقة"]];
const MIN_GROUP = 4;

export function watchStats(accountId) {
  const rel = new Map(scoredPosts(accountId).map((p) => [p.id, p.rel_reach]));
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 19);
  const reels = db.prepare("SELECT * FROM media WHERE account_id = ? AND product_type = 'REELS' AND NOT trial AND avg_watch_time > 0 AND timestamp >= ? ORDER BY timestamp DESC")
    .all(accountId, since).map((p) => ({
      id: p.id, caption: firstLine(p.caption).slice(0, 80), permalink: p.permalink, timestamp: p.timestamp, reach: p.reach, views: p.views,
      watch: p.avg_watch_time, duration: p.duration > 0 ? p.duration : null,
      ret: p.duration > 0 ? Math.min(1, p.avg_watch_time / p.duration) : null,
      rel_reach: rel.get(p.id) ?? null, hook: hookOf(p.caption), topic: topicOf(p.caption),
    }));
  if (reels.length < 10) return { ready: false, reels: reels.length };

  const withDur = reels.filter((r) => r.ret != null);
  const pending = db.prepare("SELECT COUNT(*) n FROM media WHERE account_id = ? AND product_type = 'REELS' AND NOT trial AND avg_watch_time > 0 AND duration IS NULL AND timestamp >= ?").get(accountId, since).n;
  // نقيس بنسبة المشاهدة إذا نعرف طول أغلب الريلز، وإلا بالثواني
  const byPct = withDur.length >= 10 && withDur.length >= reels.length * 0.6;
  const pool = byPct ? withDur : reels;
  const score = (r) => (byPct ? r.ret : r.watch);
  const base = median(pool.map(score));

  // هل اللي يكملونه يوصل أكثر؟ نقارن النص الأعلى بالنص الأقل
  const ranked = pool.filter((r) => r.rel_reach != null).sort((a, b) => score(b) - score(a));
  const half = Math.floor(ranked.length / 2);
  const hiReach = median(ranked.slice(0, half).map((r) => r.rel_reach)), loReach = median(ranked.slice(-half).map((r) => r.rel_reach));
  const reachLink = half >= 5 && hiReach && loReach ? hiReach / loReach - 1 : null;

  const group = (list, keyOf, names) => {
    const g = {};
    for (const r of list) { const k = keyOf(r); if (k != null) (g[k] ||= []).push(r); }
    return (names || Object.keys(g)).filter((k) => g[k]).map((k) => ({
      name: k, n: g[k].length, enough: g[k].length >= MIN_GROUP,
      score: median(g[k].map(score)), lift: median(g[k].map(score)) / base - 1,
      watch: median(g[k].map((r) => r.watch)), reach_lift: (median(g[k].map((r) => r.rel_reach).filter((x) => x != null)) ?? 1) - 1,
    }));
  };
  const lengths = byPct ? group(withDur, (r) => LENGTHS.find(([lo, hi]) => r.duration >= lo && r.duration < hi)?.[2], LENGTHS.map((x) => x[2])) : [];
  // المجموعات اللي فيها ريلز كفاية أول، وبعدين العينات القليلة
  const order = (a, b) => b.enough - a.enough || b.score - a.score;
  const hooks = group(pool, (r) => r.hook).sort(order);
  const topics = group(pool, (r) => r.topic).filter((x) => x.name !== "أخرى").sort(order);

  // أقوى وأضعف ريلز آخر ٦ شهور
  const recent = pool.filter((r) => Date.now() - Date.parse(r.timestamp) <= 180 * 864e5).sort((a, b) => score(b) - score(a));
  const top = recent.slice(0, 5), bottom = recent.length >= 10 ? recent.slice(-5).reverse() : [];

  // الدروس: من الأقوى للأضعف
  const P = (x) => `${Math.round(Math.abs(x) * 100)}${L("٪", "%")}`;
  // «الضعف» بس للي قريب من ×٢، والأكثر منه بالرقم
  const more = (x) => (x >= 0.95 ? `${x >= 1.05 ? `${Math.round((1 + x) * 10) / 10} أضعاف` : "الضعف"}` : `أكثر بـ ${P(x)}`);
  const moreEn = (x) => (x >= 0.95 ? (x >= 1.05 ? `${Math.round((1 + x) * 10) / 10}× as many` : "twice as many") : `${P(x)} more`);
  const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const lessons = [];
  if (reachLink != null && reachLink >= 0.15) lessons.push(L(`الريلز اللي الناس ${byPct ? "يكملونها" : "يتفرجون عليها أطول"} توصل عندك لناس ${more(reachLink)} اللي يطلعون منها بدري. يعني مدة المشاهدة هي اللي تفتح لك الوصول.`,
    `Reels people ${byPct ? "finish" : "watch longer"} reach ${moreEn(reachLink)} people as the ones they drop early. Watch time is what unlocks your reach.`));
  const okLen = lengths.filter((x) => x.enough);
  const bestLen = [...okLen].sort((a, b) => b.reach_lift - a.reach_lift)[0];
  if (bestLen && okLen.length >= 2 && bestLen.reach_lift > 0.1) lessons.push(L(`أفضل طول عندك ${bestLen.name}: الناس يشوفون ${P(bestLen.score)} منها بالمتوسط، ووصولها أعلى من عادتك بـ ${P(bestLen.reach_lift)}.`,
    `Your best length is ${low(lbl(bestLen.name))}: people watch ${P(bestLen.score)} of them on average, and they get ${P(bestLen.reach_lift)} more reach than usual.`));
  const okHook = hooks.filter((x) => x.enough);
  if (okHook.length >= 2 && okHook[0].lift > 0.1) lessons.push(L(`الريلز اللي تبدأ بـ«${okHook[0].name}» الناس ${byPct ? "يكملونها" : "يتفرجون عليها"} أكثر من عادتك بـ ${P(okHook[0].lift)}.`,
    `Reels that open with ${{ "سؤال": "a question", "رقم": "a number", "قصة": "a personal story", "نكتة": "a joke" }[okHook[0].name] || `“${lbl(okHook[0].name)}”`} get ${P(okHook[0].lift)} more ${byPct ? "completion" : "watch time"} than usual.`));
  const okTop = topics.filter((x) => x.enough);
  if (okTop.length >= 2 && okTop[0].lift > 0.1) lessons.push(L(`موضوع «${okTop[0].name}» أكثر شي يخلي الناس يكملون (أعلى من عادتك بـ ${P(okTop[0].lift)}).`, `“${lbl(okTop[0].name)}” keeps people watching the most (${P(okTop[0].lift)} above usual).`));
  const worst = okTop.at(-1);
  if (worst && okTop.length >= 3 && worst.lift < -0.15) lessons.push(L(`موضوع «${worst.name}» الناس يطلعون منه بدري (أقل من عادتك بـ ${P(worst.lift)}). جرّب تختصره أو تبدأه بالنتيجة.`, `People drop off “${lbl(worst.name)}” early (${P(worst.lift)} below usual). Try making it shorter or opening with the payoff.`));

  return {
    ready: true, by_pct: byPct, reels: pool.length, pending,
    median_watch: median(pool.map((r) => r.watch)), median_ret: byPct ? base : null, median_duration: byPct ? median(withDur.map((r) => r.duration)) : null,
    reach_link: reachLink, lengths, hooks, topics, top, bottom, lessons,
  };
}

// مقارنة ريل واحد بعادتك (لتقرير الـ ٤٨ ساعة و/بوست): نسبة المشاهدة مقارنة بآخر ٦٠ يوم
export function reelWatch(accountId, post) {
  if (!(post.avg_watch_time > 0)) return null;
  const t = Date.parse(post.timestamp);
  const peers = db.prepare(`SELECT avg_watch_time, duration FROM media WHERE account_id = ? AND id != ? AND product_type = 'REELS' AND NOT trial AND avg_watch_time > 0 AND timestamp BETWEEN ? AND ?`)
    .all(accountId, post.id, new Date(t - 60 * 864e5).toISOString().slice(0, 19), new Date(t - 2 * 864e5).toISOString().slice(0, 19));
  const ret = post.duration > 0 ? Math.min(1, post.avg_watch_time / post.duration) : null;
  const peerRet = peers.filter((p) => p.duration > 0).map((p) => Math.min(1, p.avg_watch_time / p.duration));
  if (ret != null && peerRet.length >= 5) return { watch: post.avg_watch_time, duration: post.duration, ret, ratio: ret / median(peerRet), by_pct: true };
  if (peers.length >= 5) return { watch: post.avg_watch_time, duration: post.duration || null, ret, ratio: post.avg_watch_time / median(peers.map((p) => p.avg_watch_time)), by_pct: false };
  return { watch: post.avg_watch_time, duration: post.duration || null, ret, ratio: null };
}
