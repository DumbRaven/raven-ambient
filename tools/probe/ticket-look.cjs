/**
 * 只看外观：打开第一张票、停在 idle，把浮层那一块按实际像素裁出来。
 * 顺带在旁边放一张列表里的票，方便对比纸色与齿孔大小。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-look.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

function crop(source, rect, out, width) {
  const [sw, sh] = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', source,
  ]).toString().trim().split(',').map(Number);
  // 必须先夹：元素滚出可视区时 y 会超出图片，ffmpeg 直接 -22 且不写文件。
  const x = Math.max(0, Math.min(Math.round(rect.x), sw - 2));
  const y = Math.max(0, Math.min(Math.round(rect.y), sh - 2));
  const w = Math.max(2, Math.min(Math.round(rect.w), sw - x));
  const h = Math.max(2, Math.min(Math.round(rect.h), sh - y));
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', source, '-vf', `crop=${w}:${h}:${x}:${y},scale=${width}:-2`,
    '-frames:v', '1', out,
  ]);
  return { x, y, w, h };
}

guard(async () => {
  const media = seedImages(8);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;

  // 列表里第一张票的矩形（裁出来看纸色与齿孔）。
  const listRect = await run(`(() => {
    const card = document.querySelector('.ticket-grid .ticket');
    const box = card.getBoundingClientRect();
    return { x: box.x - 10, y: box.y - 10, w: box.width + 20, h: box.height + 20 };
  })()`);

  // 先拍列表：浮层一开，暗幕会盖住下面这一张，裁出来只剩一片磨砂。
  const shot = path.join(__dirname, 'ticket-look.png');
  fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
  const one = crop(shot, listRect, path.join(__dirname, 'ticket-card.png'), 1200);

  await run(`(() => { document.querySelector('.ticket-grid .ticket').click(); return 1; })()`);
  await wait(520);

  const liftRect = await run(`(() => {
    const box = document.querySelector('.ticket-lift').getBoundingClientRect();
    // 外扩 52px：票下面挂着「按住票根往上撕」那行提示（bottom: -26px），
    // 只扩 18px 会把提示裁掉一半，看着像票底有脏东西。
    return { x: box.x - 52, y: box.y - 24, w: box.width + 104, h: box.height + 92 };
  })()`);

  const lifted = path.join(__dirname, 'ticket-looked.png');
  fs.writeFileSync(lifted, (await win.webContents.capturePage()).toPNG());
  const lift = crop(lifted, liftRect, path.join(__dirname, 'ticket-lift.png'), 1200);

  report({ liftRect, liftCrop: lift, listCrop: one, files: ['ticket-lift.png', 'ticket-card.png'] });
});
