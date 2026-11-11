/**
 * 诊断：把「纸的厚度投影」从 `.ticket::before`（绝对定位伪元素 + 大半径
 * box-shadow）换成 `.ticket` 自己的 box-shadow，能否绕开那条会冲淡文字的
 * 合成路径，并且视觉上不打折。
 *
 * 背景：`.ticket.is-current` 一旦 transform，加上 `::before` 的多层大模糊
 * box-shadow，面板上的扇贝 mask 就会把子内容一起卷进去算，字被冲成一片白
 * （ticket-current2.cjs：base 249 / 去掉 transform 78 / 去掉 shadow 54）。
 *
 * 候选：
 *   A  投影挪到 .ticket 自身（border-radius 跟随票角），::before 删掉
 *   B  A + 保持 will-change
 *
 * 同时截「当前卡」与「普通卡」两处，确认两种状态下墨色都正常。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const SHADOW = [
  '0 0 4px 0 #3a3021cc',
  '0 0 12px 0 #4a3f2b9e',
  '0 0 28px 0 #4a3f2b5c',
  '0 8px 28px 0 #6b5f4540',
].join(', ');

const VARIANTS = [
  ['base', ''],
  ['self-shadow', `.ticket { border-radius: var(--ticket-corner); box-shadow: ${SHADOW}; }
                   .ticket::before { display: none !important; }`],
  ['self-shadow-wc', `.ticket { border-radius: var(--ticket-corner); box-shadow: ${SHADOW}; will-change: transform; }
                      .ticket::before { display: none !important; }`],
  ['self-shadow-strong', `.ticket { border-radius: var(--ticket-corner); box-shadow: 0 0 4px 0 #3a3021f2, 0 0 12px 0 #4a3f2bc4, 0 0 28px 0 #4a3f2b78, 0 10px 30px 0 #6b5f4560; }
                          .ticket::before { display: none !important; }`],
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
    return {
      current: card.classList.contains('is-current'),
      name: { x: Math.round(name.x), y: Math.round(name.y), w: Math.round(name.width), h: Math.round(name.height) },
      card: (() => { const r = card.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    };
  })()`);

  const out = [];
  for (const [label, css] of VARIANTS) {
    await run(`(() => {
      document.getElementById('probe-selfshadow')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-selfshadow';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(260);
    for (const [which, box] of [['name', boxes.name], ['card', boxes.card]]) {
      const shot = await win.webContents.capturePage({
        x: box.x, y: box.y, width: Math.max(4, box.w), height: Math.max(4, box.h),
      });
      const file = `v-self-${label}-${which}.png`;
      fs.writeFileSync(path.join(__dirname, file), shot.toPNG());
      out.push({ label, which, file });
    }
  }

  report({ boxes, variants: out });
});
