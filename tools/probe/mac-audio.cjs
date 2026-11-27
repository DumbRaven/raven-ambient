/**
 * 在 macOS 上验证「本地音频真的解码并播起来了」。
 *
 * 为什么不能靠截图：唱盘转不转只能证明 UI 在跑动画，跟声音一毛钱关系没有。
 * 这里直接读页面里的电子证据——音频上下文是否 running、播放时间有没有推进、
 * 主增益是否被拧到 0。这三条成立，声音基本一定出来了（除非系统音量是 0，
 * 那个只能靠人听）。
 *
 * 为什么用 CDP 的 `DOM.setFileInputFiles` 而不是在页面里造 File 对象：
 * 真导入走的是 `<input type="file">` 的 `change` 事件，页面里 `new File([...])`
 * 造出来的是内存里的假文件，`inspectAudio` 拿到的元数据、指纹、时长全都对不上，
 * 测出来的不是用户那条路径。
 *
 * 为什么要在页面加载前注入一段脚本：`AudioContext` 与主增益节点都封在
 * `src/audio.ts` 的模块作用域里，页面全局上摸不到。唯一的观察口子是构造时
 * 把它挂到 `window` 上——所以脚本必须在模块执行之前就位。
 *
 * 用法（Mac 上）：
 *   AUDIO_DIR=$HOME/probe-music node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     tools/probe/mac-audio.cjs
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(os.homedir(), 'probe-music');
const WAIT = Number(process.env.SHOT_WAIT || 2600);

/**
 * 在页面里执行，把 AudioContext 实例扣一份到 window 上。
 *
 * **必须在 `loadFile` 之后、第一次播放之前执行**，不能用
 * `Page.addScriptToEvaluateOnNewDocument` 注入。原因不在时序上，而在
 * 这台机器上：`show: false` 的窗口一旦在 `loadFile` 之前 `debugger.attach()`，
 * 加载就再也不返回（实测连一行日志都过不去，试过禁 GPU 也一样）。
 * 而 `AudioEngine.init()` 是惰性的，`new AudioContext()` 发生在第一次
 * `start()` 里，所以加载之后再换构造器完全来得及。
 */
const HOOK = `
  (() => {
    const Original = window.AudioContext || window.webkitAudioContext;
    if (!Original) return;
    window.__probeContexts = [];
    window.__probeMedia = [];
    class Tracked extends Original {
      constructor(...args) {
        super(...args);
        window.__probeContexts.push(this);
        // 记录所有挂到 destination 上的增益，用来判断「有没有被静音」。
        // 包一层 createGain，因为应用是先建链再改值的。
        const createGain = this.createGain.bind(this);
        this.gains = [];
        this.createGain = () => {
          const node = createGain();
          this.gains.push(node);
          return node;
        };
        // 播放用的是 \`new Audio()\`（src/audio.ts:508），那个元素**不进 DOM**，
        // 所以 document.querySelectorAll('audio') 永远是空的。
        // 唯一能拿到它的口子就是这里：所有 element 源都从 createMediaElementSource 过。
        const createSource = this.createMediaElementSource.bind(this);
        this.createMediaElementSource = (element) => {
          window.__probeMedia.push(element);
          return createSource(element);
        };
      }
    }
    window.AudioContext = Tracked;
    if (window.webkitAudioContext) window.webkitAudioContext = Tracked;
  })();
`;

/**
 * 每一步同时写文件。
 *
 * SSH 那条路（`mac_run.ps1`）把 stdout 整段缓冲到命令结束才回传，所以一旦卡住，
 * 屏幕上什么都看不到——第一次跑就是这样，分不清是导入慢还是根本没起来。
 * 落一份文件，卡住之后还能回头读到底走到哪一步。
 */
const LOG_PATH = path.join(ROOT, '.qa', 'mac-audio.log');
const log = [];
function write(name, payload) {
  log.push({ name, value: payload });
  const line = `${name} ${JSON.stringify(payload)}\n`;
  console.log(`PROBE_${line.trimEnd()}`);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch { /* 日志写不进去不影响判定 */ }
}
function step(name, value) {
  write(`STEP ${name}`, value);
}
/**
 * 报错并结束。
 *
 * `app.exit(1)` 只是排一个退出，**不中断当前这轮同步执行**——第一版就因此
 * 在 FAIL 之后继续往下跑，最后还打了一行 PROBE_OK，日志自相矛盾。
 * 所以这里必须抛，让调用栈真的断开。
 */
function fail(name, detail) {
  write(`FAIL ${name}`, detail);
  throw new AudioProbeStop();
}
class AudioProbeStop extends Error {}

