/**
 * 三个渲染进程（主窗、桌面放映窗、专注小窗）与主进程之间的通道。
 *
 * 为什么现在才加：此前页面跑在 `sandbox: true` 里，`window` 上没有 ipcRenderer，
 * 所以四个子系统（媒体库、外部音乐、番茄钟小窗、桌面放映窗）都退化成
 * 「页面把状态挂到 window 上，主进程定时来取」——每 200~400ms 轮询一次，
 * 而且主进程要往另一个渲染进程送东西时，得用 `executeJavaScript` 拼一段代码字符串过去 eval。
 *
 * 那套办法能用，但代价是实打实的：
 *   1. 用户点「添加文件夹」，最坏要等 400ms 主进程才来取走，对话框才弹出来；
 *   2. 五个定时器常驻，空闲时每秒也要醒好几次；
 *   3. 拼字符串过去 eval，一旦哪天真塞进一个带反斜杠的标题就会炸，
 *      而且这条路没法写类型、没法单测。
 *
 * **sandbox: true 与 preload 并不冲突**。沙箱里的 preload 拿不到 fs / child_process，
 * 但 `contextBridge` 与 `ipcRenderer` 是明确允许的——这正是它被设计出来的场景。
 * 所以这里只做两件事：把「发」和「收」暴露给页面，别的什么都不给。
 *
 * ⚠ 白名单必须写在这个文件里，不能像主进程模块那样 `require('./channels.cjs')`。
 * 沙箱里的 `require` 是受限版本，只认 electron 内置与少数白名单，相对路径会
 * 直接报 `module not found: ./channels.cjs`——而且这错是在 preload 加载阶段抛的，
 * 页面侧只会看到 `window.raven` 是 undefined，一点线索都没有。
 * 测试 `tests/channels.test.ts` 用正则读这个文件的源码来守这条边界。
 *
 * 页面侧仍然保留旧的 window 全局量那一套（见 src/media.ts 等），
 * 因为 tools/probe 下的探针自己建窗口、自己定 webPreferences，不会被装 preload；
 * 没有 preload 时页面自动退回轮询，探针照旧能用。两套并存的判断只有一处，
 * 在每个 bridge 模块的 `channel()` 里。
 */

const { contextBridge, ipcRenderer } = require('electron');

/** 页面 → 主进程。加通道必须改这里，改这里就会在 diff 里被看见。 */
const SEND = new Set([
  /** 媒体库：选目录、选文件、重扫、遗忘、扫壁纸、恢复目录、全屏、桌面窗开关。 */
  'media:request',
  /** 外部音乐：start / stop / ping / toggle / next / prev。 */
  'now:action',
  /** 番茄钟小窗：小窗发 toggle / skip / close / prev / next，主窗口发 reveal。 */
  'focus:action',
  /** 桌面放映窗上按下的动作（切歌、换石头、改雨量、回传图层）。 */
  'stage:command',
  /** 主窗口把放映快照推给主进程，由它转给桌面窗。 */
  'stage:snapshot',
  // 设置面板点了「检查更新」。主进程去问一次 GitHub，结果走 receive 的 update:result。
  'update:check',
  /**
   * 设置面板点了「去下载」。
   *
   * ⚠ 这条**不带参数**，传了也用不上：主进程只打开它自己上一次查到并缓存的地址。
   * 如果允许页面传 URL 过来，这个通道就变成「打开任意网址」——那是最容易被
   * 利用来钓鱼的形状，而它本身只需要一个固定动作。
   */
  'update:open',
  /**
   * macOS 系统音频抓取的开关（外部音乐模式的音频来源）。
   *
   * Windows 上这一层不存在：那边是页面自己 getUserMedia 拿虚拟声卡。
   * mac 上要由主进程起一个子进程去读 Core Audio tap，所以页面得能请它开关。
   * 只接受主窗口的请求，子窗口发来的一律丢弃（见 electron/audio-tap.cjs）。
   */
  'tap:start',
  'tap:stop',
]);

