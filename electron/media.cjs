// 媒体库：图片与视频走文件系统，不塞进 IndexedDB。
//
// 为什么不用 IndexedDB 存视频：一个 1080p 十分钟的 H.264 就有几百 MB，
// 存进去每次播放都要把整个 Blob 读出来才能生成 blob: URL，切页和启动都会卡。
// 改成库里只记路径、页面写 <video src="media://...">，由 Chromium 自己分块读取和 seek。
//
// 页面是 sandbox: true、没有 preload，拿不到 dialog 和 fs。所以沿用 now-playing 那套约定：
//   页面把请求压进 window.__ravenMediaOutbox
//   主进程每 400ms 取一次，处理完调 window.__ravenMedia(payload) 推回去
// 页面永远是被动的一方，不放开任何沙箱设置。
const { protocol, dialog, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { mediaResponse } = require('./media-response.cjs');
// 桌面放映窗。窗口本身住在 desktop-stage.cjs，这里只是把页面的请求转过去。
// 两边的 require 不会成环：那边不认识 media.cjs。
const { desktopStage } = require('./desktop-stage.cjs');

const SCHEME = 'media';
const OUTBOX = 'window.__ravenMediaOutbox';
const POLL = 400;

/** 能被当成媒体收进来的扩展名。avi/mkv 这类容器 Chromium 解不了，不列。 */
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov', '.ogv']);
/** 单个目录最多收这么多，防止误选到 C:\ 之类的根目录时把界面撑爆。 */
const MAX_FILES = 500;
/** 递归深度上限。壁纸软件常见是「库/分类/文件」三层，再多半是误选。 */
const MAX_DEPTH = 4;

/**
 * 必须在 app.ready 之前调用。
 * stream: true 让视频能按字节范围请求（seek 要靠它）；secure: true 让它算安全上下文，
 * 否则 <video> 在 CSP 下会被当成不可信来源。
 */
function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

/** 允许读取的目录。用户选过的目录才会进来，别的一律 403。 */
const allowed = new Set();
/**
 * 单独导入的文件。
 *
 * 和「整目录加入」分开记：用户挑了一张图，不该顺带把他整个素材盘放进来，
 * 也不该在来源列表里冒出一个他从没选过的文件夹。
 */
const looseFiles = new Set();

/** 把目录加进白名单。 */
function allowDir(dir) {
  if (typeof dir === 'string' && dir) allowed.add(path.resolve(dir));
}

/** 把单个文件加进白名单。 */
function allowFile(file) {
  if (typeof file === 'string' && file) looseFiles.add(path.resolve(file));
}

function insideAllowed(target) {
  const resolved = path.resolve(target);
  if (looseFiles.has(resolved)) return true;
  for (const dir of allowed) {
    const rel = path.relative(path.resolve(dir), resolved);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
}

/** media://local/<编码后的绝对路径> 与 file:// 之间的一层壳。 */
function targetOf(request) {
  try {
    const url = new URL(request.url);
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return '';
  }
}

/**
 * 页面敲门用的伪路径。
 *
 * 为什么不加 preload / 不开 IPC：页面现在是 `sandbox: true`、无 preload，
 * 这个约束是有意的（见文件头）。但 `media://` 协议本来就允许页面发请求，
 * 借它递一个「快去看看 outbox」的信号，既不用放开任何沙箱设置，
 * 也不用为了一个时序问题引入新的 IPC 通道。
 *
 * 这个路径不是文件，永远不会进白名单判断——在协议处理器最开头就分出去。
 */
const KNOCK = '/__knock';

function mediaUrl(file) {
  return `${SCHEME}://local/${encodeURIComponent(file)}`;
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return '';
}

/**
 * Wallpaper Engine 的创意工坊目录。
 * 431960 是 Wallpaper Engine 在 Steam 上的 appid，换别的皮肤引擎要在这里加。
 *
 * 返回去重后的路径：注册表里那条和固定路径经常是同一个目录，
 * 不去重会把整个库扫两遍（本机 184 个作品会变成 368 件）。
 */
function wallpaperRoots() {
  const roots = [];
  // 用户把库装在别处时，Steam 会在注册表里登记
  try {
    const { execFileSync } = require('node:child_process');
    const raw = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
    const match = raw.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (match) roots.push(`${match[1].trim().replace(/[\\/]+$/, '')}\\steamapps\\workshop\\content\\431960`);
  } catch { /* 没装 Steam 或 reg 不可用，走下面的固定路径 */ }
  for (const drive of ['C', 'D', 'E', 'F', 'G']) {
    roots.push(`${drive}:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\431960`);
    roots.push(`${drive}:\\SteamLibrary\\steamapps\\workshop\\content\\431960`);
  }
  const seen = new Set();
  return roots.filter(root => {
    const key = path.resolve(root).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 扫一个目录，递归收集图片和视频。
 * 跳过隐藏目录（.git、以 . 开头的）和常见的大件无关目录，避免扫到 node_modules 里。
 */
function scan(root, depth = 0, out = []) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  // readdir 的顺序由文件系统决定，同一台机器上也可能变。排一次序，
  // 免得用户每次重扫看到的排列都不一样。
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      scan(full, depth + 1, out);
    } else if (entry.isFile()) {
      const kind = kindOf(full);
      if (!kind) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch { continue; }
      out.push({ path: full, name: entry.name, kind, size });
    }
  }
  return out;
}

/**
 * 壁纸库（Wallpaper Engine 的创意工坊目录）。
 *
 * 它和普通文件夹的区别：每个子目录是一个作品，作品名写在 project.json 里，
 * 文件名往往是一串无意义的字符（甚至和标题完全无关）。所以不能按文件名摆，
 * 得读 project.json 拿 title 和真正该播的那个文件。
 *
 * 只收「视频型」和「网页型」——场景型（scene）是 Wallpaper Engine 自己的
 * 渲染器在跑，脱离它没法重现，那种只把预览图放进来，标成不能播放。
 */
function scanWallpaper(root) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(root, entry.name);
    let project;
    try {
      project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    } catch {
      continue;
    }
    const title = typeof project.title === 'string' && project.title.trim() ? project.title.trim().slice(0, 200) : entry.name;
    const file = typeof project.file === 'string' ? project.file : '';
    const playable = path.join(dir, file);
    const kind = file ? kindOf(playable) : '';
    let target = '';
    if (kind) {
      target = playable;
    } else {
      // 场景型 / 应用型壁纸没有能直接播的文件，只能靠 Wallpaper Engine 自己渲染。
      // 放映页只放图片和视频，所以这类作品整件跳过——摆一张低分辨率的预览图
      // 对用户没有意义，那是「能看个大概」，不是「能放」。
      continue;
    }
    let size = 0;
    try { size = fs.statSync(target).size; } catch { continue; }
    out.push({
      // 用作品目录做 id：作品名和视频文件名都可能被作者改，目录 id 不会变
      key: dir,
      path: target,
      name: title,
      kind,
      size,
    });
  }
  return out;
}

