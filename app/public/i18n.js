// اللغة: عربي أو إنجليزي، تنحفظ في المتصفح وتوصل للخادم بكوكي ia_lang عشان النصائح تجي بنفس اللغة
// الترجمة بالإنجليزي:
//   L("عربي", "English") للنصوص اللي يبنيها الكود
//   i18n({ "نص ثابت": "Static text" }, [[/^(\d+) بوست$/, "$1 posts"]]) قاموس كل صفحة (في public/i18n/)،
//   وأي نص في الصفحة يطابق القاموس يتبدل تلقائياً، حتى اللي ينضاف بعدين
(() => {
  const KEY = "ia_lang";
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  const lang = saved === "en" ? "en" : "ar";
  const setCookie = (v) => (document.cookie = `${KEY}=${v}; Path=/; SameSite=Strict; Max-Age=31536000`);
  setCookie(lang);
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === "en" ? "ltr" : "rtl";
  window.LANG = lang;
  window.L = (ar, en) => (lang === "en" ? en : ar);

  const dict = {}, pats = [];
  window.i18n = (d = {}, p = []) => { Object.assign(dict, d); pats.push(...p); };
  const AR = /[؀-ۿ]/;
  const tr = (s) => {
    if (lang !== "en" || !s || !AR.test(s)) return s;
    const k = s.trim().replace(/\s+/g, " ");
    let v = dict[k] ?? window.I18N_LABELS?.[k];
    if (v == null) for (const [re, rep] of pats) if (re.test(k)) { v = k.replace(re, rep); break; }
    return v == null ? s : s.replace(s.trim(), v);
  };
  window.tr = tr;

  // ما نترجم اللي يكتبه المستخدم أو محتوى انستجرام (كابشن، تعليقات): حطها داخل عنصر فيه data-notr
  const SKIP = "textarea, script, style, [contenteditable], [data-notr]";
  const ATTRS = ["title", "placeholder", "aria-label", "alt"];
  // خانات الكتابة: نترجم التلميح (placeholder) بس، مو اللي مكتوب فيها
  function fixEl(el) {
    if (el.closest?.("script, style, [contenteditable], [data-notr]")) return;
    for (const a of ATTRS) if (el.hasAttribute?.(a)) { const v = el.getAttribute(a), t = tr(v); if (t !== v) el.setAttribute(a, t); }
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit")) { const t = tr(el.value); if (t !== el.value) el.value = t; }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      if (!root.parentElement?.closest(SKIP)) { const t = tr(root.data); if (t !== root.data) root.data = t; }
      return;
    }
    if (root.nodeType !== 1) return;
    fixEl(root);
    if (root.matches(SKIP)) return;
    root.querySelectorAll("*").forEach(fixEl);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (n.parentElement?.closest(SKIP)) continue;
      const t = tr(n.data);
      if (t !== n.data) n.data = t;
    }
  }
  window.trEl = walk;

  function setButtons() {
    document.querySelectorAll("[data-lang-toggle]").forEach((b) => {
      b.textContent = lang === "en" ? "ع" : "EN";
      b.title = lang === "en" ? "العربية" : "English";
      b.setAttribute("aria-label", b.title);
      b.setAttribute("data-notr", "");
    });
  }
  window.toggleLang = () => {
    const next = lang === "en" ? "ar" : "en";
    try { localStorage.setItem(KEY, next); } catch {}
    setCookie(next);
    location.reload();
  };

  addEventListener("DOMContentLoaded", () => {
    setButtons();
    document.querySelectorAll("[data-lang-toggle]").forEach((b) => b.addEventListener("click", toggleLang));
    if (lang !== "en") return;
    document.title = tr(document.title);
    walk(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") walk(m.target);
        else if (m.type === "attributes") fixEl(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  });
})();
