// الثيم: فاتح أو غامق بألوان انستجرام، يمشي على إعداد جهازك (لو جهازك على «تلقائي» يصير غامق بالليل وفاتح بالنهار)
// لو اخترت فاتح أو غامق، اختيارك يبقى لين يتغير ثيم جهازك المرة الجاية، وبعدها يرجع يمشي مع الجهاز
// ثيم «مودرن 3D» (غامق زجاجي، بطاقات تميل مع الماوس ورسوم مجسّمة) يبقى لين تغيّره أنت، ما يمشي مع الجهاز
(() => {
  const KEY = "ia_theme", LOOK = "ia_look";
  const sys = matchMedia("(prefers-color-scheme: dark)");
  const sysTheme = () => (sys.matches ? "dark" : "light");
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const clear = () => { try { localStorage.removeItem(KEY); } catch {} };
  const look = () => { try { return localStorage.getItem(LOOK) === "3d" ? "3d" : ""; } catch { return ""; } };
  // الاختيار ينحفظ مع ثيم الجهاز وقتها، فلو الجهاز تغيّر من بعده نرجع للجهاز
  const saved = () => {
    const s = read();
    if (s?.theme && s.sys === sysTheme()) return s.theme;
    if (s) clear();
    return null;
  };
  const current = () => (look() ? "dark" : saved() || sysTheme());
  const choice = () => (look() ? "3d" : current());
  const en = () => document.documentElement.lang === "en";
  const NAMES = { light: ["☀️", "فاتح", "Light"], dark: ["🌙", "غامق", "Dark"], "3d": ["✦", "مودرن 3D", "Modern 3D"] };

  function setRoot() {
    const r = document.documentElement;
    r.dataset.theme = current();
    if (look()) r.dataset.look = "3d"; else delete r.dataset.look;
  }
  function apply() {
    setRoot();
    const [icon, ar, eng] = NAMES[choice()];
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      b.textContent = icon;
      b.title = en() ? `Theme: ${eng}` : `الثيم: ${ar}`;
      b.setAttribute("aria-label", b.title);
      b.setAttribute("aria-haspopup", "menu");
      b.setAttribute("data-notr", "");
    });
    dispatchEvent(new Event("themechange"));
  }

  window.setTheme = (t) => {
    try { if (t === "3d") localStorage.setItem(LOOK, "3d"); else localStorage.removeItem(LOOK); } catch {}
    if (t !== "3d") {
      if (t === sysTheme()) clear();
      else try { localStorage.setItem(KEY, JSON.stringify({ theme: t, sys: sysTheme() })); } catch {}
    }
    apply();
  };
  window.toggleTheme = () => setTheme(current() === "dark" ? "light" : "dark");

  // قائمة صغيرة تحت الزر: فاتح، غامق، مودرن 3D
  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; };
  function openMenu(btn) {
    if (menu) return closeMenu();
    menu = document.createElement("div");
    menu.className = "theme-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-notr", "");
    menu.innerHTML = Object.entries(NAMES).map(([k, [icon, ar, eng]]) =>
      `<button role="menuitemradio" aria-checked="${k === choice()}" data-t="${k}"><span>${icon}</span>${en() ? eng : ar}</button>`).join("");
    document.body.append(menu);
    const r = btn.getBoundingClientRect(), w = menu.offsetWidth;
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]");
      if (b) { setTheme(b.dataset.t); closeMenu(); }
    });
    menu.querySelector('[aria-checked="true"]')?.focus();
  }
  addEventListener("pointerdown", (e) => { if (menu && !e.target.closest(".theme-menu, [data-theme-toggle]")) closeMenu(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  addEventListener("scroll", closeMenu, { passive: true });
  addEventListener("resize", closeMenu);

  // بعض المتصفحات ما تبلّغ لما يتغير ثيم الجهاز والصفحة بالخلفية، فنتأكد كل دقيقة ولما ترجع للصفحة
  let lastSys = sysTheme();
  const check = () => { if (sysTheme() !== lastSys) { lastSys = sysTheme(); clear(); apply(); } };
  sys.addEventListener("change", check);
  setInterval(check, 60e3);
  addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  addEventListener("focus", check);
  setRoot(); // قبل ما تنرسم الصفحة عشان ما تومض

  // مودرن 3D: البطاقة تميل مع الماوس ولمعة تلحقه (بس بالماوس، ومو لو الجهاز طالب حركة أقل)
  const canTilt = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
  const TILT = ".card, .rec, .plan .day";
  let tilted = null, raf = 0, last = null;
  const reset = (el) => { el.style.transform = ""; el.style.removeProperty("--mx"); el.style.removeProperty("--my"); };
  addEventListener("pointermove", (e) => {
    if (!look() || !canTilt.matches || e.pointerType !== "mouse") return;
    const el = e.target.closest?.(TILT);
    if (tilted && tilted !== el) { reset(tilted); tilted = null; }
    if (!el || el.closest("dialog") || e.target.closest(".geo")) { if (tilted) { reset(tilted); tilted = null; } return; } // الخريطة تثبت عشان تأشر على الدولة
    tilted = el; last = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!tilted) return;
      const r = tilted.getBoundingClientRect();
      const x = (last.clientX - r.left) / r.width, y = (last.clientY - r.top) / r.height;
      // البطاقات الكبيرة (رسوم وجداول) تميل شوي بس عشان تنقرا
      const max = r.width > 460 || r.height > 360 ? 2.5 : 9;
      tilted.style.transform = `perspective(900px) rotateX(${((0.5 - y) * max).toFixed(2)}deg) rotateY(${((x - 0.5) * max).toFixed(2)}deg) translateY(-3px)`;
      tilted.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      tilted.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    });
  }, { passive: true });
  document.addEventListener("pointerleave", () => { if (tilted) { reset(tilted); tilted = null; } });
  addEventListener("themechange", () => { if (!look()) document.querySelectorAll(TILT).forEach(reset); });

  // مودرن 3D: تلميح زجاجي بدل تلميح المتصفح لخانات خريطة الأوقات وعلامات الشرح
  const TIP = ".heat .cell[title], .heat .cell[data-tip3d], .tip[title], .tip[data-tip3d]";
  let tipEl = null, tipFor = null;
  const hideTip = () => {
    if (tipFor) { tipFor.title = tipFor.dataset.tip3d; delete tipFor.dataset.tip3d; tipFor = null; }
    tipEl?.remove(); tipEl = null;
  };
  addEventListener("pointerover", (e) => {
    const el = look() && canTilt.matches ? e.target.closest?.(TIP) : null;
    if (el === tipFor) return;
    hideTip();
    if (!el || !el.title) return;
    tipFor = el; el.dataset.tip3d = el.title; el.title = "";
    tipEl = document.createElement("div");
    tipEl.className = "tip3d"; tipEl.textContent = el.dataset.tip3d;
    document.body.append(tipEl);
    const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tipEl.style.top = `${r.top - h - 10 < 8 ? r.bottom + 10 : r.top - h - 10}px`;
  });
  addEventListener("scroll", hideTip, { passive: true });

  addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openMenu(b); }));
    apply();
  });
})();
