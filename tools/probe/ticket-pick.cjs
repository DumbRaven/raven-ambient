/**
 * 筛「扇贝 mask 与墨色」的正确组合（修好版：每次重绘后重新量矩形）。
 *
 * 上一版用 `body.style.display = 'none'` 强制重绘，副作用是滚动位置被重置，
 * 截图矩形落在空白处，八个变体全读成 181。这里改成重绘后重新查询
 * `.ticket-name` 的矩形，并把它 scrollIntoView 一遍再量。
 *
 * 背景：只要 `.ticket-panel` 上挂 mask，且祖先 `.ticket` 上有 box-shadow，
 * 列表里票根的字就会被冲淡（`.ticket-name` 最暗 128，正常 54）；
 * 浮层没有这个问题，因为它走的是 filter 而非 box-shadow。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const VARIANTS = [
  ['base', ''],
  ['mask-on-before', `
    .ticket-panel { mask-image: none !important; isolation: auto !important; }
    .ticket-panel::before { -webkit-mask-image: var(--probe-mask); mask-image: var(--probe-mask);
      -webkit-mask-size: 100% var(--ticket-step); mask-size: 100% var(--ticket-step);
      -webkit-mask-repeat: repeat-y; mask-repeat: repeat-y; }
  `],
  ['no-mask', '.ticket-panel { mask-image: none !important; }'],
  ['no-shadow', '.ticket { box-shadow: none !important; }'],
  ['shadow-on-li', `.ticket { box-shadow: none !important; }
    .ticket-grid > li { box-shadow: 0 0 4px 0 #3a3021cc, 0 0 12px 0 #4a3f2b9e, 0 0 28px 0 #4a3f2b5c, 0 8px 28px 0 #6b5f4540; }`],
  ['before-nofilter', '.ticket-panel::before { filter: none !important; }'],
];

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2200,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;

  await run(`(() => {
    const panel = document.querySelector('.ticket-panel');
    const cs = getComputedStyle(panel);
    document.documentElement.style.setProperty('--probe-mask', cs.maskImage);
    return cs.maskImage.slice(0, 60);
  })()`);

  const out = [];
  for (const [label, css] of VARIANTS) {
    const box = await run(`(async () => {
      document.getElementById('probe-pick')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-pick';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      await new Promise(done => setTimeout(done, 260));
      const card = document.querySelector('.ticket-grid .ticket');
      const name = card.querySelector('.ticket-name');
      name.scrollIntoView({ block: 'center' });
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      const r = name.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    await wait(220);
    const shot = await win.webContents.capturePage({
      x: box.x, y: box.y, width: Math.max(4, box.w), height: Math.max(4, box.h),
    });
    const file = `v-pick-${label}.png`;
    fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
    out.push({ label, box, file });
  }

  report({ variants: out });
});
