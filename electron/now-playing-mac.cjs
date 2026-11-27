// macOS 侧的「外部音乐」后端：把 media-control 的输出翻译成页面认得的快照。
//
// 和 Windows 那边的区别只在数据来源，**协议完全一样**：
// 都是长驻子进程往 stdout 每行写一个 JSON，主进程读行、解析、推给页面。
// 所以 now-playing.cjs 只负责调度，平台差异全收在这个文件里。
//
// 为什么需要 media-control 这一层：
// macOS 的系统级「别的应用在放什么」只有私有的 MediaRemote.framework 能问，
// 而 macOS 15.4 起 Apple 把它收紧成「只有 bundle id 以 com.apple.* 开头的进程
// 才能调」。Electron 应用不满足，直接调会被拒。media-control 的做法是把调用
// 塞进 /usr/bin/perl（bundle id 是 com.apple.perl）里跑，再把结果递出来。
//
// **这条依赖随时可能失效**：它靠的是系统的一个实现细节，Apple 补掉之后
// media-control 会先报错。所以这里的失败一律当成「没有外部音乐」静默处理，
// 绝不影响播放器本身的任何功能。
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * GUI 启动的 app 拿不到终端里的 PATH（通常只有 /usr/bin:/bin:/usr/sbin:/sbin），
 * 所以 brew 装在 /opt/homebrew/bin 下的东西必须写绝对路径去找。
 * 这是 macOS 上最常见的一个「终端里好好的，双击打开就说找不到命令」。
 */
const TOOL_CANDIDATES = [
  '/opt/homebrew/bin/media-control', // Apple Silicon 的 brew 默认位置
  '/usr/local/bin/media-control',    // Intel Mac / 旧 brew
  '/opt/local/bin/media-control',    // MacPorts
  // 没装 brew 的机器上，用户自己下载二进制放到 ~/.local/bin 是最可能的去处。
  // 少了这一条，toolPath() 会返回空串、start() 直接 false，整个外部音乐静默失效——
  // 症状是「明明装好了、命令行能跑，应用里就是不给显示」。
  path.join(os.homedir(), '.local', 'bin', 'media-control'),
];

/** 找 media-control 的绝对路径。找不到返回空串，调用方据此降级。 */
function toolPath() {
  for (const file of TOOL_CANDIDATES) {
    try {
      if (fs.existsSync(file)) return file;
    } catch { /* 权限问题也当作没有 */ }
  }
  return '';
}

/** 一次快照的初始态，字段与 Windows 侧、与 src/now-playing.ts 完全一致。 */
const EMPTY_STATUS = 'None';

/**
 * 把 media-control 的一条输出收成页面用的快照。
 *
 * 两种形状都要认：`get` 是平铺的 payload，`stream` 外面裹了一层 `{diff, payload}`。
 * 统一用 `raw.payload ?? raw` 提取，少一个分支。
 */
function parseLine(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  // 数组也必须是残缺的：typeof [] === 'object' 会漏过下面那道检查，
  // 然后被当成「一条什么都没有的快照」推给页面，把正在显示的封面清空。
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw.payload && typeof raw.payload === 'object' ? raw.payload : raw;
  if (Array.isArray(data)) return null;

  const text = (value) => (typeof value === 'string' ? value : '');
  const title = text(data.title);
  const playing = data.playing === true;

  // status 只有三种：有标题且在放 / 有标题但暂停 / 没标题。
  // 页面用 status === 'Playing' 反推 playing（见 src/now-playing.ts），
  // 所以这里的取值必须与 Windows 侧那四个字母完全对上。
  const status = title ? (playing ? 'Playing' : 'Paused') : EMPTY_STATUS;

  // 封面在 media-control 里是裸 base64 + 单独的 MIME 字段，
  // 而页面只接受 data URL（src/now-playing.ts 的 parseNowPlaying 会校验前缀）。
  const artwork = text(data.artworkData);
  const mime = text(data.artworkMimeType) || 'image/jpeg';
  const cover = artwork ? `data:${mime};base64,${artwork}` : '';

  return {
    // macOS 给的是 bundle id（com.spotify.client）。显示名的映射在
    // src/now-playing.ts 里做，这里只传原始标识，别在两个地方各写一份。
    app: text(data.bundleIdentifier),
    title,
    artist: text(data.artist),
    album: text(data.album),
    status,
    playing: status === 'Playing',
    cover,
  };
}

