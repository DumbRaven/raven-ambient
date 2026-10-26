const { app, BrowserWindow, screen, session } = require('electron');
const path = require('node:path');
const { attachNowPlaying } = require('./now-playing.cjs');
const { attachFocusMini } = require('./focus-mini.cjs');

if (process.env.RAVEN_DATA_DIR) app.setPath('userData', path.resolve(process.env.RAVEN_DATA_DIR));

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
    backgroundMaterial: 'none',
    title: 'Raven Ambient Bold · 唱片柜',
    icon: appIcon(),
    autoHideMenuBar: true,
    // 先不显示：窗口一出现就露出底色，蓝色的空壳比白屏还难看。
    // 等页面画出第一帧（开屏）再亮出来，用户点开就是 logo。
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
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
  return win;
}

// Electron 的锁按 userData 目录隔离，验证目录不会占用正式收藏的实例。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
app.on('second-instance', () => {
  // 只找主窗口：小组件也是 BrowserWindow，按数组下标取会拿到它。
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows().find(w => w.isVisible() && !w.isAlwaysOnTop());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});
app.whenReady().then(() => {
  attachNowPlaying();
  // 默认一律拒绝，只放行音频输入——外部音乐就是从这里进来的（虚拟声卡输出）。
  // 摄像头、麦克风以外的权限、通知、地理位置等仍然全部拒绝。
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
});
// 小组件是独立窗口，主窗口关掉后它还在，所以不能靠「窗口全关」来退出。
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
