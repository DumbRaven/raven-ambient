// 外部音乐信息：常驻 NowPlaying.exe，把「别的播放器在放什么」推给渲染进程。
//
// 页面是 sandbox: true + 无 preload，里面没有 ipcRenderer，也不允许改这个安全设置。
// 但主进程可以主动在页面里执行代码，所以约定是这样：
//   页面把 'start' / 'stop' / 'ping' / 动作（toggle、next、prev）压进 outbox 数组
//   主进程每次收到通道消息时去读它；想要推送，页面把 window.__ravenNowPlaying 挂上。
// 也就是说页面永远是被动的一方，不依赖任何 Node 能力。
const { ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHANNEL = 'raven-now-playing';
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

class NowPlayingBridge {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.target = null;
    // 最后一次推给页面的快照。页面切走再切回来时发 'ping'，直接把这份重发一遍，
    // 不用等辅助程序下一次变化（一首歌可能播好几分钟都不变）。
    this.last = EMPTY;
  }

  /** 把手上这份快照立刻重发给页面。 */
  replay(webContents) {
    this.handle(webContents || this.target, this.last);
  }

  handle(webContents, payload) {
    this.last = payload;
    if (!webContents || webContents.isDestroyed()) return;
    webContents.executeJavaScript(`window.__ravenNowPlaying && window.__ravenNowPlaying(${JSON.stringify(payload)})`, true)
      .catch(() => undefined);
  }

  start(webContents) {
    this.target = webContents;
    if (this.child) return true;
    const exe = exePath();
    if (!exe) { this.handle(webContents, EMPTY); return false; }
    try {
      this.child = spawn(exe, ['--watch'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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

  // 页面没有 preload，只能靠主进程主动去取它的 outbox。
  // 400ms 一次，空数组时几乎不花钱；拿到就清空，避免重复执行。
  setInterval(async () => {
    // 必须排除专注小窗：它也是 BrowserWindow，而且里面没有 outbox 这套变量。
    // 以前按 [0] 取，只有一个窗口时没事；有了小窗之后可能取到小窗，
    // 于是命令永远读不到，传输键看着像失灵。
    const win = require('electron').BrowserWindow.getAllWindows()
      .find((item) => !item.isDestroyed() && !String(item.webContents.getURL()).includes('mini.html'));
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

  // 兼容：外部（比如测试脚本）也可以直接走 IPC
  ipcMain.handle(CHANNEL, (event, action) => {
    if (action === 'start') { bridge.start(event.sender); return true; }
    if (action === 'ping') { bridge.replay(event.sender); return true; }
    if (action === 'stop') { bridge.stop(); return true; }
    return bridge.send(action);
  });
  return bridge;
}

module.exports = { attachNowPlaying, exePath, CHANNEL };
