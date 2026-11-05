// متابعة التجارب: تغيّر شي واحد لفترة (تشيل هاشتاق، ريلز أقصر، تبدأ بسؤال…) والأداة تقارن البوستات اللي فيها التغيير
// بالبوستات اللي قبل التجربة بدونه (نفس النوع)، وتقول لك نفعت أو لا. وآخر التجربة يوصلك تنبيه بالنتيجة
import { db } from "./db.js";
import { median, tagsOf, hashtagStats } from "./hashtags.js";
import { hookOf, watchStats } from "./watch.js";
import { save as saveAlert } from "./alerts.js";
import { localStart } from "./analysis.js";
import { L, lbl, langStore } from "./i18n.js";

db.exec(`CREATE TABLE IF NOT EXISTS experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, kind TEXT, param TEXT, name TEXT, note TEXT,
  start TEXT, end TEXT, stopped INTEGER DEFAULT 0, created_at INTEGER
)`);

const TZ = process.env.TIMEZONE || "Asia/Riyadh";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const localDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const localHour = (iso) => +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(iso));
const addDays = (d, k) => new Date(Date.parse(d + "T00:00:00Z") + k * 864e5).toISOString().slice(0, 10);
const kindOf = (p) => (p.product_type === "REELS" ? "REELS" : p.media_type);
const intentOf = (p) => (p.reach ? ((p.saved || 0) + 1.5 * (p.shares || 0) + 2 * (p.profile_visits || 0) + 3 * (p.follows || 0)) / p.reach : null);
const plain = (t) => t.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const hasTag = (p, tag) => tagsOf(p.caption).some((t) => plain(t) === plain(tag));
const hourRange = (param) => { const [a, b] = String(param || "").split("-").map(Number); return [a, b]; };
const hourIn = (h, [a, b]) => (a <= b ? h >= a && h < b : h >= a || h < b);

// أنواع التجارب: وش البوست اللي «فيه التغيير»، وأي بوستات قبل التجربة نقارن فيها
export const KINDS = {
  no_tag: { name: "بدون هاشتاق", needs: "tag", label: (x) => L(`بدون ${x}`, `Without ${x}`),
    match: (p, x) => !hasTag(p, x), before: (p, x) => hasTag(p, x), what: (x) => L(`البوستات بدون ${x}`, `Posts without ${x}`), vs: (x) => L(`بوستاتك اللي كان فيها ${x} قبل التجربة`, `your posts with ${x} before the test`) },
  with_tag: { name: "هاشتاق جديد", needs: "tag", label: (x) => L(`مع ${x}`, `With ${x}`),
    match: (p, x) => hasTag(p, x), before: (p, x) => !hasTag(p, x), what: (x) => L(`البوستات اللي فيها ${x}`, `Posts with ${x}`), vs: () => L("بوستاتك قبل التجربة", "your posts before the test") },
  short_reels: { name: "ريلز أقصر", needs: "seconds", label: (x) => L(`ريلز أقل من ${x} ثانية`, `Reels under ${x} sec`), reels: true,
    match: (p, x) => p.duration > 0 && p.duration < +x, before: (p, x) => p.duration >= +x, what: (x) => L(`الريلز الأقل من ${x} ثانية`, `Reels under ${x} sec`), vs: (x) => L(`ريلزك اللي كانت ${x} ثانية أو أطول قبل التجربة`, `your Reels of ${x} sec or longer before the test`) },
  hook_question: { name: "ابدأ بسؤال", label: () => L("أول سطر سؤال", "First line is a question"),
    match: (p) => hookOf(p.caption) === "سؤال", before: (p) => hookOf(p.caption) !== "سؤال", what: () => L("البوستات اللي تبدأ بسؤال", "Posts that open with a question"), vs: () => L("بوستاتك اللي ما بدأت بسؤال قبل التجربة", "your posts that didn't open with a question before the test") },
  post_time: { name: "وقت نشر", needs: "hours", label: (x) => L(`النشر بين ${hourRange(x).join(" و")}`, `Posting between ${hourRange(x).map((h) => h + ":00").join(" and ")}`),
    match: (p, x) => hourIn(localHour(p.timestamp), hourRange(x)), before: (p, x) => !hourIn(localHour(p.timestamp), hourRange(x)),
    what: (x) => L(`البوستات اللي نزلت بين الساعة ${hourRange(x).join(" و")}`, `Posts published between ${hourRange(x).map((h) => h + ":00").join(" and ")}`), vs: () => L("بوستاتك بأوقات ثانية قبل التجربة", "your posts at other times before the test") },
  custom: { name: "تغيير عام", label: () => L("تغيير عام", "General change"),
    match: () => true, before: () => true, what: () => L("بوستاتك خلال التجربة", "Your posts during the test"), vs: () => L("بوستاتك قبل التجربة", "your posts before the test") },
};
// الاسم الافتراضي ينحفظ بالعربي دايماً، ويتترجم وقت العرض
const arLabel = (K, param) => langStore.run("ar", () => K.label(param));
const shownName = (K, e) => (e.name === arLabel(K, e.param) ? K.label(e.param) : e.name);

