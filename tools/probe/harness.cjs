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

// 探针窗口默认不出现。
//
// 这些脚本经常在用户打游戏的时候跑，一个 1920×1080 的窗口弹出来会直接抢走
// 焦点、挡住屏幕（被抱怨过两次）。而「隐藏窗口」又不行：Chromium 对不可见窗口
// 会停掉 requestAnimationFrame（实测 1000ms 只有 2 帧、maxGap 1000ms），
// 量动画的探针会量出一堆「没动」的假值。
//
// 所以默认走 Chromium 的离屏渲染（offscreen）：画面合成到内存缓冲区，窗口从头
// 到尾不创建，屏幕上、任务栏、Alt-Tab 里都没有它，rAF 却按真实节拍跑
// （实测 1000ms 62 帧、maxGap 17ms、63fps）。capturePage 也正常，而且截出来的
// 是 1200×800 而不是带窗口边框的 1184×735。
//
// 两种退出方式：
//   PROBE_SHOW=1        真把窗口显示出来（要看效果时用），此时允许聚焦。
//   PROBE_OFFSCREEN=0   保留「隐藏窗口」，给纯读数据、完全不碰动画的探针用。
//
// 离屏下 `webContents.sendInputEvent` 投不进渲染进程（离屏窗口没有平台句柄），
// 所以鼠标类的验证一律用下面的 `hover()`，它走 CDP。
const SHOW = process.env.PROBE_SHOW === '1';
const OFFSCREEN = !SHOW && process.env.PROBE_OFFSCREEN !== '0';

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

// 探针唱片的音频素材。
//
// 为什么必须造真音频：`RoomPlayer.schedule()` 在真正播放前会
// `await readAsset(record.assetId)`，拿不到就 throw「找不到「x」的文件」。
// 探针的唱片只有元数据、没有资产，所以点播放只会弹一条错误提示，
// status.running 永远是 false —— 「正在播放」那一屏拍不出来。
//
// 用 ffmpeg 合成一段 60 秒的等幅正弦：噪声/音乐波形在响度分析里会走不同的
// 分支（`loudness.ts` 会剔静音块），等幅正弦最稳定，段间响度不抖。
//
// 为什么是 60 秒而不是 3 秒：基线要拍「正在播放」这一屏，截图前会推进几百毫秒
// 到一两秒。3 秒的素材在两次运行之间可能一次还没播完、一次刚播完
// （播完会触发 `onMusicEnded` 自动接下一首，`tick` 定时器也随之停摆，
// 读数就冻结在播完那一刻）。实测该缺陷让 `narrow/listening-playing`
// 出现「0:00 vs 0:01」的差异。60 秒留足余量，截不到播完那一刻。
const MEDIA_AUDIO = path.join(MEDIA_DIR, 'probe-tone.m4a');

