/**
 * 桌面放映窗：把放映台单独摆到桌面上的那个窗口。
 *
 * 为什么要独立窗口：主窗口最小化之后画面还得留在桌面上（同 focus-mini 的理由），
 * 而且这个窗口要全屏铺满、不进任务栏、不抢焦点——这些都是窗口级属性，
 * 主窗口里的一个浮层做不到。
 *
 * 为什么不是「真·壁纸层」（Folia 那条路）：那需要把窗口 SetParent 到 WorkerW，
 * 之后窗口在图标层**底下**，物理上收不到鼠标，得再用 Raw Input 旁路抓事件、
 * 换算坐标、sendInputEvent 注入回去（几千行，还要管多屏 / DPI / 全屏）。
 * 用户要的是「能看能点」，所以走这一版：一个普通但退到后面去的窗口。
 *
 * 数据怎么走：和 focus-mini.cjs 同一套——两个渲染进程之间没有 IPC，
 * 主进程定时从主窗口取快照推给桌面窗，再把桌面窗攒下的点击转回主窗口。
 */
const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('node:path');

/** 多久搬一次。200ms 跟 focus-mini 一致：拖动叠加元素时足够跟手，又不至于把 CPU 喂饱。 */
const POLL = 200;

/**
 * 这个窗口要不要拿焦点。
 *
 * 不分平台的写法是 `focusable: false`，但那会连带**收不到鼠标事件**
 * （Windows 上不可聚焦的窗口照样能点，这一步没问题；问题在于
 * `alwaysOnTop: false` 的普通窗口一旦被别的窗口盖住就点不到了）。
 * 所以策略是：窗口正常可点，但不主动抢焦点（showInactive）。
 */
class DesktopStage {
  constructor() {
    /** @type {BrowserWindow | null} */
    this.win = null;
    /** @type {BrowserWindow | null} 主窗口 */
    this.host = null;
    this.timer = undefined;
    /** 上一份推过去的快照，用来跳过没变化的重绘。 */
    this.lastPushed = '';
    /** 桌面窗有没有用 preload 发过动作。详见 tick() 的注释。 */
    this.viaIpc = false;
  }

  attach(host) {
    this.host = host;
  }

  /** 主窗口说「放到桌面」，就把窗口开出来；已经开着就重新摆一次。 */
  show() {
    if (this.win && !this.win.isDestroyed()) {
      this.place();
      if (!this.win.isVisible()) this.win.showInactive();
      return;
    }
    this.create();
  }

  hide() {
    if (this.win && !this.win.isDestroyed()) this.win.close();
  }

  get open() {
    return !!this.win && !this.win.isDestroyed();
  }

