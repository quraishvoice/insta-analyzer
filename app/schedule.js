// النشر المجدول: ريل أو صورة أو كاروسيل ينزل لحاله في الوقت اللي تختاره
// انستجرام ياخذ الملف من رابط عام، فوقت النشر بس نفتح رابط مؤقت للملفات (tunnel.js) ونسكّره بعده.
// نبدأ التجهيز قبل الوقت بـ ١٠ دقايق (فتح الرابط + معالجة الفيديو عند انستجرام)، وننشر بالدقيقة
import { mkdirSync, renameSync, rmSync, readdirSync, statSync, existsSync, createWriteStream } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { db } from "./db.js";
import { ig } from "./instagram.js";
import { withPublicFiles, tunnelTool } from "./tunnel.js";
import { save as saveAlert } from "./alerts.js";
import { L } from "./i18n.js";

db.exec(`CREATE TABLE IF NOT EXISTS scheduled (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, kind TEXT, files TEXT, caption TEXT,
  publish_at INTEGER, trial TEXT, share_to_feed INTEGER DEFAULT 1, thumb_offset INTEGER,
  status TEXT, error TEXT, media_id TEXT, permalink TEXT, created_at INTEGER, published_at INTEGER)`);
// لو الأداة طفت وهي تجهّز بوست، يرجع للانتظار
db.exec("UPDATE scheduled SET status = 'waiting' WHERE status = 'preparing'");