const SETTLE_DAYS = 2;   // البوست يحتاج يومين قبل ما نحكم على وصوله
const MIN_TEST = 3, SURE_TEST = 6, MIN_BASE = 5;

// كل بوست في التجربة ينقارن بالعادة لنفس نوعه (ريل بريل، كاروسيل بكاروسيل)
function compare(test, base) {
  const byKind = {};
  for (const p of base) (byKind[kindOf(p)] ||= []).push(p);
  const norm = {};
  for (const [k, list] of Object.entries(byKind)) if (list.length >= 3) norm[k] = {
    reach: median(list.map((p) => p.reach)), intent: median(list.map(intentOf).filter((x) => x != null)),
    follows: median(list.map((p) => p.follows || 0)),
    ret: median(list.filter((p) => p.duration > 0 && p.avg_watch_time > 0).map((p) => Math.min(1, p.avg_watch_time / p.duration))),
  };
  const ratios = { reach: [], intent: [], follows: [], ret: [] };
  let compared = 0;
  for (const p of test) {
    const b = norm[kindOf(p)];
    if (!b?.reach) continue;
    compared++;
    ratios.reach.push(p.reach / b.reach);
    const i = intentOf(p);
    if (b.intent && i != null) ratios.intent.push(i / b.intent);
    ratios.follows.push((p.follows || 0) - b.follows);
    if (b.ret && p.duration > 0 && p.avg_watch_time > 0) ratios.ret.push(Math.min(1, p.avg_watch_time / p.duration) / b.ret);
  }
  const m = (v) => (v.length ? median(v) - 1 : null);
  return { compared, reach: m(ratios.reach), intent: m(ratios.intent), ret: ratios.ret.length >= MIN_TEST ? m(ratios.ret) : null,
    follows: ratios.follows.length ? median(ratios.follows) : null };
}

const P = (x) => `${Math.round(Math.abs(x) * 100)}${L("٪", "%")}`;
// «الضعف» بس للي قريب من ×٢، والأكثر منه بالرقم (٢٫٩ مو «الضعف»)
const diff = (x) => (x == null ? null : Math.abs(x) < 0.05 ? L("نفسه تقريباً", "about the same") : x >= 0.95 ? (x >= 1.05 ? L(`${Math.round((1 + x) * 10) / 10} أضعاف`, `${Math.round((1 + x) * 10) / 10}× higher`) : L("الضعف", "twice as high")) : L(`${x > 0 ? "أعلى" : "أقل"} بـ ${P(x)}`, `${P(x)} ${x > 0 ? "higher" : "lower"}`));
const count = (k) => L(k === 1 ? "بوست واحد" : k === 2 ? "بوستين" : `${k} ${k <= 10 ? "بوستات" : "بوست"}`, `${k} ${k === 1 ? "post" : "posts"}`);

