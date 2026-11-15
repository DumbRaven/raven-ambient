/**
 * 专注小组件：一个无边框、透明、始终置顶的小窗口，独立于主窗口存在。
 *
 * 为什么是独立窗口而不是主窗口里的浮层：用户主窗口最小化之后，
 * 小窗还得留在桌面上，子窗口做不到这一点（主窗最小化会带走它）。
 *
 * 数据怎么走（两条路，按页面有没有 preload 自动选）：
 *
 *   有 preload：小窗发 `focus:action`、收 `focus:snapshot`，走 IPC 即送即达。
 *   没有 preload（探针自己建的窗口）：页面把状态挂到 window.__ravenFocusSnapshot，
 *     这里每 200ms 取一次；小窗上的点击攒在 window.__ravenMiniDrain() 里，
 *     这里取走再调页面的 window.__ravenFocusCommand('toggle')。
 */
const { BrowserWindow, screen, ipcMain } = require('electron');
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
    /** 小窗或主窗口用过 preload 的 IPC 通道。详见 tick() 的注释。 */
    this.viaIpc = false;
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
    // 只在小窗真的从「藏起来」变成「露出来」时做这两件事。
    //
    // tick() 每 200ms 就会调一次 reveal()，而窗口一旦露出来它就一直是可见的；
    // 每次都无条件 showInactive + setAlwaysOnTop 就是在反复做同一次原生调用，
    // 用户看不出区别，机器一直在付费。'screen-saver' 这一档是持续生效的，
    // 设一次就够了，不需要每轮刷新。
    if (!this.win.isVisible()) {
      this.win.showInactive();
      this.win.setAlwaysOnTop(true, 'screen-saver');
    }
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
        // 小窗也要 preload：它每 200ms 被推一次番茄钟读数，
        // 走 IPC 就不必让主进程去 eval 一段字符串。
        preload: path.join(__dirname, 'preload.cjs'),
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

    // 小窗存在时才从它那里收点击。
    //
    // 装了 preload 时这条走 ipcMain（见 attachFocusMini），这里的轮询就只剩
    // 一个用处：探针自己建的小窗没有 preload。轮询没取到东西时几乎不花钱，
    // 但要过一次沙箱边界——所以迷你窗一旦用过 IPC，就把这段关掉。
    if (!this.viaIpc && mini && !mini.isDestroyed() && !mini.webContents.isLoading()) {
      try {
        const actions = await mini.webContents.executeJavaScript('window.__ravenMiniDrain ? window.__ravenMiniDrain() : []');
        for (const action of Array.isArray(actions) ? actions : []) {
          await this.toHost(action);
        }
      } catch { /* 小窗正在加载或已关，下一轮再说 */ }
    }

    // 主窗口的计时状态 → 决定要不要显示、画到小窗上
    try {
      const snap = await host.webContents.executeJavaScript('window.__ravenFocusSnapshot || null');
      if (!snap) return;
      // 用户在主界面里按了「显示小窗」，这里把收起状态解除。
      // 走 IPC 的话 reveal 已经在 accept 里处理过了，这里只看标记。
      if (!this.viaIpc) {
        const wanted = await host.webContents.executeJavaScript('window.__ravenFocusWanted === true');
        if (wanted) {
          await host.webContents.executeJavaScript('window.__ravenFocusWanted = false; true');
          this.dismissed = false;
        }
      }
      if (snap.visible && !this.dismissed) this.reveal();
      else if (this.win && !this.win.isDestroyed()) this.win.hide();
      this.publish(snap);
    } catch { /* 同上 */ }
  }

  /** 把读数画到小窗上。有 preload 走 IPC，否则 eval 那段旧代码。 */
  publish(snap) {
    const target = this.win;
    if (!target || target.isDestroyed() || target.webContents.isLoading()) return;
    if (this.viaIpc) {
      target.webContents.send('focus:snapshot', snap);
      return;
    }
    target.webContents.executeJavaScript(
      'window.__ravenMiniPaint ? window.__ravenMiniPaint(' + JSON.stringify(snap) + ') : null',
    ).catch(() => undefined);
  }

  /** 小窗上按下的动作转给主窗口，由 FocusRoom 真正改状态（小窗不碰计时逻辑）。 */
  async toHost(action) {
    if (action === 'close') { this.hide(); return; }
    const host = this.host;
    if (!host || host.isDestroyed()) return;
    if (this.viaIpc) {
      // 用 `focus:press` 而不是小窗发来的 `focus:action`：preload 的收发两份
      // 白名单互不相交，要让主窗口能收这条就得换个名字（见 preload.cjs 的 RECEIVE）。
      host.webContents.send('focus:press', action);
      return;
    }
    try {
      await host.webContents.executeJavaScript(
        'window.__ravenFocusCommand ? window.__ravenFocusCommand(' + JSON.stringify(action) + ') : null',
      );
    } catch { /* 主窗口正在加载 */ }
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

/**
 * 页面通过 preload 发进来的动作。
 *
 * 同一个通道名两边都在用，所以要按**谁发的**分开处理：
 *   - 小窗发来的（toggle / skip / prev / next / close）转给主窗口，由 FocusRoom 改状态；
 *   - 主窗口发来的只有 'reveal'，意思是「把小窗找回来」。
 * 不分开的话，主窗口发 reveal 会被当成小窗动作再转回去，形成一个自己转自己的圈。
 *
 * ⚠ 这个监听**必须在模块级只注册一次**，不能放进 attachFocusMini 里。
 * 那个函数每次 createWindow() 都会调一遍，而主窗口可以销毁后重建
 * （second-instance 的 !mainWindow 分支、macOS 的 activate）——放进去就会让
 * 同一条通道挂上两个监听器，一次暂停被 toggle 两下、一次切歌跳两首。
 * 它操作的是模块级单例 `mini`，本来也不依赖是哪个窗口触发的注册。
 */
ipcMain.on('focus:action', (event, action) => {
  if (typeof action !== 'string') return;
  const senderIsMini = !!mini.win && !mini.win.isDestroyed() && event.sender === mini.win.webContents;
  if (senderIsMini) {
    mini.viaIpc = true;
    void mini.toHost(action);
    return;
  }
  if (action === 'reveal') {
    mini.viaIpc = true;
    mini.dismissed = false;
    mini.reveal();
  }
});

function attachFocusMini(host) {
  mini.attach(host);
  // 主窗口关掉就一起收掉，别留一个孤儿小窗在桌面上。
  // 这个是窗口级监听（只对当前这个主窗口有意义），所以留在函数里。
  host.on('closed', () => mini.destroy());
  return mini;
}

module.exports = { attachFocusMini, focusMini: mini, MINI_WIDTH, MINI_HEIGHT };
