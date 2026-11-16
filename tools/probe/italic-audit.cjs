#!/usr/bin/env node
/**
 * 量拼贴版式里两处 font-style: italic 的**实际**渲染。
 *
 * 背景：`.tmp-italic.cjs` 曾想把 .tpl-badge 的 italic 改成 normal，理由是
 * 「AE 里这层是 PlayfairDisplayRoman-Bold——Roman 是正体」。那个脚本从没跑成，
 * 注释也没落地。现在要判断这个判断对不对，得看真实计算样式：
 *
 *   1. 字体到底解析到了哪个 family（Playfair Display 已装到用户级字体目录，
 *      所以 italic 是**真斜体**，不是浏览器合成的假斜体）
 *   2. 真斜体的字形倾斜度 vs normal 的差别有多大
 *   3. .tpl-fields > div > span 继承的是什么字体（那是中文正文，可能根本
 *      不是 Playfair，那 italic 落在中文上就是合成的）
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/italic-audit.cjs --no-sandbox
 */
const { launch, guard } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ expand: true });
  const { run } = probe;

  const out = await run(`(() => {
    const pick = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        cls: el.className || el.tagName,
        style: s.fontStyle,
        weight: s.fontWeight,
        size: s.fontSize,
        family: s.fontFamily,
        synthesis: s.fontSynthesis,
        text: (el.textContent || '').trim().slice(0, 24),
        box: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      };
    };

    // 1. 竖排 DUMBRAVEN 那枚胶囊
    const badge = document.querySelector('.tpl-badge');
    const badgeLetter = document.querySelector('.tpl-badge-col span span, .tpl-badge span span');

    // 2. 左下 TITLE / FOCUS / PLAYLIST 的值
    const fieldSpan = document.querySelector('.tpl-fields > div > span');
    const fieldB = document.querySelector('.tpl-fields > div > b');
    const listSpan = document.querySelector('.tpl-list > span');

    // 3. 父级容器，看继承源
    const fields = document.querySelector('.tpl-fields');
    const list = document.querySelector('.tpl-list');
    const stage = document.querySelector('.template-collage');

    // 4. 字体是否真的可用（document.fonts 里查）
    const loaded = [];
    try {
      document.fonts.forEach((f) => {
        if (/Playfair/i.test(f.family)) loaded.push({ family: f.family, style: f.style, weight: f.weight, status: f.status });
      });
    } catch (e) { loaded.push({ error: String(e) }); }

    return {
      badge: pick(badge),
      badgeLetter: pick(badgeLetter),
      fieldSpan: pick(fieldSpan),
      fieldB: pick(fieldB),
      listSpan: pick(listSpan),
      fieldsBox: pick(fields),
      listBox: pick(list),
      stageBox: pick(stage),
      playfairFaces: loaded,
      fontsStatus: document.fonts.status,
    };
  })()`);

  console.log('ITALIC-AUDIT ' + JSON.stringify(out, null, 1));
  probe.close();
});
