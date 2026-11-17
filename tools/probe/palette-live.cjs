// 实机取色验证：用真实的 userData 与真实的视频文件跑一遍页面里的取色。
//
// 为什么必须单独一个探针、不能用 harness.cjs：
//   harness 在加载时就把 userData 指到 mkdtemp 的临时目录，那里没有用户的
//   视频库；而且它会把 media scheme 注册成只允许探针自己造的素材。
//   这个探针反过来**必须**读 %APPDATA%\raven-ambient-bold 与真实的 workshop 视频。
//
// 做法：加载 dist/ 的页面（打包后就是它）→ 在页面里重放 videoPalette 的算法
// → 对每个真实视频输出「取到哪一帧、四个色、collageTone 的三层色」。
//
// 跑法：
//   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
//     tools/probe/palette-live.cjs --no-sandbox
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(ROOT, '.qa', 'palette-live');
fs.mkdirSync(OUT, { recursive: true });

const { registerMediaScheme, attachMedia, allowFile } = require(path.join(ROOT, 'electron', 'media.cjs'));
registerMediaScheme();

const GRANTS = path.join(app.getPath('appData'), 'raven-ambient-bold', 'media-grants.json');

app.disableHardwareAcceleration();

// 页面里重放 videoPalette 的取色：分桶 / 过滤 / 权重 / 排序 / charCodeAt 去重，
// 加 collageTone 的色相投票。**必须与源码逐行一致**，否则验证的是另一个人写的算法。
const PAGE_SCRIPT = String.raw`
window.__probePalette = async function (src) {
  const SIZE = 36, READY = 6000;
  const waitFor = (el, ev, ms) => new Promise((res, rej) => {
    let done = false;
    const fin = err => { if (done) return; done = true; el.removeEventListener(ev, on); el.removeEventListener('error', onErr); clearTimeout(t); err ? rej(err) : res(); };
    const on = () => fin(), onErr = () => fin(new Error('video failed'));
    const t = setTimeout(() => fin(new Error('timeout')), ms);
    el.addEventListener(ev, on, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  video.src = src;
  await waitFor(video, 'loadedmetadata', READY);
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const at = duration > 1.2 ? duration * 0.12 : duration * 0.5;
  video.currentTime = at;
  await waitFor(video, 'seeked', READY);
  ctx.drawImage(video, 0, 0, SIZE, SIZE);

  // --- sample()，逐行抄自 src/video-palette.ts ---
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 140) continue;
    const high = Math.max(r, g, b), low = Math.min(r, g, b);
    if (high < 22 || low > 240) continue;
    const key = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, weight: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
    bucket.weight += 1 + (high - low) / 96;
    buckets.set(key, bucket);
  }
  const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const ranked = [...buckets.values()]
    .map(k => ({ color: hex(k.r / k.count, k.g / k.count, k.b / k.count), score: k.weight * Math.sqrt(k.count) }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  for (const row of ranked) {
    if (picked.length >= 4) break;
    const far = picked.every(seen =>
      Math.abs(seen.charCodeAt(1) - row.color.charCodeAt(1)) +
      Math.abs(seen.charCodeAt(3) - row.color.charCodeAt(3)) +
      Math.abs(seen.charCodeAt(5) - row.color.charCodeAt(5)) > 34);
    if (far) picked.push(row.color);
  }
  return { duration, at, picked, ranked: ranked.slice(0, 8).map(r => [r.color, Math.round(r.score)]) };
};
// executeJavaScript 会把这条表达式的值克隆回主进程，而赋值表达式的结果是
// 那个函数本身——函数不可克隆，直接抛「An object could not be cloned」。
undefined;
`;

app.whenReady().then(async () => {
  attachMedia();
  const grants = JSON.parse(fs.readFileSync(GRANTS, 'utf8'));
  const videos = grants.files.filter(f => /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f));
  for (const file of videos) allowFile(file);

  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await win.webContents.executeJavaScript(PAGE_SCRIPT, true);

  const rows = [];
  for (const file of videos) {
    const src = 'media://local/' + encodeURIComponent(file);
    try {
      const result = await win.webContents.executeJavaScript(
        `window.__probePalette(${JSON.stringify(src)})`, true);
      rows.push({ file: path.basename(file), ...result });
    } catch (error) {
      rows.push({ file: path.basename(file), error: String(error && error.message || error) });
    }
    console.log('[palette]', path.basename(file).slice(0, 50), '->', JSON.stringify(rows.at(-1).picked || rows.at(-1).error));
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2), 'utf8');
  console.log('[palette] 写入', path.join(OUT, 'report.json'));
  win.destroy();
  app.exit(0);
});
