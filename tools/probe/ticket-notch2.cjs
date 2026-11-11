/**
 * 诊断：缺口洞里透出的到底是哪一层。
 *
 * 现象：.ticket::before 右缘渐变的起点 alpha 是 0.77，但截图里缺口
 * 只比纸暗 0.41 的等效浓度。要么那层没盖住，要么有别的层在它上面。
 *
 * 做法：把 ::before 的背景强制改成纯红，再截图看洞变不变红。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools/probe\ticket-notch2.cjs --no-sandbox
 */
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');
const fs = require('node:fs');

guard(async () => {
  const media = seedImages(40);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run } = probe;

  const rect = await run(`(() => {
    const li = document.querySelector('.ticket-grid > li');
    const t = li.querySelector('.ticket');
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  })()`);

  // 注入一条只影响第一张票的规则：把垫底层染成纯红
  await run(`(() => {
    const s = document.createElement('style');
    s.id = 'probe-red';
    s.textContent = '.ticket::before { background: #ff0000 !important; }';
    document.head.appendChild(s);
    return 1;
  })()`);
  await new Promise(r => setTimeout(r, 400));

  const png = (await probe.win.webContents.capturePage()).toPNG();
  fs.writeFileSync('tools/probe/notch-red.png', png);

  const crop = await probe.win.webContents.capturePage({
    x: rect.x - 4, y: rect.y - 4, width: rect.w + 8, height: rect.h + 8,
  }).then(i => i.getSize());
  await probe.win.webContents.capturePage({
    x: rect.x - 4, y: rect.y - 4, width: rect.w + 8, height: rect.h + 8,
  }).then(i => fs.writeFileSync('tools/probe/notch-red-crop.png', i.toPNG()));

  report({ rect, crop });
});
