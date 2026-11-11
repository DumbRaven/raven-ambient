/**
 * 诊断：票根左缘那条 2px 深线是谁画的。
 *
 * 现象：截图 y=100 行 x=504..505 是两条完全相同的 (133,133,133)，
 * x=506 起直接跳到纸面 (248,244,236)。两个像素值完全一致说明是同一层
 * 纯色渲染，不是渐变中的两格。
 *
 * 做法：依次关掉可疑的三层（纸纹滤镜、mask、暗带背景），每关一层截一张，
 * 让像素自己说话。
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

  const rect = await run(`(async () => {
    const card = document.querySelector('.ticket-grid .ticket');
    card.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -70);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const b = card.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  })()`);

  const variants = [
    ['base', ''],
    ['no-filter', '.ticket-panel { filter: none !important; }'],
    ['no-mask', '.ticket-panel { mask-image: none !important; -webkit-mask-image: none !important; }'],
    ['no-bg', '.ticket { background-image: none !important; }'],
    ['no-gap', '.ticket { gap: 0 !important; }'],
  ];

  const out = [];
  for (const [name, css] of variants) {
    await run(`(() => {
      document.getElementById('probe-x')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-x';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(260);
    const image = await win.webContents.capturePage({
      x: rect.x + Math.round(rect.w * 0.66), y: rect.y + 80, width: 60, height: 40,
    });
    const file = path.join(__dirname, `edge-${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    out.push({ name, file: `edge-${name}.png` });
  }

  report({ rect, variants: out });
});
