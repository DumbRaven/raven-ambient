const { app, BrowserWindow, screen, session, ipcMain } = require('electron');
const path = require('node:path');
const { attachNowPlaying } = require('./now-playing.cjs');
const { attachFocusMini } = require('./focus-mini.cjs');
const { attachDesktopStage } = require('./desktop-stage.cjs');
const { registerMediaScheme, attachMedia } = require('./media.cjs');
const { attachUpdate } = require('./update.cjs');
const { attachAudioTap } = require('./audio-tap.cjs');

if (process.env.RAVEN_DATA_DIR) app.setPath('userData', path.resolve(process.env.RAVEN_DATA_DIR));

// 必须在 app.ready 之前登记：之后再登记，media:// 就不被当成标准协议，
// <img>/<video> 会把它当普通自定义协议处理，Range 请求和流式读取都失效。
registerMediaScheme();

/** 主窗口。小组件是独立窗口，所有「找窗口」的地方都得认准这个。 */
let mainWindow = null;

// 窗口与任务栏图标。打包后图标在 resources 里，开发时直接用 build 目录。
function appIcon() {
  const packaged = path.join(process.resourcesPath, 'raven-logo.png');
  const local = path.join(__dirname, '../build/raven-logo.png');
  return require('node:fs').existsSync(packaged) ? packaged : local;
}

function createWindow() {
  const available = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(680, available.width),
    height: Math.min(980, available.height - 35),
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#ffffff',
    // 关掉 Windows 11 的 Mica：窗口在画出第一帧之前会先把桌面壁纸的色调透出来
    // （本机壁纸偏青，看上去就是一块青蓝色的空壳）。我们自己的界面是纯白的，不需要这种材质。
    //
    // **只在 Windows 上传这个值**：macOS 没有 Mica，而且把不认识的选项递给
    // BrowserWindow 在不同 Electron 版本上行为不一致（有的直接忽略、有的警告）。
    // 用条件展开而不是「反正 mac 会忽略」——那是在赌实现细节。
    ...(process.platform === 'win32' ? { backgroundMaterial: 'none' } : {}),
    title: 'Raven Ambient · 唱片柜',
    // macOS 的窗口图标由 .app 包里的 AppIcon.icns 决定，BrowserWindow 的 icon 不生效
    // （传了也是白传），所以这一项也不带过去。
    ...(process.platform === 'win32' ? { icon: appIcon() } : {}),
    autoHideMenuBar: true,
    // 先不显示：窗口一出现就露出底色，蓝色的空壳比白屏还难看。
    // 等页面画出第一帧（开屏）再亮出来，用户点开就是 logo。
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      // 沙箱里也能用 preload：拿不到 fs / child_process，但 contextBridge 与
      // ipcRenderer 是允许的。有它之后媒体库、外部音乐、番茄钟都不必再靠轮询。
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  // 兜底：万一首帧迟迟不来（加载失败、显卡异常），也要把窗口亮出来，不能卡在后台。
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 5000);
  win.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  attachFocusMini(win);
  attachDesktopStage(win);
  return win;
}

// Electron 的锁按 userData 目录隔离，验证目录不会占用正式收藏的实例。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
app.on('second-instance', () => {
  // 主窗口是唯一的主入口。它在，就把它叫到前面；它已经关了（用户可能关掉主窗、
  // 只留着壁纸窗或专注小窗），就**重建**一个。
  //
  // 不能靠猜。原来写的是「找可见且不是 alwaysOnTop 的窗口」——
  // 但 `desktop-stage.cjs` 早就明确不做 alwaysOnTop，专注小窗也不做，
  // 于是猜中的可能是它们：用户点了任务栏图标，冒出来的却是壁纸窗，主界面没影。
  // 而如果当时只剩壁纸窗，`show()` 还会把一个本该贴在桌面上的窗口翻到前台。
  //
  // 主窗口的身份只能由 `mainWindow` 这个变量回答，不能用任何属性去推断。
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
});
app.whenReady().then(() => {
  const nowPlaying = attachNowPlaying();
  // 退出时把 NowPlaying.exe 收掉。
  //
  // 没有这一步的时候，那个 exe 是独立进程、自己也没有退出条件，
  // 用户关了软件它还在每 0.7 秒转一圈，直到注销或手动去任务管理器结束。
  // `will-quit` 是 Electron 唯一保证「退出流程已经启动、窗口可能还在」的时机；
  // 放在 `window-all-closed` 里不行——那里主窗口已经没了，而 quit 还可能被别的
  // 监听取消（比如有未保存状态时）。
  //
  // 这里只做同步的 kill：`will-quit` 不 await 异步工作，写成异步也来不及。
  // 子进程侧另有 stdin 断开兜底，所以就算这里没跑到（比如进程被强杀），
  // exe 也会自己退。
  app.on('will-quit', () => { try { nowPlaying.stop(); } catch { /* 已经退了 */ } });
  attachMedia();

  // mac 上抓系统音频（外部音乐模式要「响起时压低环境音」）。Windows 上不需要：
  // 那边页面自己 getUserMedia 拿虚拟声卡，主进程不参与。
  // isMainWindow 拦住子窗口——番茄钟小窗和桌面放映窗也加载 preload，
  // 但它们没有理由能起停一个系统级的抓取进程。
  const audioTap = attachAudioTap({ isMainWindow: sender => !!mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents });
  app.on('will-quit', () => { try { audioTap.stop(); } catch { /* 已经退了 */ } });

  // 默认一律拒绝，只放行音频输入（外部音乐的虚拟声卡）。
  // 摄像头、屏幕采集、通知、地理位置等仍然全部拒绝。
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== 'media') { callback(false); return; }
    const types = details?.mediaTypes ?? [];
    callback(types.length > 0 && types.every((type) => type === 'audio'));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    if (permission !== 'media') return false;
    const types = details?.mediaType ? [details.mediaType] : [];
    return types.length === 0 || types.every((type) => type === 'audio');
  });
  createWindow();
  app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); });

  // 检查更新。放在主进程而不是页面里：CSP 保持 `default-src 'self'` 不动，
  // 渲染进程永远发不出网络请求，只有「请你查一下」这个动作能过去（见 preload.cjs 的白名单）。
  const update = attachUpdate();
  ipcMain.on('update:check', async (event) => {
    // 版本号从 app 读，不信任页面传来的——页面传什么都不该影响「我是什么版本」。
    const current = app.getVersion();
    const result = await update.check(current);
    // 事件来源可能已经关了（用户点完立刻切走），send 会抛。
    if (!event.sender.isDestroyed()) event.sender.send('update:result', { current, result });
  });
  ipcMain.on('update:open', () => {
    // 不读 payload：要打开的地址是 check 时缓存在 update 里的那一个。
    update.open();
  });
});
// 小组件是独立窗口，主窗口关掉后它还在，所以不能靠「窗口全关」来退出。
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
