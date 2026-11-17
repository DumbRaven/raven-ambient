// 实机打开「配色 → 挑一个」面板，把色块和 palette 数组一起抓下来。
//
// 为什么必须实机跑：这个面板显示的 palette 来自 TemplateStage 的
// `onPalette` 回调，是 videoPalette / coverPalette 的真实输出。
// 用假素材复刻算法只能回答「算法会算什么」，回答不了「用户看到的色块是哪几个」。
//
// 跑法：
//   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
//     tools/probe/tone-panel-live.cjs --no-sandbox
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(ROOT, '.qa', 'tone-panel');
fs.mkdirSync(OUT, { recursive: true });

const { registerMediaScheme, attachMedia, allowFile } = require(path.join(ROOT, 'electron', 'media.cjs'));
registerMediaScheme();

app.disableHardwareAcceleration();
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  attachMedia();
  const grants = JSON.parse(fs.readFileSync(
    path.join(app.getPath('appData'), 'raven-ambient-bold', 'media-grants.json'), 'utf8'));
  for (const file of grants.files) allowFile(file);

  const win = new BrowserWindow({
    width: 1600, height: 1000, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  const run = code => win.webContents.executeJavaScript(code, true);
  const shot = async name => {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), image.toPNG());
    return name;
  };

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await wait(1500);

  // 切到相集页
  const tab = await run(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '') === '相集');
    if (b) { b.click(); return true; }
    return false;
  })()`);
  console.log('[panel] 切到相集页:', tab);
  await wait(2000);
  await shot('1-media');

  // 列出相集里的条目
  const items = await run(`[...document.querySelectorAll('.ticket, .media-item, [data-media]')]
    .slice(0, 40)
    .map(el => ({ cls: el.className, text: (el.textContent || '').trim().slice(0, 40) }))`);
  console.log('[panel] 相集体条数:', items.length);
  console.log(JSON.stringify(items.slice(0, 12), null, 1));

  win.destroy();
  app.exit(0);
});