function ensureMedia() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x39557a:s=1920x1080:d=1',
    '-frames:v', '1', MEDIA_IMG,
  ]);
  if (!fs.existsSync(MEDIA_AUDIO)) {
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=60',
      '-c:a', 'aac', '-b:a', '96k', MEDIA_AUDIO,
    ]);
  }
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
    // 想看别的状态（比如「此刻叠着三路环境音」）时传一份 cabinet 补丁进来。
    // 直接改上面的 CABINET 会让所有探针一起变，几何类探针不该被动到。
    patch = null,
  } = opts;

  ensureMedia();
  allowDir(MEDIA_DIR);
  allowFile(MEDIA_IMG);
  attachMedia();

  const win = new BrowserWindow({
    width,
    height,
    show: SHOW,
    // focusable / skipTaskbar 只在隐藏时关掉：这样窗口连「可被激活」都不是，
    // 不会在打游戏时把前台抢走，任务栏上也不会多一个图标。
    focusable: SHOW,
    skipTaskbar: !SHOW,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: OFFSCREEN,
    },
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await wait(2200);
  const run = code => win.webContents.executeJavaScript(code, true);

  // hover(selector | {x, y})：把鼠标移到目标中心，让 CSS `:hover` 真的生效。
  //
  // 为什么要绕 CDP：`webContents.sendInputEvent({type:'mouseMove'})` 需要真实的
  // 平台窗口句柄，离屏渲染（PROBE_OFFSCREEN）的窗口没有，事件发进去不会变成
  // `:hover`（实测 hover 完全不触发）；CDP 的 `Input.dispatchMouseEvent` 走渲染
  // 进程内部，离屏下照样生效（实测触发、同时 63fps）。真实窗口下两条路等价，
  // 所以统一走 CDP，探针不用关心自己是哪种模式。
  //
  // 页面里 `dispatchEvent(new MouseEvent('mouseover'))` 无论如何都不算：它不会让
  // CSS `:hover` 命中，量到的 transform 恒为 none。这个坑项目里踩过一次。
  //
  // 目标在视口外时先滚进来再量。`getBoundingClientRect()` 给的是**视口坐标**，
  // 页尾那类元素（文档 y≈1258，视口只有 900 高）不滚就直接投坐标，鼠标落在
  // 空白处，读回来是「hover 没生效」的假值——这个坑也踩过一次（点 y=1284）。
  let debuggerAttached = false;
  const hover = async target => {
    if (!debuggerAttached) {
      try {
        win.webContents.debugger.attach('1.3');
      } catch (e) {
        // 已经挂上了（多个探针共用一次 launch）——不是错误。
      }
      debuggerAttached = true;
    }
    const centerOf = sel => run(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: b.left + b.width / 2,
        y: b.top + b.height / 2,
        inViewport: b.top >= 0 && b.bottom <= window.innerHeight,
      };
    })()`);
    let x;
    let y;
    let scrolled = false;
    if (typeof target === 'string') {
      let box = await centerOf(target);
      if (!box) throw new Error('hover: 页面里找不到 ' + target);
      if (!box.inViewport) {
        await run(`document.querySelector(${JSON.stringify(target)})
          .scrollIntoView({ block: 'center' })`);
        await wait(400);
        box = await centerOf(target);
        if (!box) throw new Error('hover: 滚动后找不到 ' + target);
        scrolled = true;
      }
      x = box.x;
      y = box.y;
    } else {
      x = target.x;
      y = target.y;
    }
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      clickCount: 0,
    });
    return { x: Math.round(x), y: Math.round(y), scrolled };
  };

  const cabinet = patch ? Object.assign({}, CABINET, patch) : CABINET;
  await run(`(() => {
    localStorage.setItem('raven-cabinet-v2', ${JSON.stringify(JSON.stringify(cabinet))});
    localStorage.setItem('raven-stage-template', ${JSON.stringify(template)});
    return 1;
  })()`);
  await win.webContents.reload();
  await wait(settle);

  // 切页靠 aria-label，不要靠按钮顺序——底栏按钮会随窗口变。
  await run(`(() => {
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '相集')?.click();
    return 1;
  })()`);
  await wait(1600);

  if (expand) {
    await run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
    await wait(1400);
  }

  // 隐藏窗口能不能出图，实测比假设可靠：个别显卡驱动下 Chromium 对「从来没
  // 显示过」的窗口不合成画面，capturePage 会拿到 0×0。那样后面每张截图都是
  // 废的，而且不会报错。所以先探一张 2×2；拿不到就退到 showInactive——
  // 窗口会出现，但不激活、不抢当前前台（showInactive 的语义就是不抢焦点）。
  // 离屏渲染（OFFSCREEN）本身就在内存里合成，不存在这个情况，不用探。
  if (!SHOW && !OFFSCREEN) {
    const probeShot = await win.webContents.capturePage({ x: 0, y: 0, width: 2, height: 2 });
    const probeSize = probeShot.getSize();
    if (!probeSize.width || !probeSize.height) {
      console.error('[probe] 隐藏窗口截不到图，退回 showInactive（可见但不抢焦点）');
      win.showInactive();
      await wait(500);
    }
  }

  return {
    win,
    run,
    geo: () => run(`(${measureAll.toString()})()`),
    hover,
    // seedAsset：往页面 IndexedDB 的 assets store 里放一份素材。
    //
    // 用途是让探针里的唱片能真的播放。`store-browser.ts` 的资产库是
    // `raven-ambient` / `assets`，纯 key-value，值是 Blob。这里把文件读成
    // base64 传进去再还原成 Blob——离屏窗口里没有 fs，只能这样过桥。
    //
    // 必须在**注入 cabinet 之前**调用，否则 App 启动时读不到资产。
    seedAsset: async (key, file) => {
      const base64 = fs.readFileSync(file).toString('base64');
      return run(`(async () => {
        const bin = atob(${JSON.stringify(base64)});
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/mp4' });
        const database = await new Promise((resolve, reject) => {
          const req = indexedDB.open('raven-ambient', 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('assets')) req.result.createObjectStore('assets');
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise((resolve, reject) => {
          const tx = database.transaction('assets', 'readwrite');
          tx.objectStore('assets').put(blob, ${JSON.stringify(key)});
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return blob.size;
      })()`);
    },
    // 窗口当前是哪种形态。量动画的探针要据此判断「动画时钟能不能跑」：
    // 离屏 能跑、显示 能跑、隐藏 不能跑（rAF 被挂起）。
    offscreen: OFFSCREEN,
    visible: SHOW,
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
    ambient: box('.tpl-ambient'),
    ambientMirror: box('.tpl-ambient-mirror'),
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

module.exports = { launch, measureAll, report, guard, wait, CQW_PROBE, ROOT, MEDIA_IMG, MEDIA_DIR, MEDIA_AUDIO, CABINET };
