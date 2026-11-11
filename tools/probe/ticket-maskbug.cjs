/**
 * 诊断：列表票根里的墨色为什么只有 141（应为 54）。
 *
 * 已经排除了 .ticket 的 drop-shadow（ticket-layers.cjs：去掉之后 253→54）。
 * 现在 .ticket 上已经没有 filter 了，墨色仍旧偏浅，说明还有别的组合在捣鬼。
 * 票根面板上同时挂着 mask（扇贝）、clip-path（圆角）、isolation，
 * 纸色与纸纹挪到了 ::before 上（带 filter: url(#tpl-ticket-paper)）。
 *
 * 逐个拆开，看哪一项压住了文字。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const VARIANTS = [
  ['base', ''],
  ['no-mask', '.ticket-panel { mask-image: none !important; -webkit-mask-image: none !important; }'],
  ['no-clip', '.ticket-panel { clip-path: none !important; }'],
  ['no-isolation', '.ticket-panel { isolation: auto !important; }'],
  ['no-pseudo-filter', '.ticket-panel::before { filter: none !important; }'],
  ['no-pseudo', '.ticket-panel::before { display: none !important; }'],
  ['plain-ink', '.ticket-panel { color: #000 !important; }'],
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
    return { name: { x: Math.round(name.x), y: Math.round(name.y), w: Math.round(name.width), h: Math.round(name.height) } };
  })()`);

  const out = [];
  for (const [label, css] of VARIANTS) {
    await run(`(() => {
      document.getElementById('probe-maskbug')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-maskbug';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(240);
    const shot = await win.webContents.capturePage({
      x: boxes.name.x, y: boxes.name.y, width: Math.max(4, boxes.name.w), height: Math.max(4, boxes.name.h),
    });
    const file = `v-maskbug-${label}.png`;
    fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
    out.push({ label, file });
  }

  report({ boxes, variants: out });
});
