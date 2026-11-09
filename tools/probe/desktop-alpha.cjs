/**
 * 桌面窗到底透不透：从 Electron 那边问，不只问 CSS。
 *
 * 上一版探针只遍历了 DOM 的祖先链，全绿，但用户看到的还是黑的。
 * 原因是 CSS 之外还有两层可能把画面变黑：
 *   1. BrowserWindow 的 `transparent` / `backgroundColor`；
 *   2. `capturePage()` 的返回是否带 alpha（它默认按窗口合成，
 *      透明窗口抓出来应该带 alpha 通道；写了底色的话 alpha 全是 255）。
 *
 * 这个探针把这两件事分开量：
 *   - `win.transparent` → `win.isTransparent?.()` 或读构造参数（Electron 没暴露 getter，改用截图判）
 *   - 截一张桌面窗，采样若干点的 alpha：全 255 就是「不透明」，
 *     有 < 255 说明窗口真的是透明的。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules/electron/dist/electron.exe tools/probe/desktop-alpha.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { BrowserWindow, app, nativeImage } = require('electron');
const { launch, report, wait, ROOT } = require('./harness.cjs');
const { attachDesktopStage } = require(path.join(ROOT, 'electron', 'desktop-stage.cjs'));

const OUT = path.join(__dirname, 'desktop-alpha.png');

app.whenReady().then(async () => {
  const { win, run } = await launch({ expand: true });
  attachDesktopStage(win);

  // 切到透明版式，这样桌面窗里应该是「一片空 + 两个组件」
  await run(`(() => {
    const target = [...document.querySelectorAll('.theater-templates button')].find(b => b.textContent.includes('透明'));
    target?.click();
    return !!target;
  })()`);
  await wait(600);

  // 透明版式下那颗键就是「放到桌面」（全屏键被它顶替，见 src/MediaRoom.tsx）。
  await run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
  await wait(1600);

  const deskWin = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('desktop.html')) || null;
  if (!deskWin) {
    report({ missing: true });
    return;
  }

  // 等它画完
  await wait(1400);
  const image = await deskWin.webContents.capturePage();
  fs.writeFileSync(OUT, image.toPNG());

  // 逐点采样 alpha。用 nativeImage 的位图：每像素 BGRA 四字节。
  const size = image.getSize();
  const bitmap = image.toBitmap();
  const at = (x, y) => {
    const offset = (y * size.width + x) * 4;
    return { b: bitmap[offset], g: bitmap[offset + 1], r: bitmap[offset + 2], a: bitmap[offset + 3] };
  };

  // 挑几个「本该是空的」位置：四角 + 正中偏上
  const spots = [
    ['topLeft', 12, 12],
    ['topRight', size.width - 12, 12],
    ['bottomLeft', 12, size.height - 12],
    ['center', Math.round(size.width / 2), Math.round(size.height / 2)],
    ['upperCenter', Math.round(size.width / 2), Math.round(size.height * 0.15)],
  ];
  const samples = spots.map(([name, x, y]) => ({ name, x, y, ...at(x, y) }));

  // 整张图的 alpha 直方图：全 255 = 完全不透明
  let minA = 255;
  let maxA = 0;
  let transparentPixels = 0;
  const total = size.width * size.height;
  for (let i = 3; i < bitmap.length; i += 4) {
    const a = bitmap[i];
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (a < 250) transparentPixels += 1;
  }

  report({
    size,
    samples,
    alpha: {
      min: minA,
      max: maxA,
      transparentPixels,
      total,
      share: Number((transparentPixels / total).toFixed(4)),
      verdict: minA < 250 ? '窗口真的透明' : '窗口不透明（底色还在）',
    },
    image: OUT,
  });
}).catch(e => {
  console.error('PROBE_FAIL ' + e.message + '\n' + e.stack);
  app.exit(1);
});
