/**
 * 诊断：`.ticket.is-current` 为什么还在把墨色冲淡。
 *
 * 上一轮已经删掉了它的 `filter: drop-shadow(...)`（ticket-current.cjs：
 * 去掉 filter 后 253→88，还不够），改成了 `::before` 的 box-shadow。
 * 现在 base 仍是 253，而 strip-current（整个把 is-current 类摘掉）是 54。
 *
 * 那就把 is-current 上剩下的两项拆开单独试：
 *   - transform: translateY(-3px)
 *   - ::before 的 box-shadow（4 层）
 * 看是哪一项把祖先变成「会触发磨砂路径」的东西。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const VARIANTS = [
  ['base', ''],
  ['no-transform', '.ticket.is-current { transform: none !important; }'],
  ['shadow-none', '.ticket.is-current::before { box-shadow: none !important; }'],
  ['no-both', '.ticket.is-current { transform: none !important; }\n.ticket.is-current::before { box-shadow: none !important; }'],
  ['will-change', '.ticket.is-current { will-change: transform !important; }'],
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
      document.getElementById('probe-current2')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-current2';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(240);
    const shot = await win.webContents.capturePage({
      x: boxes.name.x, y: boxes.name.y, width: Math.max(4, boxes.name.w), height: Math.max(4, boxes.name.h),
    });
    const file = `v-cur2-${label}.png`;
    fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
    out.push({ label, file });
  }

  report({ boxes, variants: out });
});
