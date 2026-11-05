// حطوك بوسم: بوستات ناس ثانيين فيها وسم لحسابك (غالباً متدرب يشارك شغله أو أحد يرشحك)
// انستجرام يعطي الوسم بس، مو المنشن داخل الكابشن
import { db, upsert } from "./db.js";
import { ig } from "./instagram.js";
import { save as saveAlert } from "./alerts.js";

db.exec(`CREATE TABLE IF NOT EXISTS tagged (
  id TEXT PRIMARY KEY, account_id TEXT, username TEXT, timestamp TEXT, permalink TEXT, caption TEXT, media_type TEXT)`);

const EVERY = 15 * 60 * 1000; // التحديث الخفيف كل دقيقتين، والوسوم تكفيها كل ربع ساعة
const last = new Map();

export async function syncTagged(acc, token) {
  if (Date.now() - (last.get(acc.id) || 0) < EVERY) return;
  last.set(acc.id, Date.now());
  // أول مرة: نحفظ الموجود بدون تنبيهات، عشان ما يجيك تنبيه على وسوم قديمة
  const first = !db.prepare("SELECT 1 FROM tagged WHERE account_id = ? LIMIT 1").get(acc.id);
  let r;
  try { r = await ig("/me/tags", { fields: "id,username,timestamp,permalink,caption,media_type", limit: 25 }, token); } catch (e) {
    if ([4, 17, 32, 190].includes(e.code)) throw e;
    return console.error("الوسوم:", e.message);
  }
  for (const m of r.data || []) {
    const known = db.prepare("SELECT 1 FROM tagged WHERE id = ?").get(m.id);
    upsert("tagged", { id: m.id, account_id: acc.id, username: m.username, timestamp: m.timestamp, permalink: m.permalink, caption: m.caption || null, media_type: m.media_type }, ["id"]);
    if (known || first || Date.now() - Date.parse(m.timestamp) > 7 * 864e5) continue;
    const cap = (m.caption || "").split("\n")[0].slice(0, 60);
    saveAlert(acc.id, null, `tagged:${m.id}`, `🏷️ @${m.username} حطك بوسم في بوسته`,
      `${cap ? `«${cap}». ` : ""}شاركه في الستوري، أو رد عليه بتعليق يشكره.`, m.permalink);
  }
}

export function taggedList(accountId) {
  return db.prepare("SELECT username, timestamp, permalink, caption, media_type FROM tagged WHERE account_id = ? ORDER BY timestamp DESC LIMIT 12").all(accountId)
    .map((t) => ({ ...t, caption: (t.caption || "").replace(/[\u200e\u200f\u2066-\u2069\t]+/g, " ").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 90) || "" }));
}
