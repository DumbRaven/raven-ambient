/**
 * 诊断：列表首张（.ticket.is-current）的墨色为什么比浮层浅。
 *
 * 浮层 ticket-lift.png 里片名是深棕，列表 ticket-card.png 里同一处字色
 * 只有 rgb(130,125,115)。两者结构差异只有一个：列表首张带 .ticket.is-current，
 * 而那次修改把选中态从 inset 描边换成了 transform + filter: drop-shadow。
 * 祖先带 filter、后代带 mask，可能又踩到 ink2/ink3 测过的那个组合。
 *
 * 这个探针注入三个变体各截一次 .ticket-name 矩形，量最暗的 5%。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const VARIANTS = [
  ['base', ''],
  ['no-current-filter', '.ticket.is-current { filter: none !important; }'],
  ['no-current-all', '.ticket.is-current { filter: none !important; transform: none !important; }'],
  ['strip-current', '.ticket { filter: drop-shadow(0 0 2px #3a3021cc) !important; }'],
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
      document.getElementById('probe-current')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-current';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(240);
    const shot = await win.webContents.capturePage({
      x: boxes.name.x, y: boxes.name.y, width: Math.max(4, boxes.name.w), height: Math.max(4, boxes.name.h),
    });
    const file = `v-current-${label}.png`;
    fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
    out.push({ label, file });
  }

  report({ boxes, variants: out });
});
