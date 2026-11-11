/**
 * 诊断：纸纹滤镜与扇贝 mask 同时挂在 .ticket-panel 上时的互相破坏。
 *
 * 已量到的事实（同一块文字矩形内，量最暗的 5%）：
 *   都开   → 251（文字被推走了，只剩浅底）
 *   只 mask → 81
 *   只 filter → 48.7（与参考图的 52 一致）
 *   都关   → 50.7
 * 结论：filter 单独没问题，mask 单独也还行，两者同挂一个元素就崩。
 *
 * 这个探针试三种绕法，看哪一种既保住墨色又保住扇贝齿。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const VARIANTS = [
  ['current', ''],
  // A：纹理搬到伪元素，面板只留 mask。
  ['A-pseudo-filter', `
    .ticket-panel { filter: none !important; isolation: isolate; background: none !important; }
    .ticket-panel::before {
      content: ''; position: absolute; inset: 0; z-index: -1;
      background: var(--paper-sheet);
      filter: url(#tpl-ticket-paper);
    }
  `],
  // B：mask 搬到伪元素的父代理上——用 outline 无法实现，改成给面板加一个
  //    带 mask 的兄弟垫片（只测注入效果，不改源码结构）。
  ['B-no-mask', '.ticket-panel { mask-image: none !important; -webkit-mask-image: none !important; }'],
  // C：filter 与 mask 都保留，但把 mask 从 mask-image 换成 clip-path。
  ['C-clip', `
    .ticket-panel { mask-image: none !important; -webkit-mask-image: none !important; }
  `],
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
    const panel = card.querySelector('.ticket-panel').getBoundingClientRect();
    return {
      name: { x: Math.round(name.x), y: Math.round(name.y), w: Math.round(name.width), h: Math.round(name.height) },
      panel: { x: Math.round(panel.x), y: Math.round(panel.y), w: Math.round(panel.width), h: Math.round(panel.height) },
    };
  })()`);

  const out = [];
  for (const [name, css] of VARIANTS) {
    await run(`(() => {
      document.getElementById('probe-ink3')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-ink3';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(260);
    const full = await win.webContents.capturePage({
      x: boxes.panel.x, y: boxes.panel.y, width: boxes.panel.w, height: boxes.panel.h,
    });
    fs.writeFileSync(path.join(__dirname, `v-${name}-panel.png`), full.toPNG());
    const ink = await win.webContents.capturePage({
      x: boxes.name.x, y: boxes.name.y, width: Math.max(4, boxes.name.w), height: Math.max(4, boxes.name.h),
    });
    fs.writeFileSync(path.join(__dirname, `v-${name}-ink.png`), ink.toPNG());
    out.push({ name, panel: `v-${name}-panel.png`, ink: `v-${name}-ink.png` });
  }

  report({ boxes, variants: out });
});
