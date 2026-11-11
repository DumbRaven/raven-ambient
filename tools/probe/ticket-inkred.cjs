/**
 * 诊断：票根上的字被一层白冲淡（列表里最暗只到 120，参考图 30）。
 *
 * 假设：`.ticket-panel::before`（纸色 + 纸纹）因为带 filter 而自建堆叠上下文，
 * z-index:-1 不再落到内容之下，纸面被画到了字上面。
 *
 * 做法：把 ::before 的背景换成纯红，截图看字上是否蒙红。
 *       再试 z-index 不设 / 设为 0，对比。
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

  const INJECT = `
    const add = css => {
      const s = document.createElement('style');
      s.id = 'dbg';
      s.textContent = css;
      document.head.appendChild(s);
    };
    const clear = () => { const s = document.getElementById('dbg'); if (s) s.remove(); };
  `;

  const shot = async name => {
    await wait(320);
    const rect = await run(`(() => {
      const n = document.querySelector('.ticket-grid .ticket .ticket-name');
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    const png = await win.webContents.capturePage({
      x: rect.x, y: rect.y, width: rect.w, height: rect.h,
    });
    fs.writeFileSync(path.join(OUT, 'ink-red-' + name + '.png'), png.toPNG());
    return rect;
  };

  await run(`(() => { ${INJECT}
    add('.ticket-panel::before { background: #ff0000 !important; filter: none !important; }');
    return true;
  })()`);
  const r1 = await shot('pure');

  await run(`(() => { ${INJECT}
    clear();
    add('.ticket-panel::before { background: #ff0000 !important; filter: none !important; z-index: auto !important; }');
    return true;
  })()`);
  const r2 = await shot('zauto');

  await run(`(() => { ${INJECT}
    clear();
    add('.ticket-panel::before { background: #ff0000 !important; filter: none !important; z-index: 1 !important; }');
    return true;
  })()`);
  const r3 = await shot('zplus');

  report({ r1, r2, r3 });
});
