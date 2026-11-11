/**
 * 诊断：票根左缘那条 2px 中性灰（rgb 133,133,133）到底是谁画的。
 *
 * 现象：截图里 .ticket-panel 的最左两列像素是中性灰，既不暖（我的暗带 #241d12
 * 是暖的）也不亮（纸面 248）。中性灰说明它不是任何一层半透明叠出来的。
 *
 * 做法：在面板左缘那一列打点，问 document.elementsFromPoint 有哪些元素盖着，
 * 再逐个 dump 它们的 background / filter / mask / outline。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2200,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run } = probe;

  const info = await run(`(() => {
    const card = document.querySelector('.ticket-grid .ticket');
    const panel = card.querySelector('.ticket-panel');
    const shot = card.querySelector('.ticket-shot');
    const pr = panel.getBoundingClientRect();
    const sr = shot.getBoundingClientRect();
    const x = Math.round(pr.x) + 1;
    const y = Math.round(pr.y + pr.height / 2);
    const stack = document.elementsFromPoint(x, y).slice(0, 6).map(el => {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return {
        cls: el.className && typeof el.className === 'string' ? el.className : el.tagName,
        rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
        bg: cs.backgroundColor,
        bgImg: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage.slice(0, 70),
        border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
        filter: String(cs.filter).slice(0, 60),
        mixBlend: cs.mixBlendMode,
        opacity: cs.opacity,
        outline: cs.outlineWidth + ' ' + cs.outlineColor,
        boxShadow: cs.boxShadow.slice(0, 60),
      };
    });
    return {
      point: [x, y],
      panel: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
      shotRight: Math.round(sr.right),
      gap: Math.round(pr.x - sr.right),
      stack,
    };
  })()`);

  report(info);
});