  /**
   * 铺满主窗口所在的那一块屏。
   *
   * 用主窗口所在屏而不是主屏：用户把窗口拖到副屏上再点「放到桌面」，
   * 画面应该出现在他正看着的那块屏幕上。
   */
  place() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const host = this.host;
    const bounds = host && !host.isDestroyed() ? host.getBounds() : null;
    const display = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay();
    // 用 bounds 而不是 workArea：这是一块画面，不是工作区里的一个窗口，
    // 任务栏压在上面是可以接受的（真的铺满才有「桌面上的画」的感觉）。
    win.setBounds(display.bounds);
  }

  create() {
    const host = this.host;
    const bounds = host && !host.isDestroyed() ? host.getBounds() : null;
    const display = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay();

    this.win = new BrowserWindow({
      ...display.bounds,
      frame: false,
      // 不进任务栏、不抢焦点：这是一块背景画面，不是一个要用户去切换的应用。
      skipTaskbar: true,
      // 不做 alwaysOnTop：它的定位是「桌面上的画」，压在别的窗口上面会挡事。
      // Electron 没有「压到最底层」的 API（那是 SetWindowPos(HWND_BOTTOM)），
      // 所以它就是一个普通窗口，被别的窗口盖住是正常行为。
      // 用户想看的时候最小化别的窗口就行，或者再点一次「放到桌面」把它提到前面。
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      hasShadow: false,
      // 透明：用户要的是「桌面上的场景壁纸从这块透上来」，所以窗口本身不能有底。
      // 这也意味着 backgroundColor 必须是全透明色，写 '#000000' 会让整块变黑。
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 和主窗口一样：这块画面不在前台时也要继续播，
        // 否则切到别的程序上画面就冻住了，那就不叫「桌面上的画」了。
        backgroundThrottling: false,
        // 桌面窗是另一个渲染进程，靠 preload 收放映快照、发点击，
        // 不必等主进程每 200ms 来取一次。
        preload: path.join(__dirname, 'preload.cjs'),
      },
    });

    this.win.setMenuBarVisibility(false);
    this.win.loadFile(path.join(__dirname, '../dist/desktop.html'));
    // showInactive：亮出来但不抢焦点。用户点「放到桌面」之后焦点还在主窗口上，
    // 接着还能在主窗口里继续操作。
    this.win.once('ready-to-show', () => {
      if (this.win && !this.win.isDestroyed()) this.win.showInactive();
    });
    this.win.on('closed', () => {
      this.win = null;
      this.lastPushed = '';
      // 窗口关掉就告诉主窗口一声，让那个按钮回到「未按下」的状态。
      if (this.viaIpc) {
        const host = this.host;
        if (host && !host.isDestroyed()) host.webContents.send('stage:closed');
      } else {
        this.toHost('window.__ravenStageClosed && window.__ravenStageClosed()');
      }
    });
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

  /** 在主窗口里执行一段脚本，出错吞掉——窗口可能正在关。 */
  async toHost(code) {
    const host = this.host;
    if (!host || host.isDestroyed() || host.webContents.isLoading()) return undefined;
    try {
      return await host.webContents.executeJavaScript(code);
    } catch {
      return undefined;
    }
  }

  /**
   * 主窗口通过 preload 推来的放映快照。
   *
   * 走这条就不必每 200ms 去主窗口问一次「现在放的是什么」——
   * 那条路每轮都要过一遍沙箱边界、把快照序列化过来。
   * 只在有桌面窗时才转发，窗口没开就没有收件人。
   */
  acceptSnapshot(snapshot) {
    const win = this.win;
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
    if (!snapshot || typeof snapshot !== 'object') return;
    const stamp = JSON.stringify(snapshot);
    if (stamp === this.lastPushed) return;
    this.lastPushed = stamp;
    win.webContents.send('stage:paint', snapshot);
  }

  async tick() {
    const host = this.host;
    const win = this.win;
    if (!host || host.isDestroyed()) return;
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return;

    // 1) 桌面窗上按下的东西 → 主窗口
    //
    // 走 IPC 时这条在 acceptCommand 里已经即时转过去了，不必再轮询。
    if (!this.viaIpc) {
      try {
        const actions = await win.webContents.executeJavaScript('window.__ravenDesktopDrain ? window.__ravenDesktopDrain() : []');
        for (const action of Array.isArray(actions) ? actions : []) {
          await this.toHost('window.__ravenStageCommand ? window.__ravenStageCommand(' + JSON.stringify(action) + ') : null');
        }
      } catch { /* 桌面窗正在加载或已关，下一轮再说 */ }
    }

    // 2) 主窗口的状态 → 桌面窗
    //
    // 主窗口用 preload 推快照时（acceptSnapshot），这里就没什么可问的了：
    // 快照已经在变的那一刻送过来了，轮询只会重复读同一份。
    if (this.viaIpc) return;
    try {
      const snapshot = await this.toHost('window.__ravenStageSnapshot || null');
      if (!snapshot) return;
      // 快照变了才推。每 200ms 重画一次整块舞台会白白触发 React 重渲染，
      // 而且视频元素会被反复 diff；实际内容一秒里往往只变一两次（番茄钟读数、进度）。
      const stamp = JSON.stringify(snapshot);
      if (stamp === this.lastPushed) return;
      this.lastPushed = stamp;
      await win.webContents.executeJavaScript(
        'window.__ravenDesktopPaint ? window.__ravenDesktopPaint(' + stamp + ') : null',
      );
    } catch { /* 同上 */ }
  }

  /**
   * 桌面窗通过 preload 发来的动作，立刻转给主窗口。
   *
   * 不等下一轮 tick：一次点击要走 200ms 轮询才能到主窗口，用户
   * 会觉得切歌键「按下去慢半拍」。
   */
  acceptCommand(event, command) {
    this.viaIpc = true;
    const host = this.host;
    if (!host || host.isDestroyed()) return;
    host.webContents.send('stage:command', command);
  }

  destroy() {
    this.stop();
    this.lastPushed = '';
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.host = null;
  }
}

const stage = new DesktopStage();

function attachDesktopStage(host) {
  stage.attach(host);

  /**
   * 桌面窗发来的动作。
   *
   * 只认桌面窗本人发的：主窗口也在同一个通道名上听（它收的是 stage:paint，
   * 不在这条上发），但将来要是有第三处往这条通道说话，不该被当成桌面窗的点击。
   */
  ipcMain.on('stage:command', (event, command) => {
    const win = stage.win;
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (!command || typeof command !== 'object') return;
    stage.acceptCommand(event, command);
  });

  /**
   * 主窗口通过 preload 推来的放映快照。
   *
   * 只认主窗口发的：桌面窗自己不会往这条通道写，但要是将来写了，
   * 不该被当成「主窗口的新状态」再推回给自己。
   */
  ipcMain.on('stage:snapshot', (event, snapshot) => {
    const host = stage.host;
    if (!host || host.isDestroyed() || event.sender !== host.webContents) return;
    stage.acceptSnapshot(snapshot);
  });

  host.on('closed', () => stage.destroy());
  return stage;
}

module.exports = { attachDesktopStage, desktopStage: stage, DESKTOP_POLL: POLL };