class MediaBridge {
  constructor() {
    this.timer = undefined;
    this.target = null;
  }

  /** 推一份结果给页面。页面没挂接收器时静默丢掉。 */
  push(webContents, payload) {
    const win = webContents && !webContents.isDestroyed() ? webContents : this.target;
    if (!win || win.isDestroyed()) return;
    win.executeJavaScript(`window.__ravenMedia && window.__ravenMedia(${JSON.stringify(payload)})`, true)
      .catch(() => undefined);
  }

  async take(webContents) {
    if (!webContents || webContents.isDestroyed()) return;
    let queued = [];
    try {
      queued = await webContents.executeJavaScript(`${OUTBOX} || []`, true);
    } catch {
      return;
    }
    if (!Array.isArray(queued) || !queued.length) return;
    try {
      await webContents.executeJavaScript(`${OUTBOX} = []`, true);
    } catch {
      return;
    }
    for (const action of queued) await this.handle(webContents, action);
  }

  async handle(webContents, action) {
    const type = action && typeof action === 'object' ? action.type : action;

    if (type === 'ping') {
      // 壁纸库的根目录不是用户加的，混进来源列表会显示成「431960」这种 Steam 目录名。
      // 页面自己知道壁纸库读了多少件，那里有单独的 chip，所以这里把它们剔掉。
      const wallpaper = new Set(wallpaperRoots().map(root => path.resolve(root).toLowerCase()));
      this.push(webContents, { type: 'ready', dirs: [...allowed].filter(dir => !wallpaper.has(path.resolve(dir).toLowerCase())) });
      return;
    }

    if (type === 'pick') {
      // 对话框要挂在主窗口上，否则窗口最小化时它会飘到屏幕角落
      const win = BrowserWindow.fromWebContents(webContents);
      const picked = await dialog.showOpenDialog(win ?? undefined, {
        title: '选一个放图片或视频的文件夹',
        buttonLabel: '加入媒体库',
        properties: ['openDirectory'],
      });
      if (picked.canceled || !picked.filePaths.length) return;
      const dir = path.resolve(picked.filePaths[0]);
      allowed.add(dir);
      const files = scan(dir);
      this.push(webContents, { type: 'scan', dir, files, url: files.map(f => ({ ...f, src: mediaUrl(f.path) })) });
      return;
    }

    if (type === 'pick-files') {
      // 挑单个文件，可以多选。和「加入文件夹」是两件事：
      // 那个会把整棵树扫进来，这个只收点中的这几件。
      const win = BrowserWindow.fromWebContents(webContents);
      const picked = await dialog.showOpenDialog(win ?? undefined, {
        title: '选要放映的图片或视频',
        buttonLabel: '加入媒体库',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '图片和视频', extensions: [...IMAGE_EXT, ...VIDEO_EXT].map(ext => ext.slice(1)) }],
      });
      if (picked.canceled || !picked.filePaths.length) return;
      const files = [];
      for (const raw of picked.filePaths) {
        const file = path.resolve(raw);
        const kind = kindOf(file);
        if (!kind) continue;
        let size = 0;
        try { size = fs.statSync(file).size; } catch { continue; }
        looseFiles.add(file);
        files.push({ path: file, name: path.basename(file), kind, size });
      }
      if (!files.length) return;
      this.push(webContents, { type: 'files', files, url: files.map(file => ({ ...file, src: mediaUrl(file.path) })) });
      return;
    }

    if (type === 'rescan') {
      const dir = typeof action.dir === 'string' ? path.resolve(action.dir) : '';
      if (!dir || !allowed.has(dir)) return;
      const files = scan(dir);
      this.push(webContents, { type: 'scan', dir, files, url: files.map(f => ({ ...f, src: mediaUrl(f.path) })) });
      return;
    }

    if (type === 'wallpapers') {
      // 壁纸库不弹对话框：Wallpaper Engine 的位置是固定的，直接读。
      // 找不到就回一条空的，页面据此提示「没装」。
      const dirs = wallpaperRoots();
      const found = [];
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        allowed.add(path.resolve(dir));
        const items = scanWallpaper(dir);
        if (items.length) found.push({ dir: path.resolve(dir), items });
      }
      this.push(webContents, {
        type: 'wallpapers',
        roots: found.map(entry => ({ dir: entry.dir, count: entry.items.length })),
        items: found.flatMap(entry => entry.items.map(item => ({
          ...item, src: mediaUrl(item.path),
        }))),
      });
      return;
    }

    if (type === 'fullscreen') {
      // 放映全屏：要真全屏（盖住任务栏），只能由主进程动窗口。
      // 页面那边用 fixed 铺满，这只负责让窗口本身也进全屏。
      const win = BrowserWindow.fromWebContents(webContents);
      if (win && !win.isDestroyed()) win.setFullScreen(action.on === true);
      return;
    }

    if (type === 'desktop') {
      // 把放映台摆到桌面上（或者收回来）。窗口的建立与销毁都在 desktop-stage.cjs，
      // 这里只是把页面的请求转过去——页面自己开不了窗口。
      if (action.on === true) desktopStage.show();
      else desktopStage.hide();
      return;
    }

    if (type === 'restore') {
      // 上次记下的目录重新进白名单。只登记、不重扫：条目已经在收藏里，
      // 重扫会推一串 scan 回来又写一次盘。用户想刷新时自己点重扫。
      for (const dir of Array.isArray(action.dirs) ? action.dirs : []) {
        if (typeof dir !== 'string' || !dir) continue;
        const resolved = path.resolve(dir);
        try { if (fs.statSync(resolved).isDirectory()) allowed.add(resolved); } catch { /* 目录没了就跳过，卡片点开会是 404，界面上会显示重扫按钮 */ }
      }
      // 单独导入的文件也要补回来。它们不在任何 allowed 目录里，
      // 少了这一步，重启之后那几张图会全部 403。
      for (const file of Array.isArray(action.files) ? action.files : []) {
        if (typeof file !== 'string' || !file) continue;
        const resolved = path.resolve(file);
        try { if (fs.statSync(resolved).isFile()) looseFiles.add(resolved); } catch { /* 文件被挪走或删了，跳过 */ }
      }
      // 壁纸库的条目路径在 Steam 目录下，不在 mediaDirs 里。这里补登记一遍，
      // 否则重启之后那一百多张壁纸全是 403。只是几次 statSync，不扫 project.json。
      const wallpaper = wallpaperRoots().map(root => path.resolve(root).toLowerCase());
      for (const root of wallpaper) {
        try { if (fs.statSync(root).isDirectory()) allowed.add(path.resolve(root)); } catch { /* 没装就是没装 */ }
      }
      // 回给页面的来源列表同样剔掉壁纸库根目录，见 ping 那段
      this.push(webContents, { type: 'ready', dirs: [...allowed].filter(dir => !wallpaper.includes(path.resolve(dir).toLowerCase())) });
    }
  }

  start(webContents) {
    // 已经在跑了就不再认领：媒体桥只有一个 target，后加载完的窗口抢过去，
    // 主窗口的选文件、全屏这些动作就没人处理了。谁先跑起来谁说了算。
    if (this.timer !== undefined) return;
    this.target = webContents;
    this.timer = setInterval(() => { void this.take(webContents); }, POLL);
    webContents.once('destroyed', () => this.stop());
  }

  /**
   * 页面敲门：立刻取一次，不等下一轮 POLL。
   *
   * 为什么需要：400ms 轮询对「选文件、扫描」这种无所谓时机的动作够用，
   * 但全屏要抢在窗口开始变化之前把请求送到主进程，否则用户会看到
   * 「画面先在窗口里铺满，等一百毫秒窗口才变大」——像跳了两下。
   * 实测那一百毫秒里大头就是轮询的等待。
   *
   * 敲门本身不读任何数据，只是把 take 提前，返回后还按原来的帧走。
   */
  poke() {
    if (this.target && !this.target.isDestroyed()) void this.take(this.target);
  }

  stop() {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; }
    this.target = null;
  }
}

