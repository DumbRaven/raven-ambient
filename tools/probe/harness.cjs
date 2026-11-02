/**
 * 放映页探针的公共底座。
 *
 * 为什么要有这个文件：每个探针原本都重复七十来行「注册 media scheme → 造源图 →
 * 起 1920×1080 窗口 → 注入 cabinet → 切放映页 → 点全屏」，改一处要改五遍，
 * 而且复制的时候很容易漏掉 media scheme 注册——漏了就会量到缩略态（见下面第 3 条）。
 *
 * 三个必须知道的约束：
 *
 * 1. **必须跑 `dist/` 的产物**。探针加载 `dist/index.html`，改完源码要先
 *    `npm.cmd run build`，否则量的是上一版。
 *
 * 2. **Electron 直跑前要清 `ELECTRON_RUN_AS_NODE`**。这个环境变量被设上时
 *    Electron 会退化成纯 Node，报 `Cannot read properties of undefined
 *    (reading 'setPath')`。命令行里用：
 *      env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *        tools/probe/geo.cjs --no-sandbox
 *    不需要再写 .ps1 外壳。
 *
 * 3. **media scheme 不能漏**。不注册 media scheme，媒体库里那张图就加载不出来，
 *    页面会停在「空库」分支，而空库分支里根本没有 `.theater-expand` 按钮——
 *    于是点全屏没反应，量到的全是缩略态（画布 680 宽而不是 1920）。
 *    这个坑踩过一次，量出一堆 `cqw=2.18`、`fontSize=23px` 的假值。
 *
 * 4. **截图分辨率会变，任何脚本都不许把宽高写死**。同一个探针在不同 DPR、
 *    不同显示器、不同窗口尺寸下截出的 PNG 尺寸不同（见过 3840×2160 和
 *    1920×1080 两种）。写死宽高当 stride 用，读到不匹配的图时**不会报错**，
 *    只会行错位、算出看似正常的假值。一律用 `pixels.cjs` 的 `load()`
 *    （内部走 ffprobe），或自己 `ffprobe` 取尺寸。
 *
 * 5. **cqw 的基准跟着元素走，不是固定的**。实测全屏 1920×1080 下：
 *      `.template-collage` 上的 1cqw = 19.2px（画布宽的 1%）
 *      `.tpl-block-panel` 上的 1cqw = 5.55px（面板宽 615 的 1%）
 *      `.tpl-tag` 上的 1cqw 也是 5.55px（它没有 container-type，继承面板的）
 *    所以同一个 `3.0cqw` 写在面板里是 16.6px、写在画布级元素上是 57.6px，
 *    差 3.5 倍。写 CSS 前先确认这条规则会落在哪个容器里。
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

// 隔离 userData：绝不让探针碰到 %APPDATA%\raven-ambient-bold 里的真实数据。
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'probe-')));

const { registerMediaScheme, attachMedia, allowDir, allowFile } =
  require(path.join(ROOT, 'electron', 'media.cjs'));
registerMediaScheme();

// 参考图的底色是灰蓝雾湖；这里合一张同色纯色图当素材，够探针用。
// TEMP 会被清，所以每次现造，不要缓存成文件。
const MEDIA_DIR = path.join(os.tmpdir(), 'probe-media');
const MEDIA_IMG = path.join(MEDIA_DIR, 'DROWNED DUSK.png');
const MEDIA_NAME = 'Ocean';

function ensureMedia() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x39557a:s=1920x1080:d=1',
    '-frames:v', '1', MEDIA_IMG,
  ]);
}

const CABINET = {
  version: 2,
  records: [],
  queue: [],
  ambience: [],
  media: [{ id: 'image:1', kind: 'image', path: MEDIA_IMG, name: MEDIA_NAME, size: 1 }],
  mediaDirs: [MEDIA_DIR],
  master: 60,
  musicVolume: 70,
  ducking: true,
  duckDepth: 9,
  order: 'sequence',
  transition: 'crossfade',
  lineMode: false,
  lineVolume: 100,
  muted: [],
  theme: '#9a8b78',
  imageName: '',
};

/**
 * 起一个已切到放映页的窗口。
 *
 * @param {object}  [opts]
 * @param {number}  [opts.width=1920]   窗口宽。注意 innerWidth 会比它小（窗口边框）。
 * @param {number}  [opts.height=1080]
 * @param {string}  [opts.template='collage']  版式：collage / photo / frame
 * @param {boolean} [opts.expand=true]  是否点全屏。true 时画布是全显示器物理分辨率。
 * @returns {Promise<{win, run, geo, shot, close}>}
 *   run(code)  在页面里执行 JS 并返回结果
 *   geo()      量所有版式块的画布百分比（见 measureAll）
 *   shot(file) capturePage 存 PNG，默认存到 tools/probe/<name>.png 由调用方给
 */