/** 动作名到 media-control 子命令的映射。页面发的是 MediaAction 那三个值。 */
const ACTIONS = {
  toggle: 'toggle-play-pause',
  // 页面历史上也发过 'prev'（见 NowPlaying.cs 的注释），这里两个都收。
  previous: 'previous-track',
  prev: 'previous-track',
  next: 'next-track',
};

class MacBackend {
  constructor() {
    /** 长驻的 stream 进程。null 表示没起来。 */
    this.child = null;
    this.buffer = '';
    /** 上一次推出去的快照里那几个「换歌才会变」的字段，用来跳过重复推送。 */
    this.signature = '';
    /** @type {((payload: object) => void) | null} */
    this.emit = null;
  }

  /**
   * 起长驻进程。返回 false 表示这次用不了（没装、启动失败），
   * 调用方会退回「没有外部音乐」而不是报错。
   */
  start(emit) {
    this.emit = emit;
    if (this.child) return true;
    const tool = toolPath();
    if (!tool) return false;

    try {
      // --no-diff：每行都给全量字段，省得自己维护「哪些字段这次没变」。
      // --debounce：播放器切歌时会连着吐好几条，200ms 内合并成一条。
      this.child = spawn(tool, ['stream', '--no-diff', '--debounce=200'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      this.child = null;
      return false;
    }

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.consume(chunk));
    // 子进程挂了就安静地当成「没有外部音乐」，不影响主程序。
    this.child.on('error', () => this.stop());
    this.child.on('exit', () => { this.child = null; });
    // stderr 直接丢掉：media-control 在系统版本不兼容时会往这里写诊断信息，
    // 那些内容对用户没有意义，但如果不消费管道，写满了会让子进程阻塞。
    this.child.stderr.on('data', () => undefined);
    return true;
  }

  consume(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      const payload = parseLine(line);
      if (!payload) continue;
      // stream 会跟着播放进度反复吐同一首歌。只有真的换了歌（或放/暂停变了）
      // 才往页面推——否则页面每 200ms 重算一次碟面配色，白白掉帧。
      const signature = [payload.app, payload.title, payload.artist, payload.album, payload.status].join('\u0000');
      if (signature === this.signature) continue;
      this.signature = signature;
      if (this.emit) this.emit(payload);
    }
    // 万一有播放器吐了超长行（封面 base64 可能几 MB），别让 buffer 无限涨。
    if (this.buffer.length > 24 * 1024 * 1024) this.buffer = '';
  }

  /**
   * 把动作交给外部播放器。
   *
   * 和 Windows 那边不一样：Windows 是往长驻进程的 stdin 写一行，
   * 而 media-control 是「一条命令一个进程」。每次起一个 perl 进程大约几十毫秒，
   * 连按两下会有轻微迟滞，但 mac 上没有更强的办法，也就这样了。
   */
  send(action) {
    const command = ACTIONS[action];
    if (!command) return false;
    const tool = toolPath();
    if (!tool) return false;
    try {
      const child = spawn(tool, [command], { stdio: 'ignore' });
      child.on('error', () => undefined);
      child.unref();
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    if (this.child) {
      const child = this.child;
      this.child = null;
      try { child.kill(); } catch { /* 已经退了 */ }
    }
    this.buffer = '';
    this.signature = '';
  }
}

module.exports = { MacBackend, parseLine, toolPath };
