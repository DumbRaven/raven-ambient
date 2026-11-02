#!/usr/bin/env node
/**
 * 量竖排徽标（DUMBRAVEN 胶囊）的 DOM 结构：胶囊矩形、字号、每列每个字母的位置。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/badge.cjs --no-sandbox
 *
 * 前置：`npm.cmd run build`。
 *
 * **为什么用 DOM 而不是读像素**：像素测量分不清「胶囊底」与「面板外噪点」，
 * 试过三次都不可靠（量出 34% / 19% / 10% 三个假宽度，真值 7.30%）。
 * DOM 直接给 getBoundingClientRect，一次就对。
 *
 * 参考图实测（1917×1072，画布百分比）：
 *   胶囊 88.73 / 8.49，宽 7.30%，高 28.82%
 *   左列 D U M B、右列 R A V E N
 *   右列顶比左列高 37px（左列顶距胶囊顶 85px、右列 48px）
 *   单字母约 35×43px → 字高约 4.0% 画布高
 *   金色 #c48f46
 *
 * 一个反直觉的点：**AE JSON 登记的是 Montserrat-Bold（无衬线），跟参考图对不上**
 * （参考图放大后竖笔全部右倾、是斜体衬线）。那份导出和出图不是同一版，
 * 以参考图像素为准。
 */
const { launch, report, guard, CQW_PROBE } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ expand: true });
  const { run } = probe;

  const cqw = await run(CQW_PROBE);

  const data = await run(`(() => {
    const C = document.querySelector('.template-collage');
    if (!C) return { error: 'no collage' };
    const cb = C.getBoundingClientRect();
    const pct = r => ({
      x: +((r.x - cb.x) / cb.width * 100).toFixed(2),
      y: +((r.y - cb.y) / cb.height * 100).toFixed(2),
      w: +(r.width / cb.width * 100).toFixed(2),
      h: +(r.height / cb.height * 100).toFixed(2),
    });

    const tag = document.querySelector('.tpl-tag');
    if (!tag) return { error: 'no tag' };
    const cs = getComputedStyle(tag);
    const badge = document.querySelector('.tpl-badge');

    const cols = [...document.querySelectorAll('.tpl-badge-col')].map(col => ({
      cls: col.className.replace('tpl-badge-col ', ''),
      text: col.textContent,
      rect: pct(col.getBoundingClientRect()),
      letters: [...col.children].map(el => ({
        ch: el.textContent,
        rect: pct(el.getBoundingClientRect()),
        opacity: +getComputedStyle(el).opacity,
      })),
    }));

    const stars = [...document.querySelectorAll('.tpl-star')].map(el => {
      const s = getComputedStyle(el);
      return {
        cls: el.className.replace('tpl-star ', ''),
        ch: el.textContent,
        rect: pct(el.getBoundingClientRect()),
        fontSize: s.fontSize,
        color: s.color,
      };
    });

    const bs = getComputedStyle(badge);
    return {
      tag: pct(tag.getBoundingClientRect()),
      tagStyle: {
        borderRadius: cs.borderRadius,
        background: cs.backgroundColor,
        display: cs.display,
        alignItems: cs.alignItems,
        justifyContent: cs.justifyContent,
      },
      badgeStyle: {
        display: bs.display,
        alignItems: bs.alignItems,
        fontFamily: bs.fontFamily,
        fontSize: bs.fontSize,
        fontStyle: bs.fontStyle,
        fontWeight: bs.fontWeight,
        lineHeight: bs.lineHeight,
        letterSpacing: bs.letterSpacing,
        columnGap: bs.columnGap,
        color: bs.color,
        textStroke: bs.webkitTextStrokeWidth + ' ' + bs.webkitTextStrokeColor,
      },
      cols,
      stars,
    };
  })()`);

  console.log(JSON.stringify({ cqw, ...data }, null, 1));
  report({});
});
