/**
 * 拍整页，用来判断「票根该裱在什么底上」——
 * 参考图是米色相册页，票浮在上面；我们这页现在是什么底色。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-page.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(40);
  const probe = await launch({
    width: 1600, height: 1000, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;

  await run(`(() => {
    const card = document.querySelector('.ticket-grid .ticket');
    card.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -120);
    return 1;
  })()`);
  await wait(700);

  const info = await run(`(() => {
    const pick = sel => {
      const node = document.querySelector(sel);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return {
        sel,
        rect: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage.slice(0, 80),
      };
    };
    return {
      body: pick('body'),
      html: pick('html'),
      app: pick('#root > *'),
      room: pick('.media-room'),
      grid: pick('.ticket-grid'),
      theater: pick('.media-theater'),
    };
  })()`);

  const out = path.join(__dirname, 'ticket-page.png');
  const image = await win.webContents.capturePage();
  fs.writeFileSync(out, image.toPNG());

  report({ info, shot: out, size: image.getSize() });
});
