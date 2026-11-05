// قاعدة بيانات محلية (SQLite) تحفظ الحسابات والبوستات واللقطات اليومية
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data/stories", { recursive: true });
export const db = new DatabaseSync("data/insta.db");

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT,
    name TEXT,
    picture TEXT,
    token TEXT,
    token_expires INTEGER,
    business TEXT,          -- وصف النشاط والجمهور
    goal TEXT,              -- هدف الحساب
    followers INTEGER,
    online_followers TEXT,  -- JSON: متوسط تواجد المتابعين لكل ساعة
    is_demo INTEGER DEFAULT 0,
    last_sync INTEGER
  );

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    caption TEXT,
    media_type TEXT,        -- IMAGE | VIDEO | CAROUSEL_ALBUM
    product_type TEXT,      -- FEED | REELS | STORY
    media_url TEXT,
    thumbnail_url TEXT,
    permalink TEXT,
    timestamp TEXT,
    likes INTEGER, comments INTEGER, views INTEGER, reach INTEGER,
    saved INTEGER, shares INTEGER, total_interactions INTEGER,
    profile_visits INTEGER, follows INTEGER,
    avg_watch_time REAL,    -- بالثواني (ريلز فقط)
    synced_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS media_account_time ON media(account_id, timestamp);

  -- الستوري: Meta تمسح أرقامها بعد 24 ساعة، فنحفظ آخر قراءة لها هنا
  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    media_type TEXT,
    caption TEXT,
    permalink TEXT,
    timestamp TEXT,
    image TEXT,             -- اسم ملف الصورة المحفوظة في data/stories
    views INTEGER, reach INTEGER, replies INTEGER, shares INTEGER,
    follows INTEGER, profile_visits INTEGER, link_clicks INTEGER, total_interactions INTEGER,
    taps_forward INTEGER, taps_back INTEGER, exits INTEGER, swipes INTEGER,
    synced_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS stories_account_time ON stories(account_id, timestamp);

  -- التعليقات: نفرزها عشان نطلع اللي فيها نية شراء ونعرف إذا رديت عليها
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    media_id TEXT,
    username TEXT,
    text TEXT,
    timestamp TEXT,
    intent TEXT,            -- سعر | تسجيل | سؤال | null
    replied INTEGER DEFAULT 0,  -- رديت عليه من حسابك
    handled INTEGER DEFAULT 0   -- علّمته «تم» من اللوحة
  );
  CREATE INDEX IF NOT EXISTS comments_account_time ON comments(account_id, timestamp);

  -- التسجيلات والمبيعات: تدخلها يدوياً، والأداة تربطها بالبوستات اللي نزلت قبلها
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT,
    date TEXT,              -- YYYY-MM-DD بتوقيتك
    count INTEGER,          -- عدد المسجلين
    amount REAL,            -- المبلغ بالريال (اختياري)
    source TEXT,            -- من وين جا: بوست، ستوري، الخاص، واتساب…
    media_id TEXT,          -- البوست اللي جابه إذا تعرفه
    note TEXT,
    created_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS sales_account_date ON sales(account_id, date);

  -- أرقام البوستات الجديدة في أول ساعات نشرها (لقطة كل دقيقتين) عشان نقارن البداية بعادتك
  CREATE TABLE IF NOT EXISTS snapshots (
    media_id TEXT,
    account_id TEXT,
    age_min INTEGER,        -- كم دقيقة مرت على النشر
    reach INTEGER, views INTEGER, saved INTEGER, shares INTEGER, profile_visits INTEGER,
    PRIMARY KEY (media_id, age_min)
  );

  -- التنبيهات اللي وصلتك (عشان ما يتكرر نفس التنبيه وتشوفها في اللوحة)
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT,
    media_id TEXT,
    kind TEXT,
    title TEXT,
    body TEXT,
    created_at INTEGER,
    UNIQUE (account_id, kind)
  );

  -- ردود جاهزة على التعليقات لكل نوع ({user} = يوزر صاحب التعليق)
  CREATE TABLE IF NOT EXISTS reply_templates (
    account_id TEXT,
    intent TEXT,            -- سعر | تسجيل | سؤال
    text TEXT,
    PRIMARY KEY (account_id, intent)
  );

  -- لقطة يومية للحساب: عدد المتابعين + الوصول والمشاهدات لذاك اليوم
  CREATE TABLE IF NOT EXISTS daily (
    account_id TEXT,
    date TEXT,
    followers INTEGER,
    new_followers INTEGER,
    reach INTEGER,
    views INTEGER,
    profile_views INTEGER,
    link_taps INTEGER,
    PRIMARY KEY (account_id, date)
  );
`);

export function upsert(table, row, keys) {
  const cols = Object.keys(row);
  const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})
    ON CONFLICT (${keys.join(",")}) DO ${updates.length ? "UPDATE SET " + updates.join(",") : "NOTHING"}`;
  db.prepare(sql).run(...cols.map((c) => row[c] ?? null));
}

// أعمدة انضافت بعد أول نسخة
for (const sql of ["ALTER TABLE accounts ADD COLUMN comments_ok INTEGER", "ALTER TABLE alerts ADD COLUMN link TEXT",
  "ALTER TABLE media ADD COLUMN duration REAL" /* طول الريل بالثواني (من ملف الفيديو) */,
  "ALTER TABLE media ADD COLUMN trial INTEGER DEFAULT 0" /* ريل تجريبي (Trial) يطلع لغير المتابعين بس، ينستثنى من الأرقام لين ينتقل للعامة */,
  "ALTER TABLE accounts ADD COLUMN last_full_sync INTEGER" /* آخر مزامنة كاملة (last_sync يتحدث مع التحديث الخفيف بعد) */,
  "ALTER TABLE daily ADD COLUMN link_ok INTEGER" /* ١ = أرقام اليوم محسوبة صح (نقرات رابط البايو، وبنفس تاريخ Meta) */,
  "ALTER TABLE daily ADD COLUMN follows INTEGER" /* كم واحد تابعك ذاك اليوم */,
  "ALTER TABLE daily ADD COLUMN unfollows INTEGER" /* كم واحد ألغى متابعتك (أو طلع من انستجرام) */]) {
  try { db.exec(sql); } catch {}
}

// تصحيح لمرة وحدة: الوصول والمتابعين الجدد كانوا ينحفظون بتاريخ اليوم اللي بعده (end_time من Meta)،
// فنرجّعهم يوم، ونخلي المشاهدات والزيارات ونقرات الرابط تنطلب من جديد بنفس تاريخ Meta
db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'daily_dates_v2'").get()) {
  db.exec("BEGIN");
  try {
    db.exec(`CREATE TEMP TABLE shifted AS SELECT account_id, date(date, '-1 day') date, reach, new_followers FROM daily WHERE reach IS NOT NULL OR new_followers IS NOT NULL`);
    db.exec("UPDATE daily SET reach = NULL, new_followers = NULL, link_ok = NULL");
    db.exec(`INSERT INTO daily (account_id, date, reach, new_followers) SELECT account_id, date, reach, new_followers FROM shifted WHERE true
      ON CONFLICT (account_id, date) DO UPDATE SET reach = excluded.reach, new_followers = excluded.new_followers`);
    db.exec("DROP TABLE shifted");
    db.prepare("INSERT INTO settings (key, value) VALUES ('daily_dates_v2', '1')").run();
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); console.error("تصحيح تواريخ الأرقام اليومية ما تم:", e.message); }
}