export function evaluate(e) {
  const K = KINDS[e.kind] || KINDS.custom;
  const t = today(), endDay = e.end < t ? e.end : t;
  const done = e.stopped || e.end < t;
  const reelsOnly = K.reels ? "AND product_type = 'REELS'" : "";
  const inRange = db.prepare(`SELECT * FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial ${reelsOnly} AND timestamp >= ? AND timestamp < ? ORDER BY timestamp`)
    .all(e.account_id, addDays(e.start, -1) + "T00:00:00", addDays(endDay, 2) + "T00:00:00")
    .filter((p) => { const d = localDate(p.timestamp); return d >= e.start && d <= endDay; });
  const matched = inRange.filter((p) => K.match(p, e.param));
  const settled = matched.filter((p) => p.reach > 0 && Date.now() - Date.parse(p.timestamp) >= SETTLE_DAYS * 864e5);
  // نسبة الالتزام: كم بوست في الفترة طبّقت فيه التغيير (للهاشتاق والسؤال والوقت)
  const off = K === KINDS.custom ? 0 : inRange.length - matched.length;

  // قبل التجربة: ٦٠ يوم، ولو قليلة ١٢٠
  let base = [];
  for (const days of [60, 120]) {
    base = db.prepare(`SELECT * FROM media WHERE account_id = ? AND product_type != 'STORY' AND NOT trial ${reelsOnly} AND reach > 0 AND timestamp >= ? AND timestamp < ?`)
      .all(e.account_id, localStart(addDays(e.start, -days)), localStart(e.start)).filter((p) => K.before(p, e.param));
    if (base.length >= MIN_BASE * 2) break;
  }
  const c = compare(settled, base);

  // المتابعين الجدد باليوم: خلال التجربة مقابل نفس عدد الأيام قبلها
  const len = Math.max(1, Math.round((Date.parse(endDay) - Date.parse(e.start)) / 864e5) + 1);
  const perDay = (a, b) => { const r = db.prepare("SELECT AVG(new_followers) v, COUNT(new_followers) n FROM daily WHERE account_id = ? AND date BETWEEN ? AND ?").get(e.account_id, a, b); return r.n >= 3 ? r.v : null; };
  const fNow = perDay(e.start, endDay), fBefore = perDay(addDays(e.start, -len), addDays(e.start, -1));

  let verdict, text;
  if (c.compared < MIN_TEST || base.length < MIN_BASE) {
    verdict = "early";
    const young = matched.length - c.compared;
    text = base.length < MIN_BASE ? L(`ما فيه كفاية من ${K.vs(e.param)} نقارن فيها (${base.length}).`, `Not enough of ${K.vs(e.param)} to compare against (${base.length}).`)
      : L(`للحين ${c.compared ? count(c.compared) : "ما فيه بوستات"} نقدر نحكم عليها${matched.length > c.compared ? ` (و${count(matched.length - c.compared)} ${matched.length - c.compared === 1 ? "عمره" : "عمرها"} أقل من يومين)` : ""}. نحتاج ${MIN_TEST} على الأقل.`,
        `So far ${c.compared ? count(c.compared) : "no posts"} ${c.compared === 1 ? "is" : "are"} ready to judge${young > 0 ? ` (plus ${count(young)} less than two days old)` : ""}. At least ${MIN_TEST} are needed.`);
  } else {
    // الوصول هو الأساس، والاهتمام والمشاهدة يرجّحون
    const score = c.reach + 0.5 * (c.intent ?? 0) + (K.reels ? 0.5 * (c.ret ?? 0) : 0);
    verdict = score >= 0.15 && c.reach > -0.1 ? "won" : score <= -0.15 ? "lost" : "same";
    const bits = [L(`الوصول ${diff(c.reach)}`, `reach ${diff(c.reach)}`)];
    if (c.intent != null) bits.push(L(`الاهتمام (حفظ ومشاركة وزيارة بروفايل) ${diff(c.intent)}`, `intent (saves, shares, profile visits) ${diff(c.intent)}`));
    if (c.ret != null) bits.push(L(`نسبة المشاهدة ${diff(c.ret)}`, `watch rate ${diff(c.ret)}`));
    text = L(`${K.what(e.param)} (${count(c.compared)}) مقارنة مع ${K.vs(e.param)} (${count(base.length)}): ${bits.join("، ")}.`,
      `${K.what(e.param)} (${count(c.compared)}) vs. ${K.vs(e.param)} (${count(base.length)}): ${bits.join(", ")}.`);
  }
  const sure = c.compared >= SURE_TEST;
  const advice = { won: done ? L("نفعت. خلها عادة عندك.", "It worked. Make it a habit.") : L("ماشية زين للحين، كمّل.", "Looking good so far. Keep going."),
    lost: done ? L("ما نفعت. رجع لطريقتك القديمة أو جرّب شي ثاني.", "It didn't work. Go back to your old approach or try something else.") : L("للحين أضعف من عادتك. كمّلها لآخرها قبل ما تحكم.", "Weaker than usual so far. Finish the test before you judge it."),
    same: done ? L("ما فرقت. اختار اللي أسهل عليك.", "No real difference. Go with whatever's easier for you.") : L("للحين ما فيه فرق واضح.", "No clear difference yet."),
    early: done ? L("خلصت التجربة بدون بوستات كفاية. جرّبها مرة ثانية وانشر أكثر فيها.", "The test ended without enough posts. Run it again and post more during it.") : "" }[verdict];
  return {
    ...e, name: shownName(K, e), label: K.label(e.param), kind_name: K.name, done, days: len, days_left: done ? 0 : Math.round((Date.parse(e.end) - Date.parse(t)) / 864e5) + 1, // يوم النهاية نفسه محسوب
    posts: matched.length, settled: settled.length, compared: c.compared, off, base: base.length,
    reach: c.reach, intent: c.intent, ret: c.ret, follows_per_day: fNow, follows_before: fBefore,
    verdict, sure, text,
    advice: advice + (verdict === "won" && c.intent != null && c.intent < -0.15 ? L(" بس انتبه: الوصول زاد والاهتمام نزل، يعني وصلت لناس أكثر بس أقل اهتمام. حط دعوة واضحة في آخرها.", " Heads-up: reach went up but intent dropped, so you reached more people who were less interested. Add a clear call to action at the end.") : "")
      + (verdict !== "early" && !sure ? L(` (العينة صغيرة: ${count(c.compared)}، فخذها كإشارة مو حكم نهائي)`, ` (Small sample: ${count(c.compared)}, so treat it as a signal, not a final verdict.)`) : ""),
    off_note: off ? L(`نزّلت ${count(off)} في الفترة بدون التغيير، وما انحسبت.`, `You posted ${count(off)} during the test without the change, so ${off === 1 ? "it wasn't" : "they weren't"} counted.`) : null,
  };
}

