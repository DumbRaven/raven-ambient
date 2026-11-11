/**
 * 诊断：把 `.ticket` 恒定提升为独立合成层，能不能一次性绕过
 * 「::before 的 box-shadow × 面板 mask」这条会冲淡文字的渲染路径。
 *
 * 上一轮（ticket-current2.cjs）的读数：
 *   base（is-current 带 transform + 深 box-shadow）      → 249
 *   去掉 transform                                        → 78
 *   去掉 ::before 的 box-shadow                           → 54
 *   两个都去掉                                            → 54
 *   只加 will-change: transform（其它不动）                → 54
 * → 触发点确实在合成路径上，不是样式写错。
 *
 * 这一轮验两个候选：
 *   A 永远提升：`.ticket { will-change: transform }`
 *   B 只在当前卡上提升：`.ticket.is-current { will-change: transform }`
 * 另外顺带量一下 hover 态（hover 也会加深 box-shadow，可能踩同一个坑）。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const VARIANTS = [
  ['base', ''],
  ['all-will-change', '.ticket { will-change: transform; }'],
  ['all-backface', '.ticket { backface-visibility: hidden; }'],
  ['cur-only', '.ticket.is-current { will-change: transform; }'],
  ['hover-deep', '.ticket.is-current { transform: none !important; }\n.ticket.is-current::before { box-shadow: inherit !important; }\n.ticket:hover::before { box-shadow: 0 0 4px 0 #3a3021f2, 0 0 12px 0 #4a3f2bc4, 0 0 28px 0 #4a3f2b78, 0 12px 32px 0 #6b5f4560 !important; }'],
];

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2200,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;

  const boxes = await run(`(async () => {
    const cards = document.querySelectorAll('.ticket-grid .ticket');
    const card = cards[0];
    card.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -70);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const name = card.querySelector('.ticket-name').getBoundingClientRect();
    const plain = cards[3].querySelector('.ticket-name').getBoundingClientRect();
    return {
      current: card.classList.contains('is-current'),
      name: { x: Math.round(name.x), y: Math.round(name.y), w: Math.round(name.width), h: Math.round(name.height) },
      plain: { x: Math.round(plain.x), y: Math.round(plain.y), w: Math.round(plain.width), h: Math.round(plain.height) },
    };
  })()`);

  const out = [];
  for (const [label, css] of VARIANTS) {
    await run(`(() => {
      document.getElementById('probe-current3')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-current3';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(240);
    for (const which of ['name', 'plain']) {
      const box = boxes[which];
      const shot = await win.webContents.capturePage({
        x: box.x, y: box.y, width: Math.max(4, box.w), height: Math.max(4, box.h),
      });
      const file = `v-cur3-${label}-${which}.png`;
      fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
      out.push({ label, which, file });
    }
  }

  report({ boxes, variants: out });
});
