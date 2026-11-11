/**
 * 诊断：找出一种既能保住「纸的厚度」，又不会把票面文字冲淡的投影写法。
 *
 * 现状（ticket-current4.cjs 实测，量的是列表首张 .ticket-name 矩形内最暗值）：
 *   base（is-current：translateY(-3px) + 4 层模糊 box-shadow）  → 252（字被冲淡）
 *   去掉 box-shadow                                              → 74
 *   去掉 transform                                               → 54（正常）
 *   换成普通卡那条 4 层 shadow                                    → 54
 *   换成单层 12px                                                 → 54
 *   加 will-change: transform                                     → 54
 * 同一组参数换个探针跑又变，说明这是合成器里的不稳定路径，不能靠「刚好调对一组
 * 数值」蒙过去。要换的是**投影挂在哪一层**。
 *
 * 候选：
 *   li-shadow   投影挂到 .ticket-grid > li（父级，没有 mask/transform）
 *   no-radius   .ticket 去掉 border-radius
 *   t3d         用 translate3d 抬（强制独立层）
 *   contain      在 .ticket 上加 contain: paint
 *   shadow-2l    只用两层、半径减半
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const VARIANTS = [
  ['base', ''],
  ['li-shadow', `
    .ticket { box-shadow: none !important; }
    .ticket-grid > li { border-radius: var(--ticket-corner); box-shadow: 0 0 4px 0 #3a3021cc, 0 0 12px 0 #4a3f2b9e, 0 0 28px 0 #4a3f2b5c, 0 8px 28px 0 #6b5f4540; }
    .ticket-grid > li:has(.ticket.is-current) { box-shadow: 0 0 4px 0 #3a3021f2, 0 0 12px 0 #4a3f2bc4, 0 0 28px 0 #4a3f2b7a, 0 10px 24px 0 #6b5f4566; }
  `],
  ['no-radius', '.ticket { border-radius: 0 !important; }'],
  ['t3d', '.ticket.is-current { transform: translate3d(0, -3px, 0) !important; }'],
  ['contain', '.ticket { contain: paint !important; }'],
  ['shadow-2l', '.ticket, .ticket.is-current { box-shadow: 0 0 8px 0 #4a3f2b9e, 0 6px 20px 0 #6b5f4540 !important; }'],
];

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2200,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;

  const boxes = await run(`(async () => {
    const card = document.querySelector('.ticket-grid .ticket');
    card.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -70);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const name = card.querySelector('.ticket-name').getBoundingClientRect();
    return {
      current: card.classList.contains('is-current'),
      name: { x: Math.round(name.x), y: Math.round(name.y), w: Math.round(name.width), h: Math.round(name.height) },
    };
  })()`);

  const out = [];
  for (const [label, css] of VARIANTS) {
    await run(`(() => {
      document.getElementById('probe-current5')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-current5';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(260);
    const shot = await win.webContents.capturePage({
      x: boxes.name.x, y: boxes.name.y, width: Math.max(4, boxes.name.w), height: Math.max(4, boxes.name.h),
    });
    const file = `v-cur5-${label}.png`;
    fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
    out.push({ label, file });
  }

  report({ boxes, variants: out });
});