export function listExperiments(accountId) {
  const rows = db.prepare("SELECT * FROM experiments WHERE account_id = ? ORDER BY stopped, end DESC, id DESC").all(accountId).map(evaluate);
  return { running: rows.filter((x) => !x.done), finished: rows.filter((x) => x.done), suggestions: suggestions(accountId, rows), kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { name: v.name, needs: v.needs || null }])) };
}

// اقتراحات من أرقامك: أضعف هاشتاق تستخدمه، وطول الريل، والبداية بسؤال
function suggestions(accountId, existing) {
  const out = [];
  const has = (kind, param) => existing.some((x) => x.kind === kind && (param == null || String(x.param) === String(param)) && !x.done);
  const acc = db.prepare("SELECT username, name FROM accounts WHERE id = ?").get(accountId);
  if (!acc) return out;
  const h = hashtagStats(accountId, acc.username, acc.name);
  // نفس قاعدة النصائح: مو هاشتاق اسمك، والاهتمام معه أقل بعد (مو بس الوصول)
  const weak = h.ready ? h.tags.filter((t) => t.n >= 10 && t.reach_lift < -0.1 && t.category !== "اسمك" && (t.intent_lift ?? 0) < 0).sort((a, b) => a.reach_lift - b.reach_lift)[0] : null;
  if (weak && !has("no_tag", weak.tag)) out.push({ kind: "no_tag", param: weak.tag, why: L(`البوستات اللي فيها ${weak.tag} وصولها أقل من عادتك بـ ${P(weak.reach_lift)} (${weak.n} بوست). شيله أسبوعين وشوف.`, `Posts with ${weak.tag} get ${P(weak.reach_lift)} less reach than usual (${weak.n} posts). Drop it for two weeks and see.`) });
  const w = watchStats(accountId);
  const best = w.ready ? w.lengths.filter((x) => x.enough).sort((a, b) => b.reach_lift - a.reach_lift)[0] : null;
  // بس إذا أفضل طول عندك أصلاً تحت الدقيقة، وإلا الاقتراح يناقض أرقامك
  if (w.ready && w.by_pct && w.median_duration > 60 && (!best || best.name !== "أكثر من دقيقة") && !has("short_reels")) {
    out.push({ kind: "short_reels", param: 60, why: L(`ريلزك عادةً ${Math.round(w.median_duration)} ثانية${best ? `، وأفضل وصول عندك للريلز ${best.name}` : ""}. نزّل ريلزك كلها أقل من دقيقة لأسبوعين.`,
      `Your Reels usually run ${Math.round(w.median_duration)} sec${best ? `, and your best reach comes from Reels ${lbl(best.name).replace(/^[A-Z]/, (c) => c.toLowerCase())}` : ""}. Keep all your Reels under a minute for two weeks.`) });
  }
  const q = w.ready ? w.hooks.find((x) => x.name === "سؤال") : null;
  if (q && q.enough && q.lift > 0.1 && !has("hook_question")) out.push({ kind: "hook_question", param: null, why: L(`الريلز اللي تبدأ بسؤال الناس يكملونها أكثر بـ ${P(q.lift)}. ابدأ كل بوستاتك بسؤال لأسبوعين.`, `People watch ${P(q.lift)} more of Reels that open with a question. Open all your posts with a question for two weeks.`) });
  return out;
}