const DIR = "data/scheduled", TMP = join(DIR, "tmp");
mkdirSync(TMP, { recursive: true });
const now = () => Math.floor(Date.now() / 1000);
const PREPARE = 10 * 60;   // نبدأ التجهيز قبل الوقت بعشر دقايق
const LATE = 3 * 3600;      // لو الجهاز كان طافي وفات الوقت بأكثر من ٣ ساعات، ما ننشر لحالنا
const VIDEO = [".mp4", ".mov"], IMAGE = [".jpg", ".jpeg"], CONVERT = [".png", ".heic", ".heif", ".webp"];
const MAX = { video: 300 * 1024 * 1024, image: 8 * 1024 * 1024 };
const firstLine = (s) => (s || "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 50) || "";
const KIND_AR = { REELS: "الريل", IMAGE: "البوست", CAROUSEL: "الكاروسيل" };
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// رفع ملف من اللوحة (يمر كـ stream، بدون حد الـ JSON). يرجع رمز الملف المؤقت
export async function saveUpload(req, ext) {
  ext = "." + String(ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (![...VIDEO, ...IMAGE, ...CONVERT].includes(ext)) throw err(L("نوع الملف ما ينفع. الفيديو MP4 أو MOV، والصور JPG أو PNG.", "Unsupported file. Videos: MP4 or MOV. Images: JPG or PNG."));
  const limit = VIDEO.includes(ext) ? MAX.video : MAX.image * 4;
  const token = randomBytes(12).toString("hex"), path = join(TMP, token + ext);
  let size = 0;
  await new Promise((ok, fail) => {
    const out = createWriteStream(path);
    req.on("data", (c) => { size += c.length; if (size > limit) { req.destroy(); out.destroy(); fail(err(L("الملف كبير. الفيديو بالكثير ٣٠٠ ميقا.", "File too large. Videos can be up to 300 MB."), 413)); } });
    req.pipe(out);
    out.on("finish", ok); out.on("error", fail); req.on("error", fail);
  }).catch((e) => { rmSync(path, { force: true }); throw e; });
  if (!size) { rmSync(path, { force: true }); throw err(L("الملف فاضي", "The file is empty")); }
  // انستجرام يقبل الصور JPG بس: نحوّل PNG وHEIC بأداة الماك sips
  if (CONVERT.includes(ext)) {
    const jpg = join(TMP, token + ".jpg");
    try { execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", path, "--out", jpg], { stdio: "ignore" }); } catch {
      rmSync(path, { force: true });
      throw err(L("ما قدرت أحوّل الصورة لـ JPG. احفظها JPG وارفعها.", "Couldn't convert the image to JPG. Save it as JPG and upload again."));
    }
    rmSync(path, { force: true });
    return { token: token + ".jpg", type: "image" };
  }
  if (IMAGE.includes(ext) && size > MAX.image) { rmSync(path, { force: true }); throw err(L("الصورة كبيرة. بالكثير ٨ ميقا.", "Image too large. Max 8 MB.")); }
  return { token: token + ext, type: VIDEO.includes(ext) ? "video" : "image" };
}

// مدة الفيديو بالثواني (لو ffprobe موجود)، عشان نرفض اللي انستجرام بيرفضه قبل يوم النشر
function duration(path) {
  for (const bin of ["ffprobe", "/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"]) {
    try { return +execFileSync(bin, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" }).trim(); } catch {}
  }
  return null;
}

export function createScheduled(accountId, body) {
  const acc = db.prepare("SELECT is_demo FROM accounts WHERE id = ?").get(accountId);
  if (acc?.is_demo) throw err(L("الحساب التجريبي ما ينشر. اربط حسابك الحقيقي.", "The demo account can't publish. Connect your real account."));
  if (!tunnelTool()) throw err(L("أداة cloudflared مو مثبتة، والجدولة تحتاجها.", "cloudflared isn't installed; scheduling needs it."));
  const tokens = Array.isArray(body.files) ? body.files.map(String) : [];
  if (!tokens.length) throw err(L("اختار فيديو أو صورة", "Choose a video or an image"));
  if (tokens.length > 10) throw err(L("الكاروسيل بالكثير ١٠", "A carousel can have up to 10 items"));
  const files = tokens.map((t) => {
    if (!/^[a-f0-9]{24}\.(mp4|mov|jpg|jpeg)$/.test(t) || !existsSync(join(TMP, t))) throw err(L("الملف ما وصل. ارفعه مرة ثانية.", "The file didn't arrive. Upload it again."));
    return { token: t, type: VIDEO.includes(extname(t)) ? "video" : "image" };
  });
  const kind = files.length > 1 ? "CAROUSEL" : files[0].type === "video" ? "REELS" : "IMAGE";
  for (const f of files) {
    if (f.type !== "video") continue;
    const d = duration(join(TMP, f.token));
    if (d == null) continue;
    if (kind === "REELS" && (d < 3 || d > 900)) throw err(L("الريل لازم يكون بين ٣ ثواني و١٥ دقيقة.", "A reel must be between 3 seconds and 15 minutes."));
    if (kind === "CAROUSEL" && (d < 3 || d > 60)) throw err(L("الفيديو داخل الكاروسيل لازم يكون بين ٣ و٦٠ ثانية.", "Videos in a carousel must be 3–60 seconds."));
  }
  const caption = String(body.caption || "").trim();
  if (caption.length > 2200) throw err(L("الكابشن أطول من ٢٢٠٠ حرف", "The caption is over 2,200 characters"));
  if ((caption.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) throw err(L("انستجرام يقبل ٣٠ هاشتاق بالكثير", "Instagram allows at most 30 hashtags"));
  const at = Math.floor(+body.publish_at);
  if (!Number.isFinite(at) || at < now() - 60) throw err(L("اختار وقت جاي", "Choose a time in the future"));
  if (at > now() + 60 * 86400) throw err(L("بالكثير بعد شهرين", "At most two months ahead"));
  const trial = kind === "REELS" && ["MANUAL", "SS_PERFORMANCE"].includes(body.trial) ? body.trial : null;
  const thumb = kind === "REELS" && body.thumb_offset != null && body.thumb_offset !== "" ? Math.max(0, Math.round(+body.thumb_offset * 1000)) : null;

  const id = db.prepare(`INSERT INTO scheduled (account_id, kind, files, caption, publish_at, trial, share_to_feed, thumb_offset, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`).run(accountId, kind, "[]", caption, at, trial, body.share_to_feed === false ? 0 : 1, Number.isFinite(thumb) ? thumb : null, now()).lastInsertRowid;
  const dir = join(DIR, String(id));
  mkdirSync(dir, { recursive: true });
  const kept = files.map((f, i) => { const name = `${i}${extname(f.token)}`; renameSync(join(TMP, f.token), join(dir, name)); return { name, type: f.type }; });
  db.prepare("UPDATE scheduled SET files = ? WHERE id = ?").run(JSON.stringify(kept), id);
  keepAwake();
  return listScheduled(accountId);
}

export function listScheduled(accountId) {
  return db.prepare(`SELECT id, kind, files, caption, publish_at, trial, share_to_feed, thumb_offset, status, error, permalink, published_at FROM scheduled
    WHERE account_id = ? AND (status IN ('waiting', 'preparing', 'missed', 'failed') OR COALESCE(published_at, created_at) >= ?) AND status != 'cancelled'
    ORDER BY publish_at`).all(accountId, now() - 7 * 86400).map((s) => ({ ...s, files: JSON.parse(s.files || "[]").length }));
}

export function cancelScheduled(id) {
  const s = db.prepare("SELECT status FROM scheduled WHERE id = ?").get(id);
  if (!s) throw err(L("مو موجود", "Not found"), 404);
  if (s.status === "preparing") throw err(L("قاعد ينشر الحين، ما يمديك تلغيه", "It's being published right now and can't be cancelled"));
  if (s.status === "published") { db.prepare("UPDATE scheduled SET status = 'cancelled' WHERE id = ?").run(id); return { ok: true }; }
  rmSync(join(DIR, String(id)), { recursive: true, force: true });
  db.prepare("UPDATE scheduled SET status = 'cancelled' WHERE id = ?").run(id);
  return { ok: true };
}

// «انشر الحين»: للي فات وقته أو فشل، أو تبي تقدّمه
export function publishNow(id) {
  const s = db.prepare("SELECT status FROM scheduled WHERE id = ?").get(id);
  if (!s || !["waiting", "missed", "failed"].includes(s.status)) throw err(L("ما يمديك تنشره الحين", "It can't be published now"));
  if (!existsSync(join(DIR, String(id)))) throw err(L("الملفات انمسحت. جدوله من جديد.", "The files are gone. Schedule it again."));
  db.prepare("UPDATE scheduled SET status = 'waiting', error = NULL, publish_at = ? WHERE id = ?").run(now(), id);
  runScheduler();
  return { ok: true };
}

// ننتظر لين انستجرام يخلص معالجة الملف (الفيديو ياخذ دقيقة أو أكثر)
async function ready(id, token) {
  for (let i = 0; i < 90; i++) {
    const s = await ig(`/${id}`, { fields: "status_code,status" }, token);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(L(`انستجرام رفض الملف: ${s.status || s.status_code}`, `Instagram rejected the file: ${s.status || s.status_code}`));
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error(L("انستجرام طوّل في معالجة الملف (أكثر من ١٥ دقيقة)", "Instagram took too long to process the file (over 15 minutes)"));
}

async function publish(s) {
  const acc = db.prepare("SELECT * FROM accounts WHERE id = ?").get(s.account_id);
  if (!acc || acc.is_demo) throw new Error(L("الحساب مو موجود", "Account not found"));
  const token = acc.token;
  const dir = join(DIR, String(s.id));
  const files = JSON.parse(s.files);
  return withPublicFiles(files.map((f) => join(dir, f.name)), async (urls) => {
    let creation;
    if (s.kind === "CAROUSEL") {
      const kids = [];
      for (const [i, f] of files.entries()) {
        const c = await ig("/me/media", f.type === "video" ? { media_type: "VIDEO", video_url: urls[i], is_carousel_item: "true" } : { image_url: urls[i], is_carousel_item: "true" }, token, "POST");
        kids.push(c.id);
      }
      for (const k of kids) await ready(k, token);
      creation = (await ig("/me/media", { media_type: "CAROUSEL", children: kids.join(","), caption: s.caption }, token, "POST")).id;
    } else if (s.kind === "REELS") {
      creation = (await ig("/me/media", {
        media_type: "REELS", video_url: urls[0], caption: s.caption, share_to_feed: s.share_to_feed ? "true" : "false",
        ...(s.thumb_offset != null ? { thumb_offset: s.thumb_offset } : {}),
        ...(s.trial ? { trial_params: JSON.stringify({ graduation_strategy: s.trial }) } : {}),
      }, token, "POST")).id;
    } else {
      creation = (await ig("/me/media", { image_url: urls[0], caption: s.caption }, token, "POST")).id;
    }
    await ready(creation, token);
    // جاهز: ننتظر لين يجي الوقت بالضبط
    const wait = s.publish_at * 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const m = await ig("/me/media_publish", { creation_id: creation }, token, "POST");
    const info = await ig(`/${m.id}`, { fields: "permalink" }, token).catch(() => ({}));
    return { media_id: m.id, permalink: info.permalink || null };
  });
}

let busy = false;
// كل دقيقة: اللي جا وقته (أو باقي عليه ١٠ دقايق) ينشر، واللي فات وقته بكثير ينبهك
export async function runScheduler() {
  for (const s of db.prepare("SELECT * FROM scheduled WHERE status = 'waiting' AND publish_at < ?").all(now() - LATE)) {
    db.prepare("UPDATE scheduled SET status = 'missed' WHERE id = ?").run(s.id);
    saveAlert(s.account_id, null, `sched-missed:${s.id}`, `⏰ ${KIND_AR[s.kind]} المجدول ما نزل`,
      `${firstLine(s.caption) ? `«${firstLine(s.caption)}» ` : ""}كان المفروض ينزل ${new Date(s.publish_at * 1000).toLocaleString("ar-SA-u-nu-latn-ca-gregory", { timeZone: process.env.TIMEZONE || "Asia/Riyadh", weekday: "long", hour: "numeric", minute: "2-digit" })} والجهاز كان طافي أو نايم. انشره من قسم «النشر المجدول» إذا لسا يناسب.`);
  }
  if (busy) return;
  const s = db.prepare("SELECT * FROM scheduled WHERE status = 'waiting' AND publish_at <= ? ORDER BY publish_at LIMIT 1").get(now() + PREPARE);
  if (!s) return keepAwake();
  busy = true;
  db.prepare("UPDATE scheduled SET status = 'preparing', error = NULL WHERE id = ?").run(s.id);
  try {
    const r = await publish(s);
    db.prepare("UPDATE scheduled SET status = 'published', media_id = ?, permalink = ?, published_at = ? WHERE id = ?").run(r.media_id, r.permalink, now(), s.id);
    rmSync(join(DIR, String(s.id)), { recursive: true, force: true });
    const late = Math.round((now() - s.publish_at) / 60);
    saveAlert(s.account_id, r.media_id, `sched-ok:${s.id}`, `✅ نزل ${KIND_AR[s.kind]} المجدول`,
      `${firstLine(s.caption) ? `«${firstLine(s.caption)}» ` : ""}${late > 5 ? `نزل متأخر ${late} دقيقة لأن الجهاز كان نايم. ` : ""}رد على أول التعليقات بسرعة، هذا يساعد وصوله.`, r.permalink);
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    db.prepare("UPDATE scheduled SET status = 'failed', error = ? WHERE id = ?").run(msg, s.id);
    saveAlert(s.account_id, null, `sched-fail:${s.id}:${now()}`, `⚠️ ${KIND_AR[s.kind]} المجدول ما نزل`,
      `${firstLine(s.caption) ? `«${firstLine(s.caption)}»: ` : ""}${msg}. جرّب «انشر الحين» من قسم «النشر المجدول».`);
  } finally {
    busy = false;
  }
}

// الماك ما ينام وفيه بوست مجدول خلال ١٢ ساعة (caffeinate يمنع النوم من الخمول بس، مو لو سكّرت غطا اللابتوب)
let awake = null;
export function keepAwake() {
  if (process.platform !== "darwin") return;
  const soon = db.prepare("SELECT 1 FROM scheduled WHERE status IN ('waiting', 'preparing') AND publish_at <= ?").get(now() + 12 * 3600);
  if (soon && !awake) {
    awake = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
    awake.unref(); // ما يمسك الأداة لو بغت تطفي
    awake.on("exit", () => { awake = null; });
  } else if (!soon && awake) awake.kill();
}

// ملفات مرفوعة وما انجدولت (سكّرت النافذة مثلاً): تنمسح بعد يوم
export function cleanTmp() {
  for (const f of readdirSync(TMP)) {
    const p = join(TMP, f);
    try { if (Date.now() - statSync(p).mtimeMs > 86400e3) rmSync(p, { force: true }); } catch {}
  }
}
