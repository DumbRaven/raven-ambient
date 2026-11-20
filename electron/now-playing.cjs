// 外部音乐信息：常驻一个只读小程序，把「别的播放器在放什么」推给渲染进程。
//
// 页面是 sandbox: true + 无 preload，里面没有 ipcRenderer，也不允许改这个安全设置。
// 但主进程可以主动在页面里执行代码，所以约定是这样：
//   页面把 'start' / 'stop' / 'ping' / 动作（toggle、next、prev）压进 outbox 数组
//   主进程每 400ms 去读它；想要推送，页面把 window.__ravenNowPlaying 挂上。
// 也就是说页面永远是被动的一方，不依赖任何 Node 能力。
//
// 两个平台的后端是 **两个文件**，协议相同：
//   Windows：NowPlaying.exe（C#，读系统媒体会话 SMTC），本文件直接 spawn 它
//   macOS  ：media-control（brew 装的 perl CLI，绕过 MediaRemote 的 bundle id 限制），
//            平台差异全收在 now-playing-mac.cjs 里
// 本文件只做调度：谁提供数据、数据怎么送到页面。判断依据见下面的 backend()。
const { spawn } = require('node:child_process');
const { ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const EMPTY = { app: '', title: '', artist: '', album: '', status: 'None', playing: false, cover: '' };
// 页面把动作写进这个数组，主进程来取。见 src/now-playing-bridge.ts 的说明。
const OUTBOX = 'window.__ravenNowPlayingOutbox';

// 打包后 exe 在 app.asar 里？不行——asar 里的文件不能直接执行，得解包。
// 所以用 asarUnpack 把它放到 app.asar.unpacked，这里按两种布局各找一次。
function exePath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron', 'nowplaying', 'NowPlaying.exe'),
    path.join(__dirname, 'nowplaying', 'NowPlaying.exe'),
  ];
  return candidates.find((file) => file && fs.existsSync(file)) || '';
}

// macOS 没有 exe 可找——数据源是用户自己 brew 装的 media-control，
// 位置由 now-playing-mac.cjs 的 TOOL_CANDIDATES 负责（GUI 启动拿不到终端 PATH）。
const IS_MAC = process.platform === 'darwin';

class NowPlayingBridge {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.target = null;
    // 最后一次推给页面的快照。页面切走再切回来时发 'ping'，直接把这份重发一遍，
    // 不用等辅助程序下一次变化（一首歌可能播好几分钟都不变）。
    this.last = EMPTY;
    /** 页面有没有用 preload 发过动作。详见 handle() 的注释。 */
    this.viaIpc = false;
    /**
     * macOS 的后端。**惰性 require**：这个文件只在 darwin 上有意义，
     * 在 Windows 上连加载都省了，也避免它那句「依赖可能随时失效」的注释
     * 被误读成 Windows 的行为。
     * @type {import('./now-playing-mac.cjs').MacBackend | null}
     */
    this.mac = null;
  }

  /**
   * 页面通过 preload 进来的动作。走这条就不再需要轮询 outbox。
   *
   * 与 `attachNowPlaying` 里那个 400ms 循环是同一个分发逻辑，
   * 只是入口不同：那边从页面数组里取，这边直接从 IPC 参数来。
   */
  async accept(webContents, action) {
    this.viaIpc = true;
    if (typeof action !== 'string') return;
    if (action === 'start') this.start(webContents);
    else if (action === 'ping') this.replay(webContents);
    else if (action === 'stop') this.stop();
    else this.send(action);
  }

  /** 把手上这份快照立刻重发给页面。 */
  replay(webContents) {
    this.handle(webContents || this.target, this.last);
  }

  handle(webContents, payload) {
    this.last = payload;
    if (!webContents || webContents.isDestroyed()) return;
    // 只走一条路：页面用 preload 发过动作（accept）就走 IPC，否则用旧的全局量。
    // 两条一起发会让页面把同一份快照处理两次——`listenNowPlaying` 的回调会
    // 重新算一遍碟面配色，重复一次就是白掉一帧。
    if (this.viaIpc) {
      webContents.send('now:snapshot', payload);
      return;
    }
    webContents.executeJavaScript(`window.__ravenNowPlaying && window.__ravenNowPlaying(${JSON.stringify(payload)})`, true)
      .catch(() => undefined);
  }

  start(webContents) {
    this.target = webContents;
    // macOS：交给自己那个后端。它内部管长驻进程与去重，
    // 拿不到数据源（没装 media-control）时返回 false，这里就当成「没有外部音乐」。
    if (IS_MAC) {
      if (!this.mac) this.mac = new (require('./now-playing-mac.cjs').MacBackend)();
      const ok = this.mac.start((payload) => this.handle(this.target, payload));
      if (!ok) this.handle(webContents, EMPTY);
      return ok;
    }
    if (this.child) return true;
    const exe = exePath();
    if (!exe) { this.handle(webContents, EMPTY); return false; }
    try {
      // `--parent <pid>` 让子进程自己也能判断父进程还在不在。
      // 光靠 stdin 断掉不够：万一句柄被别的子进程继承，管道就不会断，
      // 那个 exe 会一直转到用户注销。见 NowPlaying.cs 的 stdinClosed 注释。
      this.child = spawn(exe, ['--watch', '--parent', String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch {
      this.child = null;
      this.handle(webContents, EMPTY);
      return false;
    }
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.consume(chunk));
    // 子进程挂了就安静地当成「没有外部音乐」，不影响主程序
    this.child.on('error', () => this.stop());
    this.child.on('exit', () => { this.child = null; });
    return true;
  }

  /**
   * 把动作交给常驻的辅助程序，由它去操作外部播放器。
   * 不另起进程：每次起 SMTC 连接要几百毫秒，连按两下会明显迟滞。
   */
  send(action) {
    if (IS_MAC) return this.mac ? this.mac.send(action) : false;
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) return false;
    try {
      this.child.stdin.write(action + '\n');
      return true;
    } catch {
      return false;
    }
  }

  consume(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      this.handle(this.target, parsed);
    }
    // 万一有播放器吐了超长行，别让 buffer 无限涨
    if (this.buffer.length > 8 * 1024 * 1024) this.buffer = '';
  }

  stop() {
    // macOS 的后端自己有进程要收，交回给它；下面那套 child/buffer 只有 Windows 用。
    if (this.mac) {
      try { this.mac.stop(); } catch { /* 已经退了 */ }
    }
    if (this.child) {
      const child = this.child;
      this.child = null;
      try { child.kill(); } catch { /* 已经退了 */ }
    }
    this.buffer = '';
  }
}

