// بنك الأفكار: تكتب الفكرة من اللوحة أو ترسلها للبوت في تيليجرام، وتنصنّف حسب الموضوع
import { db } from "./db.js";
import { topicOf, NICHE_TOPICS } from "./topics.js";
import { L } from "./i18n.js";

db.exec(`CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, text TEXT, source TEXT,
  topic TEXT, status TEXT DEFAULT 'new', created_at INTEGER, used_at INTEGER
)`);
// نعيد تصنيف الأفكار اللي انحفظت «أخرى» بالقاعدة القديمة
for (const x of db.prepare("SELECT id, text FROM ideas WHERE topic = 'أخرى'").all()) {
  const t = topicOf(x.text, true);
  if (t !== "أخرى") db.prepare("UPDATE ideas SET topic = ? WHERE id = ?").run(t, x.id);
}

const now = () => Math.floor(Date.now() / 1000);

export function addIdea(accountId, text, source = "dashboard") {
  const t = String(text || "").trim().slice(0, 1000);
  if (t.length < 3) throw new Error(L("اكتب الفكرة", "Write the idea"));
  const topic = topicOf(t, true);
  const id = Number(db.prepare("INSERT INTO ideas (account_id, text, source, topic, created_at) VALUES (?, ?, ?, ?, ?)").run(accountId, t, source, topic, now()).lastInsertRowid);
  return { id, topic };
}

export function listIdeas(accountId) {
  const all = db.prepare("SELECT * FROM ideas WHERE account_id = ? ORDER BY status = 'used', created_at DESC LIMIT 200").all(accountId)
    .map((x) => ({ ...x, niche: NICHE_TOPICS.has(x.topic) }));
  return { open: all.filter((x) => x.status !== "used"), used: all.filter((x) => x.status === "used").slice(0, 30) };
}

export function setIdea(id, body) {
  if (body.status) db.prepare("UPDATE ideas SET status = ?, used_at = ? WHERE id = ?").run(body.status === "used" ? "used" : "new", body.status === "used" ? now() : null, +id);
  if (typeof body.text === "string" && body.text.trim()) db.prepare("UPDATE ideas SET text = ?, topic = ? WHERE id = ?").run(body.text.trim().slice(0, 1000), topicOf(body.text, true), +id);
  return { ok: true };
}

export function deleteIdea(id) {
  db.prepare("DELETE FROM ideas WHERE id = ?").run(+id);
  return { ok: true };
}

// رسالة من تيليجرام: أي نص = فكرة جديدة، و«/افكار» يرجع آخر ٥
export function ideaFromTelegram(accountId, text) {
  const t = String(text || "").trim();
  if (/^\/(ideas|افكار|أفكار)(\s|@|$)/i.test(t)) {
    const open = listIdeas(accountId).open.slice(0, 5);
    return open.length ? "💡 آخر أفكارك:\n\n" + open.map((x, i) => `${i + 1}. ${x.text.slice(0, 120)}`).join("\n") : "ما عندك أفكار محفوظة للحين. أرسل أي فكرة هنا وتنحفظ.";
  }
  if (/^\/(start|help|مساعدة)/i.test(t)) return "أرسل أي فكرة بوست هنا وتنحفظ في «بنك الأفكار» في اللوحة.\nاكتب /افكار عشان تشوف آخر أفكارك.";
  if (t.startsWith("/")) return null;
  const { topic } = addIdea(accountId, t, "telegram");
  return `💡 انحفظت الفكرة${topic !== "أخرى" ? ` (الموضوع: ${topic})` : ""}. تلقاها في «بنك الأفكار» في اللوحة.`;
}
