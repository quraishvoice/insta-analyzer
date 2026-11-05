// نسخة احتياطية يومية لقاعدة البيانات وصور الستوري في iCloud Drive (آخر ٣٠ نسخة)
// النسخة ما فيها توكن انستجرام ولا توكن المنافسين ولا توكن البوت: لو احتجت تسترجعها، الصق التوكنات من جديد
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { db } from "./db.js";

const ICLOUD = join(homedir(), "Library/Mobile Documents/com~apple~CloudDocs");
export const BACKUP_DIR = process.env.BACKUP_DIR || (existsSync(ICLOUD) ? join(ICLOUD, "نسخ محلل انستجرام") : join(homedir(), "نسخ محلل انستجرام"));
const KEEP = 30;
const TZ = process.env.TIMEZONE || "Asia/Riyadh";
let lastError = null;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

async function list() {
  try {
    return (await readdir(BACKUP_DIR)).filter((f) => /^insta-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  } catch { return []; }
}

export async function backupNow() {
  const file = join(BACKUP_DIR, `insta-${today()}.db`);
  let tmp = null;
  try {
    await mkdir(join(BACKUP_DIR, "stories"), { recursive: true });
    // النسخة المؤقتة (فيها الأسرار لين ننظفها) تنعمل في data/ مو في iCloud، وتنمسح حتى لو صار خطأ
    tmp = join("data", `backup-${today()}.tmp`);
    await rm(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); // نسخة متسقة حتى والأداة شغالة
    const copy = new DatabaseSync(tmp);
    // بدون أسرار: توكن انستجرام، وتوكن البوت، ورمز الدخول، وجلسات الأجهزة
    copy.exec("UPDATE accounts SET token = NULL; DELETE FROM settings WHERE key LIKE 'telegram_token' OR key = 'access_code'; DELETE FROM sessions;");
    try { copy.exec("DELETE FROM competitor_auth"); } catch {}
    copy.exec("VACUUM");
    copy.close();
    await rm(file, { force: true });
    await copyFile(tmp, file);
    await rm(tmp, { force: true });

    // صور الستوري: ننسخ بس الجديدة (الصور ما تتغير)
    const have = new Set(await readdir(join(BACKUP_DIR, "stories")));
    for (const f of await readdir("data/stories")) if (!have.has(f)) await copyFile(join("data/stories", f), join(BACKUP_DIR, "stories", f));

    const all = await list();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await rm(join(BACKUP_DIR, old), { force: true });
    lastError = null;
  } catch (e) {
    lastError = e.message;
    console.error("النسخة الاحتياطية فشلت:", e.message);
  } finally {
    if (tmp) await rm(tmp, { force: true }).catch(() => {});
  }
}

// يشتغل كل ساعة: إذا ما فيه نسخة لليوم، يسويها
export async function backupIfDue() {
  if (!(await list()).includes(`insta-${today()}.db`)) await backupNow();
}

export async function backupStatus() {
  const all = await list();
  const last = all.at(-1);
  return {
    dir: BACKUP_DIR.replace(homedir(), "~").replace("~/Library/Mobile Documents/com~apple~CloudDocs", "iCloud Drive"),
    count: all.length,
    last: last ? (await stat(join(BACKUP_DIR, last))).mtimeMs : null,
    error: lastError,
  };
}