function attachNowPlaying() {
  const bridge = new NowPlayingBridge();

  /**
   * 页面通过 preload 发进来的动作。
   *
   * 有这条通道之后，下面那个 400ms 轮询就完全可以不跑了；但探针建的窗口
   * 没有 preload，仍然需要它。所以轮询留着，只是在页面明确用 IPC 说话之后
   * 就没什么可轮的了（outbox 会一直是空数组）。
   *
   * **只认主窗口**：子窗口（桌面放映窗、专注小窗）共用同一份 preload，
   * 也能发这条通道。让它们发进来会 `bridge.start()` 一个空窗口——外部播放器
   * 的 outbox 挂在那块全屏透明窗上，主窗口按什么都没反应。
   */
  ipcMain.on('now:action', (event, action) => {
    if (isSubWindow(event.sender)) return;
    void bridge.accept(event.sender, action);
  });

  // 页面没有 preload 时，只能靠主进程主动去取它的 outbox。
  // 400ms 一次，空数组时几乎不花钱；拿到就清空，避免重复执行。
  setInterval(async () => {
    // 已经走 IPC 的页面不必再轮询：它的 outbox 永远是空的，
    // 每 400ms 白跑一次 executeJavaScript（每次都要过一遍沙箱边界）。
    if (bridge.viaIpc) return;
    // 必须排除两个子窗口：它们也是 BrowserWindow，而且里面没有 outbox 这套变量。
    // 以前按 [0] 取，只有一个窗口时没事；有了小窗之后可能取到小窗，
    // 于是命令永远读不到，传输键看着像失灵。桌面放映窗是同一类，别漏第二个。
    const win = require('electron').BrowserWindow.getAllWindows()
      .find((item) => !item.isDestroyed() && !isSubWindow(item.webContents));
    if (!win || win.isDestroyed()) return;
    let actions;
    try {
      actions = await win.webContents.executeJavaScript(`(() => {
        const list = ${OUTBOX};
        if (!Array.isArray(list) || list.length === 0) return [];
        ${OUTBOX} = [];
        return list;
      })()`, true);
    } catch { return; }
    for (const action of actions || []) {
      if (action === 'start') bridge.start(win.webContents);
      else if (action === 'ping') bridge.replay(win.webContents);
      else if (action === 'stop') bridge.stop();
      else bridge.send(action);
    }
  }, 400).unref?.();

  return bridge;
}

module.exports = { attachNowPlaying, exePath };
