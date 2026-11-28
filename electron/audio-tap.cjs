/**
 * macOS 上抓系统正在播放的声音。
 *
 * 为什么需要这个文件：外部音乐模式要「响起时压低环境音」，就必须真的拿到
 * 播放器输出的音频流。Windows 上靠 VB-Cable 这类虚拟声卡（用户手动装），
 * macOS 上没有等价的免费方案，我们实测排除了两条更省事的路：
 *
 *   1. Electron 的 `audio: 'loopback'` —— electron.d.ts 原文写明只支持 Windows。
 *      在 darwin 上给这个值，拿到的是 readyState 立刻为 ended 的死轨。
 *   2. `setDisplayMediaRequestHandler(..., { useSystemPicker: true })` ——
 *      Aqua 会话下 getDisplayMedia 直接超时，连 video 都起不来。
 *
 * 所以走 Core Audio process tap：`vendor/audiotee` 是个第三方预编译二进制
 * （MIT，见同目录 NOTICE），它把系统音频以裸 PCM 写到 stdout。我们做的只是
 * 把它接进来，不碰音频驱动、不要内核扩展。
 *
 * 完整实验记录在 docs/macOS-实测记录.md 第 5.4 节。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** 与页面侧约定好的格式。改这里要同步改 src/audio-tap.ts 的 AudioData 构造。 */
const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2; // audiotee 输出 16-bit 有符号小端
const CHUNK_MS = 200;

/**
 * 每个音频块的上限，超过就丢。
 *
 * IPC 是有序的，积压起来只会让「现在听到的声音」越来越晚到，最后变成回音。
 * 45 块 ≈ 9 秒，正常永远撞不到；撞到了说明渲染进程卡住了，那时候丢掉旧数据
 * 比让它追上来更接近用户预期。
 */
const MAX_QUEUE = 45;

/**
 * 二进制的路径。
 *
 * **不能在 asar 里**：可执行文件被塞进 asar 之后没法被 spawn。
 * 所以 scripts/package-mac.cjs 把它列在 asarUnpack 里，打包后实际位置是
 * `app.asar.unpacked/electron/vendor/audiotee`。开发时直接读仓库里的那份。
 *
 * 这里用字符串替换而不是 `app.isPackaged` 判断：开发态也存在「用 asar 跑」
 * 的调试场景，按路径形态判断两种情况都能过。
 */
function binaryPath() {
  const packaged = __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  return path.join(packaged, 'vendor', 'audiotee');
}

/**
 * 抓取器。全局只有一个实例——tap 本身就是系统级的，起两个没有意义，
 * 而且两个进程同时读同一路系统音频会互相抢。
 */
class AudioTap {
  constructor() {
    this.child = null;
    this.target = null;
    this.pending = 0;
    /** 上一次推给页面的状态，用于只在变化时发送（每 200ms 一条状态消息会把通道淹了）。 */
    this.state = '';
    /** 子进程活过一次之后是否被我们自己停掉。用来区分「用户关了」和「它自己崩了」。 */
    this.stopping = false;
    /**
     * 意图号。每收到一次 start/stop 就 +1。
     *
     * 因为 start 里要等一次异步的权限询问，慢的那次回来时用户的意图可能已经变了
     * （点了开又立刻点关）。比对这个号就能把过期的意图丢掉，不会出现
     * 「关了之后进程又被拉起来」。
     */
    this.intent = 0;
  }

  /** 页面上显示什么由这个决定：live 表示真的有音频在流。 */
  report(next, reason = '') {
    if (next === this.state && !reason) return;
    this.state = next;
    // 带上状态名本身，不只给一个 live 布尔。
    //
    // 页面侧靠它分辨「还在问权限」（asking）与「已经有结论」（denied/error）。
    // 只给 live 的话这两类是同一个值（都是 false），页面会把「正在等用户点弹窗」
    // 当成「用户已经拒绝了」，于是开关一按下去就显示失败文案，弹窗还没出来。
    this.post({ type: 'state', live: next === 'live', state: next, reason });
  }

  post(message) {
    const target = this.target;
    if (!target || target.isDestroyed()) return;
    target.send('tap:chunk', message);
  }