/**
 * 主进程 → 页面。与 SEND 分开列：一条通道两个方向都能用，页面就能伪造主进程的消息。
 *
 * ⚠ 这里和 SEND **逐条不相交**，两条转发通道也因此改过名：
 *   `stage:command` / `focus:action` 是「页面发、主进程收」，主进程要把同一条动作
 *   **再送到另一个渲染进程**时走的是 `stage:press` / `focus:press`。
 *   原本两边共用同一个通道名，页面侧来 on() 时被白名单拒掉，
 *   于是桌面窗点切歌、小窗点暂停全都是静默丢弃——而 `viaIpc` 已经被置 true，
 *   连轮询那条旧路也一起关了。取名分开而不是加一个「双向白名单」，
 *   是因为这份名单防的正是「页面自己伪造一条主进程推来的消息」，两个方向共用就白防了。
 */
const RECEIVE = new Set([
  /** 媒体库的扫描结果、放行目录、拒收原因。 */
  'media:message',
  /** 外部播放器当前在放什么。 */
  'now:snapshot',
  /** 番茄钟读数，推给桌面小窗。 */
  'focus:snapshot',
  /** 小窗上按下的动作，主进程转给主窗口（见下面 SEND 里同名的那条）。 */
  'focus:press',
  /** 放映快照，推给桌面放映窗。 */
  'stage:paint',
  /** 桌面放映窗被关掉了，主窗口需要知道。 */
  'stage:closed',
  /** 桌面放映窗上按下的动作，主进程转给主窗口（见下面 SEND 里同名的那条）。 */
  'stage:press',
  /**
   * 检查更新的结果。形状三选一，页面按 status 判：
   * `current` 已是最新 / `newer` 有新版本（带 version、notes、url）/ `unknown` 查不到（带 reason）。
   *
   * ⚠ 这段注释里不要出现单引号字符串：`tests/channels.test.ts` 用正则从这两个
   * Set 里抽所有单引号字面量来守白名单，写了就会被当成通道名。
   */
  'update:result',
  /**
   * mac 系统音频的 PCM 块与状态。与上面两条 SEND 成对。
   *
   * 两种形状，靠 type 区分：
   *   pcm   —— 一块 16 位小端单声道 PCM（200ms）。
   *   state —— 抓取器的状态：live 在流 / idle 停了 / missing 没有二进制 /
   *            error 出错了（带 reason）。
   *
   * 为什么 PCM 走 IPC 而不是读本地文件：CSP 是 default-src self，页面拿不到
   * 文件系统；而且这段数据一进页面就会被喂进 WebAudio，没有落盘的必要。
   */
  'tap:chunk',
]);

contextBridge.exposeInMainWorld('raven', {
  /**
   * 宿主平台。`'darwin'` / `'win32'` / `'linux'`。
   *
   * 页面需要它来选「外部音乐」的音频来源：Windows 走虚拟声卡（getUserMedia），
   * macOS 走主进程的 Core Audio tap。这不是能力，只是一个事实，暴露出去没有风险
   * ——真正能被滥用的那些（fs、child_process）仍然一样都没有。
   *
   * 沙箱里的 preload 有 `process.platform` 的只读副本，这里直接透出来。
   */
  platform: process.platform,

  /** 发一条。返回 false 表示通道不在白名单里，不会静默成功。 */
  send(channel, payload) {
    if (typeof channel !== 'string' || !SEND.has(channel)) return false;
    ipcRenderer.send(channel, payload);
    return true;
  },

  /**
   * 收一条，返回取消函数。
   *
   * 每次订阅包一层自己的 listener，而不是把页面回调直接交给 ipcRenderer：
   * 那样页面回调会拿到 event 对象（`sender` 能一路摸到 webContents），
   * 而且取消订阅时没法精确摘掉自己那一个。
   */
  on(channel, handler) {
    if (typeof channel !== 'string' || !RECEIVE.has(channel) || typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    // 取消函数**不能 return ipcRenderer.removeListener(...) 的结果**。
    // EventEmitter 那一族返回值是 `this`，也就是 ipcRenderer 本身；
    // contextBridge 会把这个返回值代理到页面，于是 `const x = off(); x.send(...)`
    // 就绕过了上面那道白名单——沙箱和通道白名单一起白做。
    // 这里必须显式不返回任何东西。
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
});
