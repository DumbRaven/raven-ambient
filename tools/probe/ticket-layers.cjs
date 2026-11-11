/**
 * 诊断：.ticket 上的 drop-shadow 层数对后代墨色的影响。
 *
 * ticket-current.cjs 已经量到：带 .ticket.is-current 的四层 drop-shadow 时，
 * .ticket-name 矩形内最暗 253（字几乎被推走）；换成单层后回到 54。
 * 说明「祖先 filter 的层数」与「后代 mask」在这版 Chromium 上互相干扰。
 *
 * 这里逐层测，找出既能保住纸边柔影、又不冲淡文字的最大层数。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const SHADOW = [
  'drop-shadow(0 0 2px #3a3021cc)',
  'drop-shadow(0 0 6px #4a3f2b9e)',
  'drop-shadow(0 0 14px #4a3f2b5c)',
  'drop-shadow(0 4px 14px #6b5f4540)',
];

const VARIANTS = [
  ['1', SHADOW.slice(0, 1).join(' ')],
  ['2', SHADOW.slice(0, 2).join(' ')],
  ['3', SHADOW.slice(0, 3).join(' ')],
  ['4', SHADOW.join(' ')],
  ['none', 'none'],
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
  for (const [label, filter] of VARIANTS) {
    await run(`(() => {
      document.getElementById('probe-layers')?.remove();
      const s = document.createElement('style');
      s.id = 'probe-layers';
      s.textContent = \`.ticket, .ticket.is-current { filter: ${filter} !important; }\`;
      document.head.appendChild(s);
      return 1;
    })()`);
    await wait(240);
    const shot = await win.webContents.capturePage({
      x: boxes.name.x, y: boxes.name.y, width: Math.max(4, boxes.name.w), height: Math.max(4, boxes.name.h),
    });
    const file = `v-layers-${label}.png`;
    fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
    out.push({ label, file });
  }

  report({ boxes, variants: out });
});