/** 总时限。卡在某个 await 上时，至少能留下「走到了哪一步」。 */
const deadline = setTimeout(() => {
  // 这里在定时器里，抛出去没人接（`fail` 是给 await 链用的），所以直接落日志退出。
  write('FAIL timeout', '总时限到了还没结束，最后一步见上面的 STEP');
  app.exit(1);
}, Number(process.env.PROBE_DEADLINE || 180_000));
deadline.unref?.();

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mac-audio-')));

// 不开硬件加速。离屏（show:false）窗口上 GPU 初始化会挂住，表现是
// `loadFile` 迟迟不 resolve、日志停在最后一步——第一次跑就卡在这里。
// 抓图与判音频都用不到 GPU。
app.disableHardwareAcceleration();

(async () => {
  await app.whenReady();

  const files = fs.existsSync(AUDIO_DIR)
    ? fs.readdirSync(AUDIO_DIR).filter((name) => name.endsWith('.m4a')).map((name) => path.join(AUDIO_DIR, name))
    : [];
  if (!files.length) fail('fixtures', `没有找到测试音频：${AUDIO_DIR}`);
  step('fixtures', files.length);

  const win = new BrowserWindow({
    width: 680,
    height: 980,
    useContentSize: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
    },
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, WAIT));
  await win.webContents.executeJavaScript("document.getElementById('splash')?.remove(); undefined;");
  await new Promise((resolve) => setTimeout(resolve, 500));

  // 挂钩子必须等到加载之后，原因看下面 `HOOK` 的注释。
  // 这时页面已经起来，但播放器还没初始化——`AudioEngine.init()` 是惰性的，
  // 只在第一次 `start()` 时才 `new AudioContext()`，所以这里换掉构造器还来得及。
  await win.webContents.executeJavaScript(HOOK);
  step('hook', 'installed');

  // 真导入：把文件塞进那个 hidden input，让它自己走 change → importFiles。
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1 });
  const { nodeId } = await dbg.sendCommand('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type=file][aria-label="选择本地音频文件"]',
  });
  if (!nodeId) fail('file-input', '找不到音频输入框');
  await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files });
  step('files-set', files.length);

  // 导入是逐张 await 的（解码 + 写 IndexedDB），给足时间。
  const count = await poll(
    () => win.webContents.executeJavaScript('document.querySelectorAll(".record-card").length'),
    (value) => value >= files.length,
    60_000,
  );
  if (count < files.length) fail('import', `唱片柜里只有 ${count} 张，预期 ${files.length} 张`);
  step('imported', count);

  /*
   * 必须先把唱片「选中」，再按播放。
   *
   * 导入只把它放进 `records`，播放队列 `queue` 是空的——`toggleRecord()`
   * （`src/records.ts:181`）才是往 `queue` 里加的那一步，而
   * `Player.start()`（`src/player.ts:141`）在 `queue` 与 `ambience` 都空时
   * 直接 return。第一版漏了这一步，点了播放什么都没发生，日志里
   * `audioCount: 0`、`context: none`，看起来像解码坏了，其实是没歌可放。
   *
   * 选中按钮的 `aria-label` 是 `选择<唱片名>`（`src/RecordCard.tsx:55`）。
   */
  const selected = await win.webContents.executeJavaScript(`
    (() => {
      const buttons = [...document.querySelectorAll('.select-record')];
      buttons.forEach((node) => node.click());
      return buttons.length;
    })()
  `);
  if (selected < files.length) fail('select', `只找到 ${selected} 个选择按钮`);
  step('selected', selected);
  await new Promise((resolve) => setTimeout(resolve, 800));

  // 进「正在听」，让播放卡出现。
  await click(win, '正在听');
  await new Promise((resolve) => setTimeout(resolve, 1200));

  // 播放卡不是常驻的：它挂在那个圆碟按钮上（`src/ViewTabs.tsx:46`，
  // `aria-label` 是「打开播放器」），不先点开的话页面上根本没有「播放」键。
  await click(win, '打开播放器');
  await new Promise((resolve) => setTimeout(resolve, 700));

  const before = await snapshot(win);
  step('before-play', before);

  // 点之前先看清页面长什么样：播放键找到了没有、播放卡开没开。
  // 没有这几行，失败时只知道「没声音」，不知道是哪个前提没成立。
  const ready = await win.webContents.executeJavaScript(`
    (() => {
      const all = [...document.querySelectorAll('button')];
      const play = all.find((node) => node.getAttribute('aria-label') === '播放');
      const card = document.querySelector('.player-dock, .play-card, .dock-card');
      return {
        playFound: !!play,
        playRect: play ? play.getBoundingClientRect().toJSON() : null,
        cardFound: !!card,
        audioCount: document.querySelectorAll('audio').length,
        recordCards: document.querySelectorAll('.record-card').length,
        busyText: (document.body.innerText.match(/正在收藏[^\\n]*/) || [''])[0],
      };
    })()
  `);
  step('ready', ready);

  await click(win, ready.playFound ? '播放' : '打开播放器');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const playing = await snapshot(win);
  step('after-play-1.5s', playing);

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const later = await snapshot(win);
  step('after-play-3s', later);

  const problems = [];
  if (playing.context !== 'running') problems.push(`音频上下文是 ${playing.context}，不是 running`);
  // 「时间推进」不能拿同一个元素前后比：测试音频只有不到 2 秒，一轮下来已经换歌了，
  // 新那张的 currentTime 当然更小。判据是「此刻有元素在跑且位置大于 0」——
  // 加上 readyState >= 3（HAVE_FUTURE_DATA，说明解码器真的吐出了数据）。
  if (playing.paused !== false) problems.push(`播放元素处于暂停态（paused=${playing.paused}）`);
  if (!(playing.time > 0)) problems.push(`播放位置是 ${playing.time}，没走`);
  if (!(playing.readyState >= 3)) problems.push(`readyState 只有 ${playing.readyState}，没有可播数据`);
  if (!playing.duration) problems.push('拿不到时长，说明解码没成功');
  if (!(later.paused === false && later.time > 0)) problems.push(`第二次采样时没在播（paused=${later.paused}，time=${later.time}）`);
  if (!(playing.gain > 0)) problems.push(`主增益是 ${playing.gain}，等于静音`);

  if (problems.length) fail('audio', { problems, playing, later });

  console.log(
    `PROBE_OK 本地音频播起来了：位置 ${playing.time.toFixed(2)}s / 时长 ${playing.duration.toFixed(2)}s，` +
    `readyState ${playing.readyState}，增益 ${playing.gain.toFixed(2)}，上下文 ${playing.context}，` +
    `接了 ${playing.mediaCount} 个播放元素`,
  );
  clearTimeout(deadline);
  app.exit(0);
})().catch((error) => {
  if (error instanceof AudioProbeStop) {
    app.exit(1);
    return;
  }
  write('FAIL crash', String((error && error.stack) || error));
  app.exit(1);
});

