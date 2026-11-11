/**
 * 诊断：票根上的字渲成浅灰（最暗 209），但 computed color 是深的 rgb(61,53,38)。
 *
 * 已确认：
 *  - 纸色伪元素不是元凶（display:none 后仍 209）
 *  - 纸纹 filter 不是元凶（关掉无变化）
 *  - 祖先链上 opacity 全 1、filter 全 none
 *  - 强行 color:#0033cc 后能渲成深蓝（53）
 *
 * 本探针只做一件事：逐条单独注入，看哪一条能把深墨色找回来。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const OUT = path.join(__dirname, '..', '..', 'tools', 'probe');

const CASES = [
  ['base', ''],
  ['color-same', `.ticket-name { color: #3d3526 !important; -webkit-text-fill-color: #3d3526 !important; }`],
  ['color-ink-var', `.ticket-name { -webkit-text-fill-color: var(--ticket-ink) !important; }`],
  ['no-clamp', `.ticket-name { -webkit-line-clamp: unset !important; display: block !important; }`],
  ['no-isolate', `.ticket-panel { isolation: auto !important; }`],
  ['no-radius', `.ticket-panel { border-radius: 0 !important; }`],
  ['no-paper', `.ticket-panel::before { display: none !important; }`],
  ['no-frame', `.ticket-panel::after { display: none !important; }`],
  ['no-untis', `.ticket-panel, .ticket-panel * { unicode-bidi: normal !important; }`],
  ['panel-textfill', `.ticket-panel { -webkit-text-fill-color: #3d3526 !important; }`],
];

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2400,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;

  const out = {};
  for (const [name, css] of CASES) {
    await run(`(() => {
      const old = document.getElementById('dbg');
      if (old) old.remove();
      if (${JSON.stringify(css)}) {
        const s = document.createElement('style');
        s.id = 'dbg';
        s.textContent = ${JSON.stringify(css)};
        document.head.appendChild(s);
      }
      return true;
    })()`);
    await wait(280);
    const r = await run(`(() => {
      const n = document.querySelector('.ticket-grid .ticket .ticket-name');
      const b = n.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    })()`);
    const png = await win.webContents.capturePage({ x: r.x, y: r.y, width: r.w, height: r.height });
    const file = path.join(OUT, 'inkcase-' + name + '.png');
    fs.writeFileSync(file, png.toPNG());
    out[name] = file;
  }

  report({ cases: Object.keys(out) });
});
