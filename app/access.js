// الدخول من الجوال أو أي جهاز ثاني على نفس الشبكة: يحتاج رمز دخول. من نفس الماك ما يحتاج
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { db } from "./db.js";
import { L } from "./i18n.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at INTEGER, last_seen INTEGER, agent TEXT);
`);

const SESSION_DAYS = 90;
const COOKIE = "ia_session";
export const getSetting = (k) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value;
export const setSetting = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(k, v);

export function accessCode() {
  let code = getSetting("access_code");
  if (!code) setSetting("access_code", (code = String(randomInt(100000, 1000000))));
  return code;
}

// رمز جديد يطلّع كل الأجهزة اللي دخلت قبل
export function newAccessCode() {
  setSetting("access_code", String(randomInt(100000, 1000000)));
  db.prepare("DELETE FROM sessions").run();
  return accessCode();
}

const isLocal = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

function lanAddresses() {
  return Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
}
let localName = null;
try { localName = execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim() + ".local"; } catch {}

// يمنع مواقع ثانية مفتوحة في متصفحك من إنها تكلم الأداة (Host و Origin لازم يكونون الأداة نفسها)
function sameSite(req) {
  const host = (req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  const allowed = ["localhost", "127.0.0.1", "[::1]", ...lanAddresses(), localName?.toLowerCase()].filter(Boolean);
  if (!allowed.includes(host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== "null") {
    try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; }
  }
  // الطلبات اللي تغيّر شي: لازم JSON (الموقع الغريب ما يقدر يرسله بدون إذن المتصفح) وما نقبل Origin: null
  if (!["GET", "HEAD"].includes(req.method)) {
    if (origin === "null") return false;
    // رفع ملف الجدولة (PUT بملف خام): المتصفح ما يسمح لموقع غريب يرسل PUT بدون موافقة الخادم (preflight)، وفحص Origin فوق شغال
    const upload = req.method === "PUT" && /^\/api\/accounts\/[^/]+\/upload(\?|$)/.test(req.url || "");
    if (!upload && !/^application\/json\b/i.test(req.headers["content-type"] || "")) return false;
  }
  return true;
}

function sessionOf(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`${COOKIE}=([a-f0-9]{64})`));
  if (!m) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE token = ?").get(m[1]);
  if (!s || Date.now() / 1000 - s.created_at > SESSION_DAYS * 86400) return null;
  if (Date.now() / 1000 - s.last_seen > 3600) db.prepare("UPDATE sessions SET last_seen = ? WHERE token = ?").run(Math.floor(Date.now() / 1000), s.token);
  return s;
}

// يرجع: "ok" يكمل الطلب، "login" يحتاج دخول، "forbidden" يرفض
export function checkAccess(req, path) {
  if (!sameSite(req)) return "forbidden";
  if (isLocal(req)) return "ok";
  // صفحة الدخول وملفات الثيم واللغة اللي تحتاجها (ما فيها بيانات)
  if (["/login.html", "/api/login", "/theme.js", "/theme.css", "/i18n.js", "/i18n-labels.js", "/i18n/login.js", "/apple-touch-icon.png", "/manifest.json"].includes(path) || path.startsWith("/fonts/")) return "ok";
  return sessionOf(req) ? "ok" : "login";
}

// ٥ محاولات غلط من نفس الجهاز = يقفل ١٠ دقايق
// وقفل عام لكل الأجهزة: ٢٠ محاولة غلط = الدخول يوقف ١٥ دقيقة، ويتضاعف كل مرة (عشان جهاز يغيّر عنوانه ما يقدر يجرب كل الرموز)
const attempts = new Map();
const all = { n: 0, until: 0, lock: 15 * 60000 };
const tooMany = () => Object.assign(new Error(L("محاولات كثيرة غلط. جرّب بعد شوي.", "Too many wrong attempts. Try again later.")), { status: 429 });
export function login(req, res, code) {
  const ip = req.socket.remoteAddress;
  if (all.until > Date.now()) throw tooMany();
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) throw tooMany();
  const want = Buffer.from(accessCode()), got = Buffer.from(String(code || "").trim());
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    a.n++;
    if (a.n >= 5) Object.assign(a, { n: 0, until: Date.now() + 10 * 60000 });
    if (attempts.size > 1000) attempts.clear();
    attempts.set(ip, a);
    if (++all.n >= 20) { all.until = Date.now() + all.lock; all.lock *= 2; all.n = 0; }
    throw Object.assign(new Error(L("الرمز غلط", "Wrong code")), { status: 400 });
  }
  attempts.delete(ip);
  Object.assign(all, { n: 0, lock: 15 * 60000 });
  const token = randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO sessions (token, created_at, last_seen, agent) VALUES (?, ?, ?, ?)").run(token, now, now, String(req.headers["user-agent"] || "").slice(0, 200));
  res.setHeader("set-cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`);
  return { ok: true };
}

export function phoneInfo(port, req) {
  if (!isLocal(req)) throw new Error(L("هذي المعلومات تطلع بس من الماك نفسه", "This is only available on the Mac itself"));
  return {
    urls: [localName && `http://${localName}:${port}`, ...lanAddresses().map((ip) => `http://${ip}:${port}`)].filter(Boolean),
    code: accessCode(),
    devices: db.prepare("SELECT COUNT(*) n FROM sessions").get().n,
  };
}
export const isLocalRequest = isLocal;
