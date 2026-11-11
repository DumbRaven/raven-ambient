/**
 * 诊断：票根上的墨色为什么渲成了浅灰。
 *
 * 现象：截图像素量得 mine 片名最暗 (152,148,140)，参考图 (52,44,29)。
 * 纸面 mine 242 / 参考 232，整体像是被半透明白冲淡了一半。
 *
 * 做法：dump .ticket-panel 与 .ticket-name 的 computed（opacity / filter /
 * color / mix-blend-mode），再依次禁掉 filter 与 mask 截图量墨色。
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

  const styles = await run(`(() => {
    const card = document.querySelector('.ticket-grid .ticket');
    const panel = card.querySelector('.ticket-panel');
    const name = card.querySelector('.ticket-name');
    const mark = card.querySelector('.ticket-mark');
    const pick = el => {
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        opacity: cs.opacity,
        filter: String(cs.filter).slice(0, 50),
        mask: String(cs.maskImage || cs.webkitMaskImage).slice(0, 50),
        mix: cs.mixBlendMode,
        webkitTextFill: cs.webkitTextFillColor,
        bg: cs.backgroundColor,
        bgImg: cs.backgroundImage === 'none' ? 'none' : 'none-with-img',
      };
    };
    return {
      panel: pick(panel),
      name: pick(name),
      mark: pick(mark),
      ticket: pick(card),
      paperFilter: !!document.getElementById('tpl-ticket-paper'),
    };
  })()`);

  const rect = await run(`(async () => {
    const card = document.querySelector('.ticket-grid .ticket');
    card.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -70);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const b = card.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  })()`);

  const shots = [];
  const variants = [
    ['ink-base', ''],
    ['ink-nofilter', '.ticket-panel { filter: none !important; }'],
    ['ink-nomask', '.ticket-panel { mask-image: none !important; -webkit-mask-image: none !important; }'],
    ['ink-both', '.ticket-panel { filter: none !important; mask-image: none !important; -webkit-mask-image: none !important; }'],
  ];
  for (const [name, css] of variants) {
    await run(`(() => {
      document.getElementById('probe-ink')?.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'probe-ink';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return 1;
    })()`);
    await wait(240);
    const file = path.join(__dirname, name + '.png');
    const image = await win.webContents.capturePage({
      x: rect.x + Math.round(rect.w * 0.73), y: rect.y + 80, width: 160, height: 80,
    });
    fs.writeFileSync(file, image.toPNG());
    shots.push(name + '.png');
  }

  report({ styles, rect, shots });
});