async function launch(opts = {}) {
  const {
    width = 1920,
    height = 1080,
    template = 'collage',
    expand = true,
    settle = 2600,
  } = opts;

  ensureMedia();
  allowDir(MEDIA_DIR);
  allowFile(MEDIA_IMG);
  attachMedia();

  const win = new BrowserWindow({
    width,
    height,
    show: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await wait(2200);
  const run = code => win.webContents.executeJavaScript(code, true);

  await run(`(() => {
    localStorage.setItem('raven-cabinet-v2', ${JSON.stringify(JSON.stringify(CABINET))});
    localStorage.setItem('raven-stage-template', ${JSON.stringify(template)});
    return 1;
  })()`);
  await win.webContents.reload();
  await wait(settle);

  // 切页靠 aria-label，不要靠按钮顺序——底栏按钮会随窗口变。
  await run(`(() => {
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '放映')?.click();
    return 1;
  })()`);
  await wait(1600);

  if (expand) {
    await run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
    await wait(1400);
  }

  return {
    win,
    run,
    geo: () => run(`(${measureAll.toString()})()`),
    shot: async file => {
      const png = (await win.webContents.capturePage()).toPNG();
      if (file) fs.writeFileSync(file, png);
      return png;
    },
    close: () => app.exit(0),
  };
}

/**
 * 量所有版式块。**逐块留 null 而不是报错**：某个版式没有某块是正常的
 * （比如 collage 没有 `.tpl-photo-media`），探针不该因此挂掉。
 */
function measureAll() {
  const C = document.querySelector('.template-collage, .template-photo, .template-frame');
  if (!C) return { error: 'no stage root' };
  const cb = C.getBoundingClientRect();
  const box = sel => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return {
      x: +((b.x - cb.x) / cb.width * 100).toFixed(2),
      y: +((b.y - cb.y) / cb.height * 100).toFixed(2),
      w: +(b.width / cb.width * 100).toFixed(2),
      h: +(b.height / cb.height * 100).toFixed(2),
    };
  };
  return {
    canvas: [Math.round(cb.width), Math.round(cb.height)],
    stage: box('.theater-screen'),
    media: box('.tpl-block-media'),
    bar: box('.tpl-block-bar'),
    panel: box('.tpl-block-panel'),
    disc: box('.tpl-disc'),
    tag: box('.tpl-tag'),
    raven: box('.tpl-raven'),
    produced: box('.tpl-produced'),
    intro: box('.tpl-intro'),
    introMirror: box('.tpl-intro-mirror'),
    words: box('.tpl-words'),
    discLayer: box('.tpl-disc-layer'),
  };
}

/** 1cqw 等于多少 px。cqw 相对最近的 container（这里是块自身宽），不是视口。 */
const CQW_PROBE = `(() => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;width:10cqw;height:0';
  document.querySelector('.template-collage').appendChild(probe);
  const cqw = probe.getBoundingClientRect().width / 10;
  probe.remove();
  return cqw;
})()`;

/** 打印 JSON 并退出。所有探针都以它收尾。 */
function report(payload) {
  console.log(JSON.stringify(payload, null, 0));
  app.exit(0);
}

/** 探针抛错时带上前缀退出，别静默吞掉。 */
function guard(fn) {
  app.whenReady().then(fn).catch(e => {
    console.error('PROBE_FAIL ' + e.message);
    app.exit(1);
  });
}

module.exports = { launch, measureAll, report, guard, wait, CQW_PROBE, ROOT, MEDIA_IMG };