  /**
   * 起一个抓取进程。
   *
   * 返回 false 表示「这条路这次没成」。具体是哪种没成，页面靠紧接着收到的
   * state 消息分辨——三种结局各不相同，不能混成一句「没声音」：
   *
   *   unsupported —— 不是 mac。页面据此退回虚拟声卡那条老路（Windows 正常情况）。
   *   denied      —— 用户拒绝了系统音频录制权限。这是**可解释的失败**，
   *                  页面要给出去哪开的指引，而不是让用户对着「打开了但没声」发呆。
   *   missing     —— 包里没带二进制。属于打包事故，不该在用户机上出现。
   */
  async start(target) {
    this.target = target;
    if (process.platform !== 'darwin') {
      this.report('unsupported', '系统音频抓取只在 macOS 上可用');
      return false;
    }
    // 同一个页面重复点开关：不重启进程，只把数据改发到新的页面对象上。
    // 主窗口刷新过一次之后 webContents 会换，但进程还能用，省一次重启。
    if (this.child) return true;

    const bin = binaryPath();
    if (!fs.existsSync(bin)) {
      this.report('missing', '安装包里缺少音频抓取程序');
      return false;
    }

    // 立刻报一句「正在问权限」，再去做那件要等用户点弹窗的事。
    //
    // 这条是给页面判断用的：它收到它，就说明抓取这条路在这台机器上是成立的
    // （平台对、二进制在），于是可以把 MediaStream 建起来交给音频图；
    // 至于后面有没有声音，是另一件事，走 denied/live 那两条状态。
    // 少了这一条，页面只能等到权限询问结束才知道该不该建流，
    // 用户要是在弹窗前面犹豫十秒，页面就干等十秒。
    this.report('asking', '');

    // 打包解出来之后可执行位可能丢，每次启动顺手补上。失败不影响流程：
    // 如果它本来就可执行，chmod 只是白做一次。
    try { fs.chmodSync(bin, 0o755); } catch { /* 只读挂载之类的情况，交给 spawn 报错 */ }

    // 主动要一次权限（这就是「方案 C」）。
    //
    // 为什么必须主动要：macOS 对「系统音频录制」不一定弹窗。audiotee 的 README
    // 原话是「至少一些常见终端会安安静静地录一段全零」——不主动要，用户看到的
    // 症状是「开关打开了但没声音」，而不是「缺权限」，这两个的修法完全不同。
    //
    // 用 screen 这一档：macOS 把系统音频录制挂在同一个隐私面板（「录屏与系统录音」）
    // 的同一套 TCC 条目下，没有单独的 API 可以问「能不能录系统声音」。
    // 已经授权过时这个调用立刻返回 true，不会重复弹窗。
    const allowed = await askScreen();
    if (!allowed) {
      this.report('denied', '系统拒绝了系统音频录制权限');
      return false;
    }

    this.stopping = false;
    const child = spawn(bin, [
      '--sample-rate', String(SAMPLE_RATE),
      // 块太小时 IPC 消息量上去了，太大时起播延迟明显。200ms 是两者都能忍的中间值。
      '--chunk-duration', String(CHUNK_MS / 1000),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', chunk => this.feed(chunk));

    // stderr 必须消费掉。audiotee 把日志写在这里（stdout 只放裸 PCM），
    // 不读的话管道写满会把它阻塞住——表现是「抓了几秒就不动了」，很难查。
    let tail = '';
    child.stderr.on('data', data => {
      tail = (tail + String(data)).slice(-400);
    });

    child.on('error', error => {
      this.child = null;
      this.report('error', error.message);
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      // 我们自己停的就不报错。用户关掉开关还看到一句红字是最讨厌的。
      if (this.stopping) { this.report('idle'); return; }
      // 没授权的时候 audiotee 不一定退出，但权限被撤销、或系统音频服务重启时它会退。
      // 把 stderr 尾巴带上，日志里能看出是哪一种。
      this.report('error', tail.trim() || `抓取程序退出了（${signal || code}）`);
    });

    this.child = child;
    this.report('live');
    return true;
  }

  /**
   * 把 stdout 的字节流切成整块推给页面。
   *
   * 必须自己攒：管道给的是任意长度的片段，一次 data 可能是 1 字节也可能是 3 块半。
   * 没有这一点，页面那边拿到的字节永远对不齐 16 位样本的边界，声音会全是噪声。
   */
  feed(chunk) {
    const buffer = Buffer.isBuffer(this.pending) ? Buffer.concat([this.pending, chunk]) : chunk;
    let offset = 0;

    const chunkBytes = (SAMPLE_RATE * CHUNK_MS / 1000) * CHANNELS * BYTES_PER_SAMPLE;
    while (buffer.length - offset >= chunkBytes) {
      const piece = buffer.subarray(offset, offset + chunkBytes);
      offset += chunkBytes;
      this.push(piece);
    }

    this.pending = offset ? buffer.subarray(offset) : buffer;
    // 半个样本永远凑不齐的情况：说明流的格式和我们假设的不一样
    // （audiotee 升级改了位深/声道）。留着这一个字节只会让后面全部错位。
    if (this.pending.length === 1) this.pending = Buffer.alloc(0);
  }

  push(piece) {
    const target = this.target;
    if (!target || target.isDestroyed()) return;
    // 结构化克隆会把 Buffer 变成 Uint8Array，页面侧拿到的是普通数组视图，
    // 比传数组快得多，也省掉一次 JSON 序列化。
    const bytes = new Uint8Array(piece.buffer.slice(piece.byteOffset, piece.byteOffset + piece.byteLength));
    target.send('tap:chunk', { type: 'pcm', sampleRate: SAMPLE_RATE, channels: CHANNELS, bytes });
  }

  stop() {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.pending = 0;
    this.state = '';
    this.target = null;
    if (!child) return;
    // SIGTERM 够用：它只是不写 stdout 了。SIGKILL 留给下面的兜底，
    // 因为卡在 Core Audio 调用里的时候它对 SIGTERM 没有反应。
    try { child.kill('SIGTERM'); } catch { /* 已经退了 */ }
    const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 已经退了 */ } }, 2000);
    killTimer.unref();
  }
}

