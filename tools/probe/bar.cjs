#!/usr/bin/env node
/**
 * 量信息条里三个标签（TITLE / PHOTOGRAPHY / PLAYLIST）的字号与位置，
 * 以及乌鸦、署名、四颗星的实际矩形 —— 用来查「三个标签看起来大小不一」
 * 到底是谁不一样，不要靠看截图猜。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/bar.cjs --no-sandbox
 */
const { launch, guard } = require('./harness.cjs');

const CODE = `(() => {
  const bar = document.querySelector('.tpl-block-bar');
  const box = document.querySelector('.template-collage');
  const bb = bar.getBoundingClientRect();
  const cb = box.getBoundingClientRect();
  const relCanvas = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: +(((r.left - cb.left) / cb.width) * 100).toFixed(2),
      y: +(((r.top - cb.top) / cb.height) * 100).toFixed(2),
      w: +((r.width / cb.width) * 100).toFixed(2),
      h: +((r.height / cb.height) * 100).toFixed(2),
    };
  };
  const relBar = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: +(((r.left - bb.left) / bb.width) * 100).toFixed(2),
      y: +(((r.top - bb.top) / bb.height) * 100).toFixed(2),
      w: +((r.width / bb.width) * 100).toFixed(2),
      h: +((r.height / bb.height) * 100).toFixed(2),
    };
  };
  const tags = [...document.querySelectorAll('.tpl-block-bar .tpl-fields > div > b, .tpl-block-bar .tpl-list > b')];
  return {
    barPx: { w: +bb.width.toFixed(1), h: +bb.height.toFixed(1) },
    tags: tags.map(el => {
      const cs = getComputedStyle(el);
      return {
        text: el.textContent,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        opacity: cs.opacity,
        rectInBar: relBar(el),
      };
    }),
    raven: { inBar: relBar(document.querySelector('.tpl-raven')), canvas: relCanvas(document.querySelector('.tpl-raven')) },
    produced: { canvas: relCanvas(document.querySelector('.tpl-produced')) },
    stars: [...document.querySelectorAll('.tpl-star')].map(el => {
      const cs = getComputedStyle(el);
      return {
        cls: el.className,
        fontSize: cs.fontSize,
        left: cs.left, top: cs.top, transform: cs.transform,
        canvas: relCanvas(el),
      };
    }),
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: true });
  console.log(JSON.stringify(await probe.run(CODE), null, 2));
  await probe.close();
});
