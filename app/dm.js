// رسائل الخاص الجاهزة لمتابعة العملاء: حسب المرحلة، وردود على أكثر الاعتراضات
// {user} = يوزر العميل، و{العرض} {الموعد} {السعر} {الرابط} من «معلومات العرض»
import { db } from "./db.js";
import { L } from "./i18n.js";
import { P } from "./profile.js";

db.exec(`CREATE TABLE IF NOT EXISTS dm_templates (account_id TEXT, key TEXT, text TEXT, PRIMARY KEY (account_id, key))`);

// الاعتراضات ونصوص الرسائل من ملف مجالك (objections و dm و info)
export const DM_KEYS = [
  ["first", "أول رسالة بالخاص", "لمن سأل عن السعر أو التسجيل"],
  ["followup1", "متابعة بعد ٣ أيام", "رديت عليه وما سجّل"],
  ["followup2", "آخر تذكير", "بعد ما تابعته مرة"],
  ...P.objections.map(([k, name]) => [k, name, "اعتراض"]),
];
const info = (k, i, fallback) => P.info[k]?.[i] || fallback;
export const INFO_KEYS = [["العرض", info("العرض", 0, "اسم العرض"), info("العرض", 2, "")], ["الموعد", info("الموعد", 0, "الموعد"), "مثال: الأحد ١٥ نوفمبر"], ["السعر", "السعر", "مثال: ٩٩٩ ريال"], ["الرابط", "الرابط", "https://…"]];

// أسماء الرسائل بالإنجليزي للوحة (نص الرسائل نفسه يظل عربي لأنه يروح لمتابعينك)
const DM_EN = {
  first: ["First DM", "For people who asked about price or sign-up"], followup1: ["Follow-up after 3 days", "You replied and they haven't signed up"],
  followup2: ["Final reminder", "After you've followed up once"],
  ...Object.fromEntries(P.objections.map(([k, , en]) => [k, [en || k, "Objection"]])),
};
const INFO_EN = { "العرض": [info("العرض", 1, "Offer name"), info("العرض", 3, "")], "الموعد": [info("الموعد", 1, "Date"), "e.g. Sunday, Nov 15"], "السعر": ["Price", "e.g. 999 SAR"], "الرابط": ["Link", "https://…"] };

const DEFAULTS = P.dm;

export function getDm(accountId) {
  const saved = Object.fromEntries(db.prepare("SELECT key, text FROM dm_templates WHERE account_id = ?").all(accountId).map((r) => [r.key, r.text]));
  return {
    keys: DM_KEYS.map(([key, name, hint]) => ({ key, name: L(name, DM_EN[key][0]), hint: L(hint, DM_EN[key][1]) })),
    info_keys: INFO_KEYS.map(([key, name, placeholder]) => ({ key, name: L(name, INFO_EN[key][0]), placeholder: L(placeholder, INFO_EN[key][1]) })),
    templates: Object.fromEntries(DM_KEYS.map(([k]) => [k, saved["t:" + k] ?? DEFAULTS[k] ?? ""])),
    info: Object.fromEntries(INFO_KEYS.map(([k, , ph]) => [k, saved["i:" + k] ?? (k === "العرض" ? ph : "")])),
  };
}

export function saveDm(accountId, body) {
  const put = db.prepare("INSERT INTO dm_templates (account_id, key, text) VALUES (?, ?, ?) ON CONFLICT (account_id, key) DO UPDATE SET text = excluded.text");
  const del = db.prepare("DELETE FROM dm_templates WHERE account_id = ? AND key = ?");
  for (const [k] of DM_KEYS) {
    const v = body.templates?.[k];
    if (typeof v !== "string") continue;
    // فاضي = يرجع للنص الافتراضي
    if (v.trim()) put.run(accountId, "t:" + k, v.slice(0, 1000)); else del.run(accountId, "t:" + k);
  }
  for (const [k] of INFO_KEYS) {
    const v = body.info?.[k];
    if (typeof v === "string") put.run(accountId, "i:" + k, v.trim().slice(0, 300));
  }
  return getDm(accountId);
}