/** 轮询到条件成立或超时，返回最后一次读到的值。 */
async function poll(read, done, ms) {
  const until = Date.now() + ms;
  let last = 0;
  while (Date.now() < until) {
    last = await read();
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return last;
}

/**
 * 点一个按钮。先按文字精确匹配，再按 `aria-label` 精确匹配。
 *
 * 两种都要，因为界面上两种写法并存：页签是「正在听」这样的文字，
 * 而圆碟那个开播放卡的键只有 `aria-label="打开播放器"`（`src/ViewTabs.tsx:46`），
 * 没有文字。只认文字的话会在这一步报「找不到按钮」。
 */
async function click(win, label) {
  const hit = await win.webContents.executeJavaScript(`
    (() => {
      const all = [...document.querySelectorAll('button')];
      const wanted = ${JSON.stringify(label)};
      const button = all.find((node) => node.textContent.trim() === wanted)
        || all.find((node) => node.getAttribute('aria-label') === wanted);
      if (!button) return 'MISS';
      button.click();
      return 'OK';
    })()
  `);
  if (hit !== 'OK') fail('click', `找不到按钮「${label}」`);
}

/**
 * 读四条电子证据。
 *
 * `time` / `paused` 取那个 `<audio>` 元素：播放走 `new Audio()` 加
 * `createMediaElementSource`，所以时间推进就等于解码器和时钟都在跑。
 * `context` / `gain` 取注入钩子扣下来的 AudioContext 与它上面所有增益节点里
 * 最大的那个——主增益是链路上最外层，被拧到 0 时它就是 0。
 */
async function snapshot(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      // 播放元素不在 DOM 里，只能从钩子扣下来的那份取。
      const media = window.__probeMedia || [];
      const live = media.filter((node) => !node.paused && node.currentTime > 0);
      const element = live[0] || media.find((node) => !node.paused) || media[media.length - 1];
      const contexts = window.__probeContexts || [];
      const context = contexts.find((item) => item.state === 'running') || contexts[0];
      let gain = 0;
      if (context && context.gains) {
        for (const node of context.gains) {
          if (node.gain && node.gain.value > gain) gain = node.gain.value;
        }
      }
      return {
        time: element ? element.currentTime : 0,
        paused: element ? element.paused : null,
        duration: element && Number.isFinite(element.duration) ? element.duration : 0,
        readyState: element ? element.readyState : -1,
        mediaCount: media.length,
        context: context ? context.state : 'none',
        gain,
      };
    })()
  `);
}
