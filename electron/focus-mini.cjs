/**
 * 专注小组件：一个无边框、透明、始终置顶的小窗口，独立于主窗口存在。
 *
 * 为什么是独立窗口而不是主窗口里的浮层：用户主窗口最小化之后，
 * 小窗还得留在桌面上，子窗口做不到这一点（主窗最小化会带走它）。
 *
 * 数据怎么走：页面（sandbox: true，没有 ipcRenderer）把番茄钟状态挂到
 * window.__ravenFocusSnapshot 上，这里定时取；小窗上的点击攒在
 * window.__ravenMiniDrain() 里，这里定时取走，再调页面里的
 * window.__ravenFocusCommand('toggle') 转给 React。
 */
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');

// 宽度跟着 mini.html 的 .card 走。切歌键与暂停/关闭各自竖成一列之后，
// 横向只占两列按钮的宽，306 就够，卡片也回到了原来矮胖的形状。
const MINI_WIDTH = 306;
const MINI_HEIGHT = 96;
const POLL = 200;

class FocusMini {
  constructor() {
    /** @type {BrowserWindow | null} */
    this.win = null;
    /** @type {BrowserWindow | null} 主窗口，用来问状态、转命令 */
    this.host = null;
    this.timer = undefined;
    /** 用户按过收起之后就别再自动冒出来，直到重新开始计时。 */
    this.dismissed = false;
    this.lastVisible = false;
  }

  attach(host) {
    this.host = host;
    // 一接上就开始轮询：小窗还没建的时候也要能读到页面状态，
    // 否则「等页面说要显示才建窗口」和「等窗口建好才知道页面状态」互相等，谁也动不了。
    this.start();
  }

  /** 主窗口那边说「现在该显示了」，就把小窗建出来（或者拉回最上层）。 */
  reveal() {
    if (!this.win || this.win.isDestroyed()) {
      this.create();
      return;
    }
    if (!this.win.isVisible()) this.win.showInactive();
    this.win.setAlwaysOnTop(true, 'screen-saver');
  }

  hide() {
    this.dismissed = true;
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  create() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.showInactive();
      return;
    }
    const area = screen.getPrimaryDisplay().workArea;
    this.win = new BrowserWindow({
      width: MINI_WIDTH,
      height: MINI_HEIGHT,
      // 默认贴在右上角，避开任务栏和常见的窗口标题栏。
      x: area.x + area.width - MINI_WIDTH - 24,
      y: area.y + 24,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    // 'screen-saver' 是最硬的一档，主窗最小化、别的程序全屏都能压住。
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.loadFile(path.join(__dirname, 'mini.html'));
    this.win.once('ready-to-show', () => { if (this.win && !this.win.isDestroyed()) this.win.showInactive(); });
    this.win.on('closed', () => { this.win = null; });
    this.start();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, POLL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick() {
    const host = this.host;
    if (!host || host.isDestroyed()) return;
    // 页面还在加载时 executeJavaScript 会直接抛，等它加载完再来。
    if (host.webContents.isLoading()) return;
    const mini = this.win;

    // 小窗存在时才从它那里收点击
    if (mini && !mini.isDestroyed() && !mini.webContents.isLoading()) {
      try {
        const actions = await mini.webContents.executeJavaScript('window.__ravenMiniDrain ? window.__ravenMiniDrain() : []');
        for (const action of Array.isArray(actions) ? actions : []) {
          if (action === 'close') { this.hide(); continue; }
          // 转给页面，由 FocusRoom 真正改状态（小窗不碰计时逻辑）
          await host.webContents.executeJavaScript(
            'window.__ravenFocusCommand ? window.__ravenFocusCommand(' + JSON.stringify(action) + ') : null',
          );
        }
      } catch { /* 小窗正在加载或已关，下一轮再说 */ }
    }

    // 主窗口的计时状态 → 决定要不要显示、画到小窗上
    try {
      const snap = await host.webContents.executeJavaScript('window.__ravenFocusSnapshot || null');
      if (!snap) return;
      // 用户在主界面里按了「显示小窗」，这里把收起状态解除。
      const wanted = await host.webContents.executeJavaScript('window.__ravenFocusWanted === true');
      if (wanted) {
        await host.webContents.executeJavaScript('window.__ravenFocusWanted = false; true');
        this.dismissed = false;
      }
      if (snap.visible && !this.dismissed) this.reveal();
      else if (this.win && !this.win.isDestroyed()) this.win.hide();
      const target = this.win;
      if (target && !target.isDestroyed() && !target.webContents.isLoading()) {
        await target.webContents.executeJavaScript(
          'window.__ravenMiniPaint ? window.__ravenMiniPaint(' + JSON.stringify(snap) + ') : null',
        );
      }
    } catch { /* 同上 */ }
  }

  /** 主窗口说「这一轮彻底结束了」，收起并解除 dismissed 锁。 */
  reset() {
    this.dismissed = false;
    this.lastVisible = false;
  }

  destroy() {
    this.stop();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.host = null;
  }
}

const mini = new FocusMini();

function attachFocusMini(host) {
  mini.attach(host);
  // 主窗口关掉就一起收掉，别留一个孤儿小窗在桌面上。
  host.on('closed', () => mini.destroy());
  return mini;
}

module.exports = { attachFocusMini, focusMini: mini, MINI_WIDTH, MINI_HEIGHT };
