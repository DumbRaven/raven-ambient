// 读实机 localStorage 里的放映设置与配色设置。
//
// 为什么必须单独一个探针：harness.cjs 在加载时就把 userData 换成临时目录，
// 那里没有用户的 localStorage；而这里要看的恰恰是用户机器上「现在存着什么」。
//
// 跑法：
//   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
//     tools/probe/tone-live.cjs --no-sandbox
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900, height: 700, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));

  const keys = ['raven-stage-tone', 'raven-stage-template', 'raven-cabinet-v2'];
  const out = await win.webContents.executeJavaScript(`(() => {
    const result = {};
    for (const key of ${JSON.stringify(keys)}) result[key] = localStorage.getItem(key);
    result.__allKeys = Object.keys(localStorage);
    return result;
  })()`, true);

  console.log('=== localStorage 全部键 ===');
  console.log(out.__allKeys.join(', '));
  for (const key of keys) {
    console.log('\n=== ' + key + ' ===');
    const raw = out[key];
    if (raw === null) { console.log('(不存在)'); continue; }
    try { console.log(JSON.stringify(JSON.parse(raw), null, 2)); } catch { console.log(raw); }
  }
  fs.writeFileSync(path.join(ROOT, '.qa', 'tone-live.json'), JSON.stringify(out, null, 2), 'utf8');
  win.destroy();
  app.exit(0);
});
