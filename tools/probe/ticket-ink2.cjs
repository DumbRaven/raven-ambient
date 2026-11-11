/**
 * 诊断：票根整体被冲淡，是 filter 还是 mask 的锅。
 *
 * 现象：ticket-card.png 里纸面 (248,244,236) 比 --paper #efe8d8 (239,232,216) 还亮，
 * 墨色最暗只有 152（参考图 52）。整块像是被 40% 的浅色冲淡了。
 *
 * 做法：对准 .ticket-name 的矩形截图，四个变体（都开 / 只 mask / 只 filter / 都关），
 * 每个变体量矩形内最暗的 1% 像素。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

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

  const variants = [
    ['both', ''],
    ['mask-only', '.ticket-panel { filter: none !important; }'],
    ['filter-only', '.ticket-panel { mask-image: none !important; -webkit-mask-image: none !important; }'],
    ['neither', '.ticket-panel { filter: none !important; mask-image: none !important; -webkit-mask-image: none !important; }'],
  ];

  const out = [];
  for (const [name, css] of variants) {
    await run(`(() => {
      document.getElementById('probe-ink2')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-ink2';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(240);
    const file = path.join(__dirname, `inkX-${name}.png`);
    const image = await win.webContents.capturePage({
      x: boxes.name.x, y: boxes.name.y, width: Math.max(4, boxes.name.w), height: Math.max(4, boxes.name.h),
    });
    fs.writeFileSync(file, image.toPNG());
    out.push({ name, file: `inkX-${name}.png` });
  }

  report({ boxes, variants: out });
});