/**
 * 问一次「能不能录系统声音」。
 *
 * 用 `systemPreferences.askForMediaAccess` 而不是页面的 `getDisplayMedia`：
 * 后者会真的去起一条采集流，起失败时留给我们的信息只有一句 AbortError
 * （本轮实测就是这样，见 docs/macOS-实测记录.md 第 5.4 节）。
 * `askForMediaAccess` 只问权限，不建流，失败原因也干净。
 *
 * ⚠ 它接受的值只有那几种，'screen' 是其中唯一与系统音频录制相关的。
 * 授权过之后立刻返回 true，不会重复弹窗——所以每次启动都问是安全的。
 */
async function askScreen() {
  try {
    const { systemPreferences } = require('electron');
    if (typeof systemPreferences?.getMediaAccessStatus !== 'function') return true;
    // 已经拒过一次的机器上 askForMediaAccess 不会再弹窗，只会返回 false。
    // 那种情况由页面侧引导用户去系统设置里手动开。
    if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return true;
    return await systemPreferences.askForMediaAccess('screen');
  } catch {
    // 拿不到这个 API（旧版 Electron、或非 mac）时不阻断：让抓取进程自己去试，
    // 它那边读到全零，页面会显示「收到但没有声音」这一类状态。
    return true;
  }
}

/**
 * 挂上两个通道。
 *
 * 只接受主窗口发来的 start/stop：子窗口（番茄钟、桌面放映窗）也会加载
 * preload，但它们不该能起停系统级抓取——那属于「谁在用谁负责」，而使用方只有主窗口。
 */
function attachAudioTap({ isMainWindow }) {
  const tap = new AudioTap();

  const { ipcMain } = require('electron');
  ipcMain.on('tap:start', event => {
    if (!isMainWindow(event.sender)) return;
    // start 现在要等一次权限询问，是异步的；期间用户可能又点了关。
    // 用一条递增的意图号挡住「点了开、又点关、开的那次晚回来又把进程拉起来」。
    tap.intent += 1;
    const mine = tap.intent;
    void tap.start(event.sender).then(ok => {
      if (mine !== tap.intent) { tap.stop(); return; }
      if (!ok) return; // 起不来说明平台、权限或二进制有问题，状态已经发回去了
      event.sender.once('destroyed', () => { if (tap.target === event.sender) tap.stop(); });
    });
  });
  ipcMain.on('tap:stop', event => {
    if (!isMainWindow(event.sender)) return;
    tap.intent += 1;
    tap.stop();
  });

  return { stop: () => tap.stop() };
}

module.exports = { attachAudioTap, binaryPath, SAMPLE_RATE, CHANNELS, CHUNK_MS };