let bridge = null;

/** app.ready 之后调用：装好协议处理与轮询。 */
function attachMedia() {
  protocol.handle(SCHEME, async (request) => {
    // 敲门：页面推完动作后想立刻被处理，不等下一轮 POLL。
    // 必须在白名单判断之前分出去，否则这个伪路径会被当成越权文件。
    if (new URL(request.url).pathname === KNOCK) {
      if (bridge) bridge.poke();
      // 204 不允许带 body：传 '' 会让 Response 构造抛错（页面收到的是网络错误，
      // 于是敲门的 fetch 走进 catch——功能不受影响，但控制台会刷一屏）。
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
    const target = targetOf(request);
    if (!target) return new Response('bad request', { status: 400 });
    // 只认白名单里的目录。没有这一步，media:// 就是任意文件读取后门。
    if (!insideAllowed(target)) return new Response('forbidden', { status: 403 });
    let size;
    try {
      const stat = fs.statSync(target);
      if (!stat.isFile()) return new Response('not a file', { status: 404 });
      size = stat.size;
    } catch {
      return new Response('missing', { status: 404 });
    }
    // 自己回 206。以前直接 net.fetch(file://)，它会把 Range 头整个丢掉——
    // 回 200 + 整个文件，moov 在尾部的 MP4 就永远起不了播。详见 media-response.cjs。
    return mediaResponse(target, request, size);
  });

  bridge = new MediaBridge();
  const { app } = require('electron');
  app.on('browser-window-created', (_event, win) => {
    // 只挂主窗口：小组件和桌面放映窗都不需要媒体库，多挂一份只会白跑轮询，
    // 更糟的是 MediaBridge 只有一个 target——谁最后加载完谁抢走，
    // 主窗口的选文件、全屏这些动作就没人处理了。
    const url = win.webContents.getURL();
    if (url.includes('mini.html') || url.includes('desktop.html')) return;
    win.webContents.once('did-finish-load', () => bridge.start(win.webContents));
  });
}

module.exports = { registerMediaScheme, attachMedia, mediaUrl, allowDir, allowFile, SCHEME };
