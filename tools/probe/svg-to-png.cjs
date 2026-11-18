// 把 public/landscape.svg 渲成 PNG，给宣传素材当相集画面用。
//
// 为什么不直接给探针塞这张图：探针的 media scheme 只认 PNG/JPEG 这类位图，
// SVG 走不通（ffmpeg 也没有 svg 解码器）。先离屏渲一次拿到位图最省事。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');

app.commandLine.appendSwitch('force-device-scale-factor', '2');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'public', 'landscape.svg'), 'utf8');
  // 滚动条必须禁掉：SVG 本身是 1600×800，窗口按 1920×1080 开，
  // 中间那个 <img> 撑出了横向与纵向滚动条，截图上会留两条灰边。
  const html = `<body style="margin:0;overflow:hidden"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"
    style="width:100vw;height:100vh;object-fit:cover;display:block"></body>`;
  const tmp = path.join(ROOT, '.qa', 'frames', 'ls.html');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({
    width: 1920, height: 1080, show: false,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(tmp);
  await new Promise(r => setTimeout(r, 1500));
  // 离屏窗口的 capturePage() 经常返回 0 字节（update-ui.cjs 里踩过同一个坑），
  // 改走 CDP 的 Page.captureScreenshot。
  const dbg = win.webContents.debugger;
  await dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.data, 'base64');
  const out = path.join(ROOT, '.qa', 'frames', 'landscape.png');
  fs.writeFileSync(out, png);
  console.log('[svg] ', out, png.length);
  app.exit(0);
});
