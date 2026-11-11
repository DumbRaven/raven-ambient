/**
 * 只看外观：浮层那张、列表第一张，以及四种版式各一张。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-look.cjs --no-sandbox
 *
 * 两个坑（都踩过）：
 * 1. 浮层一开，暗幕会盖住下面的列表，裁出来只剩一片磨砂 —— 先拍列表，再点开浮层。
 * 2. 「滚动 → 量矩形 → 截图 → 再裁」中间位置会变，截出来的票整体偏一段。
 *    改成 capturePage 直接吃矩形，截图与坐标一次成对。
 * 3. **滚动之后必须等重绘，不能只等两帧**。票根上有 SVG 纸纹滤镜和右缘的扇贝
 *    mask，Chromium 重绘这一块要几百毫秒；只等两帧就 capturePage，截到的是半成品，
 *    字会淡成 138（正常 54），整张票看着像蒙了层白纱。这一条曾让我追着
 *    「墨色被冲淡」改了好几轮 CSS，最后发现是截图时机（tools/probe/ticket-timing.cjs
 *    的读数：2 帧 138 / 400ms 54 / 1600ms 54）。settle 就是为这个留的。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

/** 滚动之后等重绘落定再截，见文件头第 3 条。 */
const SETTLE_MS = 600;

/** 按页面坐标截一块。capturePage 吃的是 DIP，正好和 getBoundingClientRect 同一套。 */
async function shot(win, rect, out) {
  // 先等重绘落定（理由见文件头第 3 条）：滚动/点击之后立刻截，票根上带滤镜与
  // mask 的那一块还是半成品，字会淡掉。
  await wait(SETTLE_MS);
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const width = Math.max(2, Math.round(rect.w));
  const height = Math.max(2, Math.round(rect.h));
  const image = await win.webContents.capturePage({ x, y, width, height });
  fs.writeFileSync(out, image.toPNG());
  const size = image.getSize();
  return { x, y, width, height, got: `${size.width}x${size.height}` };
}

guard(async () => {
  const media = seedImages(40);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;
  const files = [];

  // 列表里第一张票（先滚进视口，票按 16:9 撑高，一屏放不下两张）。
  const listRect = await run(`(async () => {
    const card = document.querySelector('.ticket-grid .ticket');
    card.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -70);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const box = card.getBoundingClientRect();
    return { x: box.x - 10, y: box.y - 10, w: box.width + 20, h: box.height + 20 };
  })()`);
  const one = await shot(win, listRect, path.join(__dirname, 'ticket-card.png'));
  files.push('ticket-card.png');

  // 同一张票，外扩到 34px 再拍一张：纸边外那圈投影要跨 20px 才升到页面底色
  // （参考图 .tools/ref-ticket/ref-1.jpg 实测），10px 的边距把它整个切掉了，
  // 量不出浓度与衰减。
  const wideRect = await run(`(() => {
    const box = document.querySelector('.ticket-grid .ticket').getBoundingClientRect();
    return { x: box.x - 34, y: box.y - 34, w: box.width + 68, h: box.height + 68 };
  })()`);
  const wide = await shot(win, wideRect, path.join(__dirname, 'ticket-edge.png'));
  files.push('ticket-edge.png');

  // 四种版式各一张。版式由文件 id 定死，所以要先问页面里现在有哪几种。
  const layouts = await run(`(() => {
    const seen = new Set();
    for (const li of document.querySelectorAll('.ticket-grid > li')) {
      const layout = li.querySelector('.ticket-panel')?.dataset.layout ?? '';
      if (layout) seen.add(layout);
    }
    return [...seen];
  })()`);

  // 一次只滚一张、滚完立刻截：先滚一圈把所有坐标收下来再逐张截，
  // 页面会停在最后一次滚动的位置，后面几张截到的全是同一张。
  const layoutShots = [];
  for (const layout of layouts) {
    const rect = await run(`(async () => {
      const li = [...document.querySelectorAll('.ticket-grid > li')]
        .find(node => node.querySelector('.ticket-panel')?.dataset.layout === '${layout}');
      if (!li) return null;
      const card = li.querySelector('.ticket');
      card.scrollIntoView({ block: 'center' });
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      const box = card.getBoundingClientRect();
      return { x: box.x - 8, y: box.y - 8, w: box.width + 16, h: box.height + 16 };
    })()`);
    if (!rect) continue;
    const name = `ticket-${layout}.png`;
    const got = await shot(win, rect, path.join(__dirname, name));
    files.push(name);
    layoutShots.push({ layout, ...got });
  }

  // 浮层最后拍：点开之后它盖住整页，先拍别的会全被磨砂盖住。
  await run(`(() => { document.querySelector('.ticket-grid .ticket').click(); return 1; })()`);
  await wait(520);
  const liftRect = await run(`(() => {
    const box = document.querySelector('.ticket-lift').getBoundingClientRect();
    // 外扩：票下面挂着「按住票根往上撕」那行提示（bottom: -26px），
    // 只按票自身裁会把提示切掉一半，看着像票底有脏东西。
    return { x: box.x - 52, y: box.y - 24, w: box.width + 104, h: box.height + 92 };
  })()`);
  const lift = await shot(win, liftRect, path.join(__dirname, 'ticket-lift.png'));
  files.push('ticket-lift.png');

  report({
    listCrop: one,
    edgeCrop: wide,
    liftCrop: lift,
    layouts: layoutShots,
    files,
  });
});
