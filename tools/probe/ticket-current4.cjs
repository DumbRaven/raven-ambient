/**
 * 诊断：`.ticket` 自己的 box-shadow 挪好之后，为什么**只有** is-current 那张
 * 还是浅的（列表首张 135，普通卡 68，浮层 54）。
 *
 * 现在 is-current 上有两样东西：transform: translateY(-3px)、以及一条更深
 * 的 box-shadow。逐个关掉看读数。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const VARIANTS = [
  ['base', ''],
  ['cur-no-shadow', '.ticket.is-current { box-shadow: none !important; }'],
  ['cur-no-transform', '.ticket.is-current { transform: none !important; }'],
  ['cur-shadow-plain', '.ticket.is-current { box-shadow: 0 0 4px 0 #3a3021cc, 0 0 12px 0 #4a3f2b9e, 0 0 28px 0 #4a3f2b5c, 0 8px 28px 0 #6b5f4540 !important; }'],
  ['cur-shadow-one', '.ticket.is-current { box-shadow: 0 0 12px 0 #4a3f2b9e !important; }'],
  ['cur-wc', '.ticket.is-current { will-change: transform; }'],
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
      document.getElementById('probe-current4')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-current4';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(260);
    const shot = await win.webContents.capturePage({
      x: boxes.name.x, y: boxes.name.y, width: Math.max(4, boxes.name.w), height: Math.max(4, boxes.name.h),
    });
    const file = `v-cur4-${label}.png`;
    fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
    out.push({ label, file });
  }

  report({ boxes, variants: out });
});
