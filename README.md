# محلل انستجرام · Instagram Analyzer

**لوحة تحليل لحسابك في انستجرام، تشتغل على جهازك. مجانية، وبدون ذكاء اصطناعي، وبياناتك ما تطلع من جهازك.**

تقرا أرقام حسابك من انستجرام نفسه، وتقول لك وش ينفع ووش ما ينفع، وتبني لك خطة نشر، وتلقط العملاء من التعليقات، وتساعدك تكتب الكاروسيل والستوري والريل. التثبيت كله يسويه Claude Code عنك.

[English below](#english)

---

## وش تسوي

- **لوحة أرقام:** الوصول والتفاعل والمتابعين لأي فترة، مقارنة بالفترة اللي قبلها.
- **مين جمهورك:** أعمار متابعينك وجنسهم ودولهم ومدنهم، ومين منهم يتفاعل فعلاً.
- **المنافسين:** قارن نفسك بحسابات في مجالك: نموهم، وكم ينشرون، وتفاعل جمهورهم، وبوستاتهم اللي انفجرت (يحتاج صفحة فيسبوك مربوطة بحسابك).
- **الرائج في هاشتاقاتك:** أسرع البوستات انتشار الحين في هاشتاقات مجالك، تتحدث كل ٤ ساعات (نفس ربط فيسبوك حق المنافسين).
- **تابعوك وألغوا:** كم يتابعونك ويلغون كل يوم، وتنبيه لو يوم فيه إلغاء غير عادي مع البوست اللي قبله. وتنبيه لما أحد يحطك بوسم في بوسته.
- **رسالة خاص تلقائية:** اللي يسأل عن السعر بالتعليقات توصله التفاصيل بالخاص خلال دقيقتين.
- **نصائح من أرقامك:** أفضل وقت تنشر فيه، وأي نوع (ريلز، كاروسيل، صورة) يجيب وصول أو عملاء، وأي موضوع ينفع عندك.
- **خطة نشر للأسبوع:** كل يوم بهدفه (جذب، إقناع، بيع)، ووقته، وفكرته، والهاشتاقات.
- **عملاء من التعليقات:** تفرز اللي يسألون عن السعر أو التسجيل، وردود جاهزة، ورسائل خاص للمتابعة، وتذكير باللي ما رديت عليه.
- **صانع الكاروسيل والستوري والريل:** قوالب جاهزة، وفحص للنص، وتصدير الصور بمقاس انستجرام.
- **النشر المجدول:** ريل أو صورة أو كاروسيل ينزل لحاله في الوقت اللي تختاره.
- **تصدير لإكسل:** أرقام أي فترة في ملف واحد، ورقة لكل قسم.
- **تقارير أسبوعية وشهرية**، وأهداف الشهر، وتجارب (جرّب تغيير وشوف نتيجته)، ونسخة احتياطية يومية.
- **من الجوال وتيليجرام:** تفتح اللوحة من جوالك في البيت، وتوصلك التنبيهات على تيليجرام إذا حبيت.
- **عربي وإنجليزي، فاتح وغامق ومودرن 3D.**

## وش تحتاج

- جهاز **ماك** أو **ويندوز**.
- **Claude Code** (يحتاج اشتراك Claude).
- حساب انستجرام **احترافي** (صانع محتوى أو تجاري) و**عام**.
- حساب **فيسبوك** عشان تسوي تطبيق مطوّر مجاني في Meta. Claude يمشي معك فيه خطوة خطوة.

## التثبيت

١. افتح Claude Code واكتب:

```
/plugin marketplace add quraishvoice/insta-analyzer
```

```
/plugin install insta-analyzer@insta-analyzer
```

٢. بعدها قل له: **«ركّب محلل انستجرام»**.

Claude يثبّت الأداة، ويسألك كم سؤال عن مجالك عشان يضبط النصائح والقوالب عليه، ويشغّلها، ويمشي معك في ربط حسابك.

**بعدين:** «حدّث المحلل» يجيب آخر نسخة وبياناتك باقية، و«عدّل مجالي» يغيّر المواضيع والردود، و«الأداة ما تفتح» يفحص ويصلح.

## الخصوصية

- الأداة تشتغل على جهازك بس. ما فيه سيرفر، ولا أحد غيرك يشوف أرقامك، ولا حتى صاحب الأداة.
- التوكن ينحفظ في جهازك، وتنلصقه في اللوحة نفسها. **لا تلصقه في أي محادثة.**
- الأداة تكلم انستجرام (graph.instagram.com) بس، وتيليجرام إذا شغّلته أنت.

## ملاحظات

- الأداة تحدّث أرقامك طول ما جهازك صاحي. إذا سكّرته، تكمّل أول ما تفتحه.
- انستجرام يعطي الوصول اليومي لآخر ٣٠ يوم بس. الأداة تحفظ لقطة كل يوم، فكل ما طالت مدة استخدامك صار عندك تاريخ أطول.
- الأداة مو تابعة لـ Meta أو انستجرام.

الشرح الكامل لكل قسم في [app/README.md](app/README.md).

---

## English

**A local Instagram analytics dashboard. Free, no AI, and your data never leaves your computer.**

It reads your numbers from the Instagram API and gives you rule-based advice, a weekly posting plan, lead tracking from comments, competitor comparison, trending posts in your niche hashtags, ready-made DM replies, a carousel/story/reel builder, weekly and monthly reports, phone access on your home Wi-Fi, and optional Telegram alerts. Arabic and English, with light, dark and modern 3D themes.

**You need:** a Mac or Windows PC, Claude Code, a public Professional (Creator or Business) Instagram account, and a free Meta developer app (Claude walks you through it).

**Install:** in Claude Code run `/plugin marketplace add quraishvoice/insta-analyzer`, then `/plugin install insta-analyzer@insta-analyzer`, then say "install the Instagram analyzer". Claude installs it, tunes it to your niche with a few questions, starts it in the background, and helps you connect your account. Paste your access token into the dashboard, never into a chat.

Not affiliated with Meta or Instagram. See [LICENSE](LICENSE).
