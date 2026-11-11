/**
 * 诊断续：字在纯红纸上呈浅奶油色（tools/probe/ink-red-pure.png）。
 * 分不清是「纸上盖在字上」还是「字的颜色被换成了浅色」，用三组对照劈开。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const OUT = path.join(__dirname, '..', '..', 'tools', 'probe');

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2200,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;

  const test = async (name, css) => {
    await run(`(() => {
      const old = document.getElementById('dbg');
      if (old) old.remove();
      const s = document.createElement('style');
      s.id = 'dbg';
      s.textContent = ${JSON.stringify(css)};
      document.head.appendChild(s);
      return true;
    })()`);
    await wait(300);
    const r = await run(`(() => {
      const n = document.querySelector('.ticket-grid .ticket .ticket-name');
      const b = n.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    })()`);
    const png = await win.webContents.capturePage({ x: r.x, y: r.y, width: r.w, height: r.h });
    fs.writeFileSync(path.join(OUT, 'inktest-' + name + '.png'), png.toPNG());
    return r;
  };

  // a: 纸面整个隐藏 —— 字下面没有纸了，直接看字本身什么颜色
  await test('nopaper', `.ticket-panel::before { display: none !important; }`);

  // b: 纸面保留但提到最上层 —— 若字被盖住，这里会全变成纸色
  await test('paperon', `.ticket-panel::before { z-index: 1 !important; }`);

  // c: 强制把字刷成纯蓝、关掉所有可能的透明 —— 看字能不能变深
  await test('forceink', `
    .ticket-panel, .ticket-panel * { opacity: 1 !important; filter: none !important; }
    .ticket-panel::before, .ticket-panel::after { display: none !important; }
    .ticket-name { color: #0033cc !important; -webkit-text-fill-color: #0033cc !important; }
  `);

  report({ done: true });
});
