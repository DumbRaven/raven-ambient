/**
 * 稳定性验证：把候选修复各测三遍，看读数是不是每次都一样。
 *
 * 前面几轮（ticket-current4 / ticket-current5）同一组参数换个探针跑就变，
 * 说明命中的是合成器里一条不稳定的路径，不能只凭一次读数就定方案。
 *
 * 候选：
 *   base      现状
 *   t3d       is-current / hover 的 transform 改成 translate3d，强制独立层
 *   t3d-both  再把 ::before 之外的都清干净（现状已是纯 box-shadow）
 *
 * 每个候选连测 3 次，读数全一致才算过。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const VARIANTS = [
  ['base', ''],
  ['t3d', `
    .ticket.is-current { transform: translate3d(0, -3px, 0) !important; }
    .ticket:hover { transform: translate3d(0, -2px, 0) !important; }
  `],
];

const ROUNDS = 3;

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
      document.getElementById('probe-stable')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-stable';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(300);
    for (let i = 0; i < ROUNDS; i += 1) {
      const shot = await win.webContents.capturePage({
        x: boxes.name.x, y: boxes.name.y, width: Math.max(4, boxes.name.w), height: Math.max(4, boxes.name.h),
      });
      const file = `v-stable-${label}-${i}.png`;
      fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
      out.push({ label, round: i, file });
    }
  }

  report({ boxes, variants: out });
});