export function addExperiment(accountId, b) {
  const K = KINDS[b.kind];
  if (!K) throw new Error(L("اختار نوع التجربة", "Choose a test type"));
  let param = b.param == null ? null : String(b.param).trim();
  if (K.needs === "tag") { if (!param) throw new Error(L("اكتب الهاشتاق", "Enter the hashtag")); if (!param.startsWith("#")) param = "#" + param; param = param.split(/\s+/)[0]; }
  if (K.needs === "seconds") { param = String(Math.round(+param || 60)); if (+param < 10 || +param > 180) throw new Error(L("الطول بين ١٠ و١٨٠ ثانية", "Length must be between 10 and 180 seconds")); }
  if (K.needs === "hours") { const [a, c] = hourRange(param); if (!(a >= 0 && a < 24 && c >= 0 && c <= 24 && a !== c)) throw new Error(L("اكتب الوقت مثل 20-23", "Enter the hours like 20-23")); param = `${a}-${c}`; }
  const start = /^\d{4}-\d{2}-\d{2}$/.test(b.start || "") ? b.start : today();
  const days = Math.min(60, Math.max(3, Math.round(+b.days || 14)));
  // الاسم الافتراضي بالعربي عشان ما ينحفظ بلغة اللوحة (يتترجم وقت العرض)
  const name = String(b.name || "").trim().slice(0, 80) || arLabel(K, param);
  const r = db.prepare("INSERT INTO experiments (account_id, kind, param, name, note, start, end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(accountId, b.kind, param, name, String(b.note || "").slice(0, 300), start, addDays(start, days - 1), Math.floor(Date.now() / 1000));
  return evaluate(db.prepare("SELECT * FROM experiments WHERE id = ?").get(Number(r.lastInsertRowid)));
}

// إيقاف بدري: تنتهي أمس (أو اليوم لو بدأت اليوم)
export function stopExperiment(id) {
  const e = db.prepare("SELECT * FROM experiments WHERE id = ?").get(+id);
  if (!e) throw new Error(L("التجربة مو موجودة", "Test not found"));
  const t = today();
  db.prepare("UPDATE experiments SET stopped = 1, end = ? WHERE id = ?").run(e.start >= t ? e.start : addDays(t, -1) < e.end ? addDays(t, -1) : e.end, +id);
  return { ok: true };
}
export const deleteExperiment = (id) => (db.prepare("DELETE FROM experiments WHERE id = ?").run(+id), { ok: true });

const VERDICT = { won: "✅ نفعت", lost: "❌ ما نفعت", same: "➖ ما فرقت", early: "⏳ ما فيه بوستات كفاية" };
export const verdictName = (v) => lbl(VERDICT[v]);

// بعد ما يمر يومين كاملين على آخر يوم في التجربة (عشان آخر بوست ياخذ ٤٨ ساعة) يوصلك تنبيه بالنتيجة
export function experimentAlerts(accountIds) {
  const t = today();
  for (const id of accountIds) {
    for (const e of db.prepare("SELECT * FROM experiments WHERE account_id = ? AND end < ?").all(id, addDays(t, -SETTLE_DAYS))) {
      if (db.prepare("SELECT 1 FROM alerts WHERE account_id = ? AND kind = ?").get(id, `exp:${e.id}`)) continue;
      const r = evaluate(e);
      saveAlert(id, null, `exp:${e.id}`, `🧪 نتيجة تجربة «${r.name}»: ${VERDICT[r.verdict]}`, `${r.text} ${r.advice}`.trim());
    }
  }
}
