// 视觉基线：CSS 重构的标尺。
//
// 为什么需要它：`tsc` 和 342 个单测都看不见视觉回归。阴影浅了 2px、断点下的
// 留白从 24 变成 32、黑胶滑出的角度偏了 3 度——这些全都能通过类型检查和测试。
// 没有标尺的 CSS 重构等于蒙眼改。
//
// 用法：
//   npm run build                                    （探针跑 dist/，必须先构建）
//   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
//     tools/probe/baseline.cjs --no-sandbox
//
// 产物落到 .qa/baseline/<尺寸>/<名字>.png，配合 baseline-diff.py 比对两份目录。
//
// 三个设计取舍，改动前先读：
//
// 1. **同一个窗口实例里跑完全部尺寸和视图**，靠 setContentSize 改大小，不重建。
//    因为封套的构图与配色由 `src/sleeves.ts` 的 launchSeed 决定，而 launchSeed
//    在模块求值时算一次。重建窗口 = 换一批封面 = 每张图都不同，比对立刻失效。
//
// 2. **日期文本在截图前被归一化**。`todayStamp`(App.tsx:370) 与 `stampDate`
//    (TemplateStage.tsx:165) 取当天日期，跨天跑基线会平白多出差异。直接改 DOM
//    里的文本，比伪造 Date 侵入小——伪造 Date 会把 FocusRoom 的 250ms 计时器
//    冻住，那是另一种失真。
//
// 3. **动画要等到真的停下来**。CSS 动画没走完就截图，同一份代码两次跑出来的
//    图会差在中间帧上。这里等 getAnimations() 里所有有限次动画 finished，
//    无限次的（转动的黑胶、呼吸的光）跳过——等它们会挂死。
//
// 探针窗口默认离屏（见 harness.cjs 顶部），不会弹出来抢焦点。
// ---------------------------------------------------------------------------
// 必须在 require harness 之前：钉死设备像素比。
//
// `capturePage()` 返回的是**物理像素**。本机显示器是 150% 缩放，于是
// `setContentSize(680, 980)` 截出来是 1020×1470。布局本身没错（CSS 像素才是
// 布局单位，DPR 只影响位图密度），但**位图尺寸就由显示器决定了**：换台 DPR=1
// 的机器重跑，同样的代码会得到 680×980，逐像素比对当场失效，而且不会报错，
// 只会行错位（`tools/measure/pixels.cjs` 头注释里记着这个坑）。
//
// 标尺的第一属性是「换台机器也一样」，所以把 DPR 钉成 1。要看 2x 细节时用
// PROBE_DPR=2 重跑——但那组图只能跟同一 DPR 的图比。
//
// 位置要求：appendSwitch 必须在 app ready 之前生效，而 `registerMediaScheme()`
// 在 harness.cjs 顶层就会跑（同样必须在 ready 前），所以这两行必须排在最前面。
const { app, BrowserWindow } = require('electron');
const DPR = process.env.PROBE_DPR || '1';
app.commandLine.appendSwitch('force-device-scale-factor', DPR);

const path = require('node:path');
const fs = require('node:fs');
const { launch, guard, wait, ROOT, MEDIA_AUDIO } = require('./harness.cjs');

// 输出目录可以用 PROBE_BASELINE_OUT 覆盖：验证「连拍两遍是否一致」时
// 需要保留上一遍的结果，否则第二遍会覆盖掉要比对的基准。
const OUT_ROOT = process.env.PROBE_BASELINE_OUT ? path.resolve(ROOT, process.env.PROBE_BASELINE_OUT) : path.join(ROOT, '.qa', 'baseline');

// 尺寸取真实窗口的边界：main.cjs:27 默认 680 宽，minWidth 360。
// 440 是皮肤里唯一有专门断点的窄宽度（skin-bold.css:1294/4296），
// 中间的 599/760 由 440 与 680 两端覆盖，不单独出图。
const SIZES = [
  { id: 'wide', width: 680, height: 980 },
  { id: 'narrow', width: 440, height: 860 },
];

/**
 * 放映全屏（`.media-room.is-expanded`）用多大来拍。
 *
 * 54 条规则只在这个状态下生效，而全屏恰恰是这个软件的主形态——不测等于
 * 六分之一皮肤没覆盖。麻烦在于真全屏会让离屏窗口的 contentSize 变成
 * **显示器尺寸**（本机是 3840×2160），换台机器整档作废。
 *
 * 所以下面把 `BrowserWindow.prototype.setFullScreen` 换掉，改成 setContentSize
 * 到一个固定大小。被换掉的只有「窗口怎么变大」这一步，页面侧的链路一点没动：
 * 主进程照样收到 `fullscreen` 消息 → 窗口照样变尺寸 → `afterResizeWait`
 * 照样等到尺寸真的变了 → 照样挂上 `.is-expanded`。测的正好是要测的那一段，
 * 而不该靠截图去看的那段（Windows 全屏过渡）也就不测了。
 */
const FULL = { width: 1280, height: 800 };
const realSetFullScreen = BrowserWindow.prototype.setFullScreen;
/** 退出全屏时要还原到哪。由主循环在换尺寸时更新——写死 680×980 会让
 *  narrow（440×860）那轮退出全屏后跳到 wide 的尺寸。 */
let windowedSize = { width: SIZES[0].width, height: SIZES[0].height };
BrowserWindow.prototype.setFullScreen = function (on) {
  if (on) {
    this.setContentSize(FULL.width, FULL.height);
    return;
  }
  this.setContentSize(windowedSize.width, windowedSize.height);
};
void realSetFullScreen;

const VIEWS = [
  { id: 'cabinet', label: '唱片柜' },
  { id: 'listening', label: '正在听' },
  { id: 'focus', label: '专注' },
  { id: 'media', label: '相集' },
];

// 探针用的唱片。字段按 records.ts 的 RecordItem 给全，color 走 recordColors，
// 这样封面没有自定义图时可复现地走 sleeves.ts 的随机构图。
const recordColors = ['#879a91', '#aaa2b4', '#bd9b80', '#8c9caa', '#aaa481', '#b28e92'];
const NAMES = ['雨声', '夜航', '炉火', '打字', '海浪', '微风', '虫鸣', '城市'];

const records = NAMES.map((name, i) => ({
  id: `probe-${i}`,
  assetId: `probe-asset-${i}`,
  name,
  artist: '本地收藏',
  description: '',
  // 前 5 张音乐、后 3 张环境音：唱片柜两个分类都有内容，正在听也有队列。
  category: i < 5 ? 'music' : 'ambient',
  duration: 180 + i * 37,
  format: i % 2 ? 'FLAC' : 'MP3',
  size: 2_400_000 + i * 100_000,
  color: recordColors[i % recordColors.length],
  fingerprint: `probe-fingerprint-${i}`,
  volume: 60,
  pan: 0,
  warmth: 0,
  duckDepth: 9,
}));

const patch = {
  records,
  queue: records.filter(r => r.category === 'music').map(r => r.id),
  ambience: records.filter(r => r.category === 'ambient').map(r => r.id),
};

/**
 * 注入到页面脚本**之前**的确定性补丁。
 *
 * 为什么必须有这一层：
 *
 * 封套的构图和配色来自 `src/sleeves.ts:43` 的 `launchSeed = Math.random() + Date.now()`，
 * 模块求值时就定死。两次运行得到的种子不同，整套唱片的底色就不同——第一版基线是
 * 粉/紫/蓝/青，重跑一次变成米/柠檬/薄荷/珊瑚。改完 CSS 再生成一次基线，diff 里
 * 全是大片色块差异，真正的回归反而被淹掉。
 *
 * 所以把随机源和时间都钉死：`Math.random` 换成定种子的 mulberry32，`Date` 换成一个
 * 「无参构造返回固定时刻」的子类。这样「同一份代码跑两次」应当**逐字节相同**。
 *
 * 时间补丁要覆盖 `new Date()` 而不只是 `Date.now()`：`LayerStack.tsx:222` 的时钟
 * 图层用 `new Date()` 取真实时间、每 20 秒刷一次，光钉 `Date.now` 冻不住它
 * （实测 media 视图两次运行的差异就落在那个 `3:18` 上）。用子类而不是整体替换，
 * 是为了保住 `Date.parse` / `Date.UTC` / `new Date(1594…)` 这些带参数的正常用法——
 * 项目里 `dayKey(at)`、`focusRecord` 都靠带参数构造。
 *
 * 副作用（已知并接受）：`Date.now` 冻结后番茄钟不会推进，截图拍到的永远是静止态。
 * 基线要的是确定性而不是覆盖所有动态状态；番茄钟的推进逻辑有单测兜着
 * （`tests/focus.test.ts`），不该靠像素图验。
 *
 * 走 CDP 的 `Page.addScriptToEvaluateOnNewDocument` 而不是 `executeJavaScript`：
 * 后者在页面脚本之后才执行，那时 `sleeves.ts` 早把种子算完了。
 */
const FREEZE_RANDOM = `(() => {
  let s = 0x9e3779b9;
  const next = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = next;

  // 可控时钟：不是"永不变"，而是"只有探针能推动它"。
  //
  // 为什么不能只是钉死成一个常数：专注计时靠
  // \`FocusRoom.tsx\` 里 \`setInterval(() => setNow(Date.now()), 250)\` 驱动，
  // \`remainingFocus()\` 算的是 \`state.endAt - now\`。now 一动不动，
  // 计时器就永远停在原地——"运行中"那一屏拍不到，因为点了开始之后
  // 剩余时间不会从满格往下走。
  //
  // 为什么不能让它自由跑：跑起来每秒掉一格，两张图之间就差几秒，
  // 进度环角度和读数都不一样，逐像素比对必然失败。
  //
  // 所以拆成两件事：
  //   - \`Date.now()\` / \`new Date()\` 读的是 \`offset\` 偏移后的基准点；
  //   - 探针用 \`__probeClock.advance(ms)\` 一次性把基准点推前固定量。
  // 推进之后时钟又静止，同一份脚本每次跑到同一个位置。
  const BASE = 1763164800000; // 2025-11-14T00:00:00Z
  let offset = 0;
  const RealDate = Date;
  const at = () => BASE + offset;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(at());
      else super(...args);
    }
    static now() { return at(); }
  }
  window.Date = FixedDate;
  window.__probeClock = {
    advance(ms) { offset += ms; return at(); },
    now() { return at(); },
    // 不含 offset 的基准点。给需要「钉成固定文案」的地方用：
    // 那些地方不能在 advance 之后算，否则算出来的值会跟着推进量变。
    base() { return BASE; },
  };
  return 1;
})()`;

/**
 * 截图前把页面归位。
 *
 * 两件事：滚动条回到顶部、鼠标移出所有可悬停元素。
 *
 * 为什么必须做：鼠标坐标不会因为 `setContentSize` 而重置。上一轮
 * `cabinet-hover` 把鼠标停在第一张唱片卡上，改到窄尺寸后那个坐标仍然落在
 * 那张卡上，于是 `narrow/cabinet.png` 拍到的是一张已经掀开、黑胶滑出的卡——
 * 而宽尺寸那张是合着的。同一份代码，两张图对不上，而且看起来像真 bug。
 *
 * 移到 (1,1) 而不是 (0,0)：左上角有 `.brand` 品牌字，压上去同样会出 hover 态。
 */
/*
 * 焦点也要清掉。`styles.css` 里 `.record-card:focus-within .case-front` 与
 * hover 是同一组规则——卡片被聚焦时唱片盒一样会掀开。键盘焦点会留到下一张图：
 * 上一张点过页签、按过弹窗里的按钮，焦点就还在那张卡上，于是这张图莫名其妙
 * 掀开一张、跟上一张对不上，看起来像样式回归，其实是标尺没擦干净。
 * 实测：单独起窗口时 activeElement 是 BODY，连拍时才会残留。
 */
const RESET_POINTER = `(() => {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  return 1;
})()`;

const PARK_POINTER = { x: 1, y: 1 };

/*
 * 把唱片卡全部合回去。
 *
 * 卡片是否掀开是 React 状态（`App.tsx` 的 `flip` → `RecordCard` 的 `data-flip`），
 * 不是 CSS。所以清焦点没用——`modal-edit` 那张为了让右侧面板有内容会点开第一张卡，
 * 点开之后 `flip` 一直留着，下一轮拍 `cabinet` 时那张卡还是掀着的。
 * 表现是同一份代码 `narrow/cabinet` 差 11%，看起来像布局塌了，其实只是残留。
 *
 * 点的是卡片的正文按钮，再点一次就翻回去（`toggleFlip` 是 toggle）。
 * 先数一遍掀开的数量，回读确认真的合上了，没合上就报错——标尺宁可炸掉也不能
 * 静默拍一张错图。
 */
const CLOSE_CARDS = `(() => {
  const open = () => document.querySelectorAll('.record-card[data-flip="open"]');
  for (const node of open()) {
    node.querySelector('.record-preview')?.click();
  }
  return open().length;
})()`;

/**
 * 把跟当天有关的文本换成固定串，跨天跑不会平白多出差异。
 *
 * 三处来源：
 *   - `todayStamp`(App.tsx:370) 渲染进 `.today-stamp > span:first-child`；
 *     注意 `.today-stamp` 里还有 `.today-count` 那个 span，只取第一个。
 *   - `stampDate`(TemplateStage.tsx:165) 渲染进 `.tpl-corner-date`（形如
 *     「2026 / 1114」，中间是 `<br>`）。
 *   - `LayerStack.tsx:304` 的时钟图层渲染进 `.ov-clock`（以及桌面窗那份
 *     `.dw-clock`），是「时:分」两位。
 *
 * 第三处是后补的，补的原因值得记下来：`__probeClock` 冻的是 `Date`，
 * 但 `LayerStack` 用 `setInterval(…, 20_000)` 每 20 秒才**采样**一次。
 * 专注页那一步 `advance(600000)` 把基准点推了 10 分钟，之后有没有一次
 * 采样落进「拍相集全屏」之前，取决于这一轮跑得快慢——实测同一份代码
 * 连抓两次，一次 `08:00`、一次 `08:10`，28 张里只有这一张对不上。
 * 这不是样式回归，是标尺自己会漂。所以这里把文本直接钉成基准点那一刻，
 * 和上面两处同一套做法：不跟时钟赛跑，直接写死。
 *
 * 为什么钉 `base()` 而不是 `now()`：`now()` 在专注页那步之后是 08:10，
 * 而基线里存的是 08:00。钉 `now()` 会让新抓的图与旧基线差 10 分钟，
 * 正好是这次要消掉的那个差异。
 *
 * **选择器陷阱（踩过一次，写下来）**：`.dw-clock` 不止命中里面那个只装
 * 文字的 `<b>`，还命中**外层容器** `<div class="dw dw-clock">`——两处
 * `className` 里都有这个类。给容器写 `textContent` 会把它的三个子节点
 * （`<b>` 时钟、`.layer-grip` 手柄、`.dw-kill` 删除按钮）全部替换成一段
 * 纯文字，图层当场少掉手柄和删除按钮。当初是靠打印容器 `outerHTML`
 * 才发现的：它的 `textContent` 是 `19:48×`，`×` 就是被吞进文本里的
 * 删除按钮。所以只用 `.ov-clock, .dw-clock` 里**没有元素子节点**的那些
 * ——那才是真正装文字的节点。
 */
const FREEZE_DATES = `(() => {
  const stamp = document.querySelector('.today-stamp > span');
  if (stamp) stamp.textContent = 'FRI · NOV 14';
  const corner = document.querySelector('.tpl-corner-date');
  if (corner) corner.innerHTML = '2026<br>1114';
  // 时钟图层：全部按基准点算，不受 advance 影响。
  const base = new Date(window.__probeClock.base());
  const hhmm = String(base.getHours()).padStart(2, '0')
    + ':' + String(base.getMinutes()).padStart(2, '0');
  const paint = () => {
    for (const node of document.querySelectorAll('.ov-clock, .dw-clock')) {
      // 只认真正装文字的那个节点。容器也带同名类，动它会杀掉子按钮。
      if (node.children.length) continue;
      if (node.textContent !== hhmm) node.textContent = hhmm;
    }
  };
  paint();
  // 只写一次不够：\`LayerStack\` 那个 20 秒的 setInterval 还活着，它下一次
  // 采样会把 React 里的 at 换成 advance 之后的时间、顺带换掉这个文本。
  //
  // 用 MutationObserver 而不是纯轮询：轮询有个几毫秒到 200ms 的空窗，截图
  // 正好落在「React 刚写回 08:10、看门狗还没跑」那一刻就会拍错（2026-11-25
  // 就这么拍到过一张，与代码改动无关却让门禁红了一次）。观察者回调在重绘
  // 之前跑，所以画面永远看不到中间态。
  //
  // 外层容器（\`.dw-clock\` 同时也是容器，里面装 b 与两个按钮）不能直接改
  // textContent，否则会连删除按钮一起抹掉——只改存文字的叶子节点。
  if (!window.__probeClockGuard) {
    const leaves = () => [...document.querySelectorAll('.ov-clock, .dw-clock')]
      .filter((node) => !node.children.length);
    const observer = new MutationObserver(paint);
    const watch = () => {
      for (const node of leaves()) {
        if (!node.__probeWatched) {
          node.__probeWatched = true;
          observer.observe(node, { childList: true, characterData: true, subtree: true });
        }
      }
    };
    watch();
    // 节点可能被 React 整个换掉（重渲染换了 DOM），所以低频重扫一遍补挂观察。
    window.__probeClockGuard = window.setInterval(() => {
      paint();
      watch();
    }, 500);
    window.__probeClockObserver = observer;
  }
  return 1;
})()`;

/**
 * 把播放态里两处「跟着真实时间走」的东西钉死。
 *
 * 为什么单独的 `FREEZE_RANDOM` 不够：那套只替换了 `Math.random` 和 `Date`，
 * 而播放面板上的两样东西根本不经过它们——
 *
 *   - 进度读数与进度条填充比，来自 `AmbientEngine.tick()` 每 80ms 读一次的
 *     `AudioContext.currentTime`（`src/audio.ts:257`）。真实音频时钟停不下来。
 *   - 波形条 40 根的高度，来自 `PlayCard` 的 rAF 循环从 `levelRef` 取实时电平
 *     （`src/PlayCard.tsx:56-70`）。同一段音频每次跑到的相位不同，波形就不同。
 *
 * 实测后果：`wide/listening-playing` 连拍两遍差 3812 像素（0.57%）、最大通道差
 * 200，全部落在波形条与秒数上。这跟样式无关，但会让这张图永远无法当门禁用。
 *
 * 三处分别处理：
 *   1. `HTMLMediaElement.prototype.currentTime` 钉成常量。进度读数与进度条的
 *      填充比来自 `status.currentTime = this.music?.currentTime ?? 0`
 *      （`src/audio.ts:257`），而 `music` 就是一个 `<audio>` 元素——真实播放进度
 *      不受 `Date` 影响，也不受 `AudioContext` 影响。第一版只改了后者，圆点照跳。
 *      duration 不动：它由文件决定，本来就是稳定的。
 *   2. 把 `BaseAudioContext.prototype.currentTime` 的 getter 换成常量。引擎里的
 *      音量包络、淡入淡出都读它，钉住后这些调度也稳定。引擎把 ctx 藏在私有字段
 *      里，页面外部拿不到；同类上下文只有这一个，改原型等价。
 *   3. 波形条用带 `!important` 的样式表压住内联 `--h`。内联声明不带
 *      `!important`，所以 CSS 里的 `!important` 能赢过 rAF 每帧的写入。
 *      高度序列取一段起伏，保留「有波形」这个视觉信息——要验的是条宽、间距、
 *      圆角、颜色，不是某个瞬时电平该有多高。
 *
 * 只在需要播放态的那一张之前调用，别放进 SETTLE：其余 20 张不涉及音频。
 */
const FREEZE_MEDIA = `(() => {
  const mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (mediaProto) {
    Object.defineProperty(mediaProto, 'currentTime', {
      configurable: true,
      get() { return 1.0; },
      set() { /* 播放器想 seek 也拦住：让它停在固定点 */ },
    });
  }

  const proto = window.BaseAudioContext && window.BaseAudioContext.prototype;
  if (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, 'currentTime');
    if (desc && desc.get) {
      Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return 1.0; } });
    }
  }

  const BARS = 40;
  const heights = Array.from({ length: BARS }, (_, i) => {
    // 一段确定的伪波形：两头低、中间有起伏，看起来像正在出声。
    const t = i / (BARS - 1);
    const wave = Math.abs(Math.sin(t * Math.PI * 3.3)) * (0.35 + 0.55 * Math.sin(t * Math.PI));
    return Math.max(0.08, Math.min(0.95, wave)).toFixed(3);
  });

  const style = document.createElement('style');
  style.setAttribute('data-baseline-media', '');
  style.textContent = heights
    .map((h, i) => '.play-card-wave span:nth-child(' + (i + 1) + ') { --h: ' + h + ' !important; }')
    .join('\\n');
  document.head.appendChild(style);
  return heights.length;
})()`;

/**
 * 等字体、等有限次动画走完，再把无限循环的动画「结束掉」。
 *
 * 为什么必须处理无限动画：转动的黑胶会在不同旋转相位被截到，上面的纹路随之
 * 不同——实测 `wide/cabinet-hover` 因此出现 38 个像素的通道差，全落在唱片那块。
 * 只差 1 个色阶、肉眼看不出，但标尺要零误报，否则每次重构都得人工排查噪声。
 *
 * 为什么不用 `a.pause()`：试过，不管用。CSS 动画的播放状态由元素的
 * `animation-play-state` 决定，Web Animations API 的 `pause()` 在下一次样式重算时
 * 会被样式覆盖回去，于是相位仍然随机。
 *
 * 为什么不用 `animation: none`：会把带 `fill-mode: both/forwards` 的动画一起清掉，
 * 元素退回基础样式，布局就错了——那就不是「冻结」，是「改变了画面」。
 *
 * 最终用的办法：把所有动画压成「跑一次就停」——`iteration-count: 1` +
 * `fill-mode: forwards` + 极短时长。无限动画跑到终点后停住，终态是确定的；
 * 已结束的有限动画本来就是终态，不受影响。转动的黑胶最终停在 360°，
 * 在视觉上等同于 0°。
 */
const SETTLE = `(async () => {
  await document.fonts.ready;

  const all = document.getAnimations();
  const isEndless = a => {
    const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
    return timing && timing.iterations === Infinity;
  };
  const endless = all.filter(isEndless);
  const finite = all.filter(a => !isEndless(a));

  // 先让有限动画自然走完（它们决定元素停在哪，不能跳过）。
  const guard_ms = new Promise(done => setTimeout(done, 1500));
  await Promise.race([Promise.all(finite.map(a => a.finished.catch(() => {}))), guard_ms]);

  // 再把无限动画钉到终态，同时把过渡也压成瞬时的。放在有限动画之后，
  // 避免把它们也提前结束。
  //
  // transition 必须一起处理：唱片盒掀开、黑胶滑出全是 transition 驱动的，
  // 只冻 animation 的话，hover 那张拍到的是过渡进行到一半的样子，每次
  // 停在不同进度，逐像素比对会永远差那么十几个像素。
  if (endless.length) {
    const style = document.createElement('style');
    style.setAttribute('data-baseline-freeze', '');
    style.textContent = \`
      *, *::before, *::after {
        animation-iteration-count: 1 !important;
        animation-fill-mode: forwards !important;
        animation-duration: 0.001s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    \`;
    document.head.appendChild(style);
    // 等一帧让新样式生效并跑到终点；过渡归零后仍要两帧才稳定。
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  }

  return { finite: finite.length, endless: endless.length };
})()`;

/** 按 aria-label 切视图。底栏顺序会随窗口变，不能靠位置点。 */
const switchView = label => `(() => {
  const hit = [...document.querySelectorAll('.view-tabs > button')]
    .find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)});
  if (!hit) return 'missing:' + ${JSON.stringify(label)};
  hit.click();
  return 1;
})()`;

guard(async () => {
  const probe = await launch({
    width: SIZES[0].width,
    height: SIZES[0].height,
    expand: false,
    // 开屏的 splash-clock 是 4000ms + 520ms 淡出（index.html:108 / src/splash.ts）。
    // harness 里 loadFile 后先等 2200ms 再注入 localStorage 和 reload，所以这里的
    // settle 覆盖的是**第二次**加载，要压过整段开屏。
    settle: 5200,
    patch,
  });

  // 把确定性补丁注册到「新文档执行前」。
  //
  // 为什么用 CDP 的 `Page.addScriptToEvaluateOnNewDocument` 而不是
  // `executeJavaScript`：后者在页面脚本之后才跑，那时 `sleeves.ts` 早就在模块
  // 求值时把 launchSeed 算完了，改 `Math.random` 已经来不及。
  //
  // 时机上只有一个机会：harness.cjs 返回时，它的第一次 reload 已经过去
  // （那次用的是真随机源）。这里再挂一次补丁、主动 reload 一次，让补丁对这次
  // 加载生效。代价是多等一轮 5.2 秒开屏，换来「同一份代码两次运行逐字节相同」。
  await probe.win.webContents.debugger.attach('1.3');
  await probe.win.webContents.debugger.sendCommand('Page.enable');
  await probe.win.webContents.debugger.sendCommand(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: FREEZE_RANDOM },
  );
  await probe.win.webContents.reload();
  await wait(5200);

  // 把 8 张唱片的音频资产种进 IndexedDB。
  //
  // 必须在 reload 之后、进入各视图之前：App 启动时只读 localStorage 的 cabinet，
  // 资产是点播放那一刻才去 IndexedDB 取的，所以顺序其实宽松；但一次性种完，
  // 后面任何一屏想播放都不用再问。
  //
  // key 必须和记录里的 assetId 完全一致（probe-asset-N）。写错一个字符就是
  // 「找不到「x」的文件」——而且只在点播放时才暴露，静态截图完全看不出来。
  // 这里直接从 records 取，不再手写一遍，免得两处漂移。
  for (const record of records) {
    await probe.seedAsset(record.assetId, MEDIA_AUDIO);
  }
  console.log(`[baseline] 音频资产已种入 IndexedDB（${records.length} 条）`);

  // 确认补丁真的生效了。没生效的话后面所有图都白拍，而且看起来完全正常
  // （尺寸对、画面对，只是两次运行不一致）。
  const seeded = await probe.run('Math.random()');
  if (typeof seeded !== 'number') throw new Error('自由随机源补丁没有生效');
  console.log(`[baseline] 随机源已钉死（首个值 ${seeded.toFixed(6)}）`);

  // 每张图的实测尺寸。记下来有两个用处：比对脚本能先校验尺寸（尺寸不符就
  // 直接报错，而不是像写死 stride 那样行错位算出假值）；以及 DPR 一旦被人改动，
  // 从 manifest 里一眼看得出来。
  const size = async file => {
    const { load } = require('../measure/pixels.cjs');
    const img = load(file);
    return { width: img.W, height: img.H };
  };

  const captured = [];
  /**
   * 截图。
   *
   * @param {object} [opts]
   * @param {boolean} [opts.park=true] 截图前是否把鼠标移开。
   *   hover 那张必须传 false——否则刚移上去就被自己挪走，拍到的和普通态一模一样。
   *   （第一版就栽在这里：两张图 md5 完全相同，肉眼完全看不出，只有校验哈希才发现。）
   */
  const grab = async (sizeId, name, opts = {}) => {
    const { park = true } = opts;
    const dir = path.join(OUT_ROOT, sizeId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.png`);

    // 顺序有讲究：先把卡片合回去（掀开是 React 状态，清焦点清不掉），
    // 再归位鼠标（会触发 :hover 退出动画），再等动画停，最后截图。
    if (!opts.keepCards) {
      await probe.run(CLOSE_CARDS);
      await wait(750);
    }
    if (park) await probe.hover(PARK_POINTER);
    // 滚回顶部只对普通截图做。hover 那张不能做：harness 的 hover 会先
    // scrollIntoView 把目标滚进视口，此时再 scrollTo(0,0) 会把卡片从光标底下
    // 挪走，:hover 当场失效——拍出来是合着的卡片，看着像样式坏了。
    // （这个坑被「上一张残留的掀开态」掩盖了很久，直到给 grab 加了卡片复位才露出来。）
    if (park) await probe.run(RESET_POINTER);
    await probe.run(SETTLE);
    await wait(300);

    await probe.shot(file);
    const dims = await size(file);
    captured.push({ size: sizeId, name, file: path.relative(ROOT, file), ...dims });
    console.log(`[baseline] ${sizeId}/${name}.png  ${dims.width}x${dims.height}`);
  };

  for (const size of SIZES) {
    // 同一窗口实例改尺寸，launchSeed 不变，封面不会换一批。
    probe.win.setContentSize(size.width, size.height);
    windowedSize = { width: size.width, height: size.height };
    // 重新加载，把上一轮尺寸留下的 React 状态清干净。
    //
    // 真踩到的坑：上一轮拍 modal-edit 时点过 .record-preview，而 toggleFlip
    // (App.tsx:397) 只在 open/closed 之间翻，没有回到 undefined 的路径。合上后
    // data-flip 停在 'closed'，RecordCard 的注释写明这是「钉住合上」——于是
    // 下一轮尺寸的 cabinet-hover 再也掀不开，图与 cabinet 字节相同。
    // reload 后种子脚本（Page.addScriptToEvaluateOnNewDocument）会重跑，
    // mulberry32 从同一初值出发，封套配色不变，所以不破坏可比性。
    await probe.run('location.reload()').catch(() => {});
    await wait(5200);
    await wait(900);

    // 悬停态必须**最先**拍，理由见下面 CLOSE_CARDS 的注释：一旦点过
    // .record-preview，flip 就被钉在 'closed'，之后任何 hover 都不再掀开。
    await probe.run(switchView('唱片柜'));
    await wait(1100);
    await probe.run(FREEZE_DATES);
    try {
      await probe.hover('.record-card .record-preview');
      await wait(700);
      // keepCards：hover 态要的就是卡片掀开，别让 grab 把它合回去。
      await grab(size.id, 'cabinet-hover', { park: false, keepCards: true });
    } catch (error) {
      console.log(`[baseline] 跳过 ${size.id}/cabinet-hover：${error.message}`);
    }

    for (const view of VIEWS) {
      const result = await probe.run(switchView(view.label));
      if (result !== 1) throw new Error(`切不到视图 ${view.label}：${result}`);
      // 换页是 520ms 的圆形扩散 + 130ms 退场（src/motion-state.ts），留足余量。
      await wait(1100);
      await probe.run(FREEZE_DATES);
      await grab(size.id, view.id);
    }

    // 模态框是独立的视觉资产，且只在打开时存在，视图截图覆盖不到。
    // 四个都拍：漏掉的那个正好最容易在重构时被改坏（占位重复、按钮丢失）。
    // 设置里塞了滑杆、单选、开关、下拉，是控件最密集的一屏；
    // 收藏与编辑带表单和封面网格；说明是纯排版。
    const modals = [
      ['modal-settings', '.header-actions button[aria-label="空间设置"]'],
      ['modal-import', '.shelf-label ~ * .add-to-shelf'],
      ['modal-guide', '.header-actions button[aria-label="使用说明"]'],
    ];
    for (const [name, opener] of modals) {
      try {
        await probe.run(`(() => {
          const node = document.querySelector(${JSON.stringify(opener)});
          if (!node) return 0;
          node.click();
          return 1;
        })()`);
        await wait(700);
        await probe.run(FREEZE_DATES);
        await grab(size.id, name);
        await probe.run(`(() => {
          document.querySelector('.modal-close')?.click();
          return 1;
        })()`);
        await wait(600);
      } catch (error) {
        console.log(`[baseline] 跳过 ${size.id}/${name}：${error.message}`);
      }
    }

    // 编辑弹窗要先把一张唱片点开成「已聚焦」，否则右侧面板是空的，
    // 弹窗里的内容也就无从比对。先点开第一张卡，再从右侧进编辑。
    try {
      await probe.run(`(() => {
        document.querySelector('.record-card .record-preview')?.click();
        return 1;
      })()`);
      await wait(600);
      await probe.run(`(() => {
        document.querySelector('.edit-notes')?.click();
        return 1;
      })()`);
      await wait(700);
      await probe.run(FREEZE_DATES);
      await grab(size.id, 'modal-edit');
      await probe.run(`(() => {
        document.querySelector('.modal-close')?.click();
        return 1;
      })()`);
      await wait(600);
    } catch (error) {
      console.log(`[baseline] 跳过 ${size.id}/modal-edit：${error.message}`);
    }

    // 两个「动起来之后才存在」的状态。
    //
    // 静态截图拍不到它们，而它们偏偏是样式最重的两屏：
    //   - 正在听：唱盘 is-playing、黑胶 spinning、唱臂落针、进度条在走；
    //   - 专注运行：进度环 is-running、读数在倒数。
    // 重构 CSS 时这两块被误改的概率最高，却一直没有任何基准覆盖。
    //
    // 两者都需要真音频才能进入：
    //   RoomPlayer.schedule() 播放前会 await readAsset(record.assetId)，
    //   拿不到就 throw「找不到「x」的文件」并回调 onError，
    //   status.running 永远停在 false，唱盘就一直是待机态。
    // 所以资产在 launch 之前就要种进 IndexedDB（见 seedAssets）。
    //
    // 播放时长要固定：MediaTone 是 3 秒，播完会触发 onMusicEnded 自动接下一首。
    // 推进 1200ms 落在第一首中间，读数稳定在 0:01 附近。
    await probe.run(switchView('正在听'));
    await wait(1100);
    try {
      await probe.run(`(() => {
        document.querySelector('.dock-disc')?.click();
        return 1;
      })()`);
      await wait(500);
      // 冻结必须在「点播放之前」：`HTMLMediaElement.currentTime` 的 getter 一旦
      // 被换掉，播放器往后再怎么走都读到 1.0。反过来先播一会儿再冻结，读到的
      // 就是那一刻的真实进度——而那一刻落在哪里取决于两次运行的实际耗时。
      await probe.run(FREEZE_MEDIA);
      await wait(200);
      await probe.run(`(() => {
        document.querySelector('.main-play')?.click();
        return 1;
      })()`);
      await wait(900);
      // 时钟推到一个固定点再拍，否则两次运行差几秒，进度条对不上。
      await probe.run(`(() => { window.__probeClock.advance(1200); return 1; })()`);
      await wait(500);
      await probe.run(FREEZE_DATES);
      await grab(size.id, 'listening-playing');
    } catch (error) {
      console.log(`[baseline] 跳过 ${size.id}/listening-playing：${error.message}`);
    }
    // 收起播放器并暂停，别让它在专注/相集那几屏继续跑（会污染其它截图）。
    await probe.run(`(() => {
      document.querySelector('.main-play')?.click();
      document.querySelector('.play-card-close')?.click();
      return 1;
    })()`).catch(() => {});
    await wait(400);

    await probe.run(switchView('专注'));
    await wait(1100);
    try {
      await probe.run(`(() => {
        document.querySelector('.focus-actions .primary-button')?.click();
        return 1;
      })()`);
      await wait(900);
      // 专注默认 25 分钟。推进固定量，进度环角度与读数每次都一样。
      await probe.run(`(() => { window.__probeClock.advance(600000); return 1; })()`);
      await wait(600);
      await probe.run(FREEZE_DATES);
      await grab(size.id, 'focus-running');
    } catch (error) {
      console.log(`[baseline] 跳过 ${size.id}/focus-running：${error.message}`);
    }
    // 重置，避免"运行中"状态残留到下一轮尺寸。
    await probe.run(`(() => {
      document.querySelector('button[aria-label="重置本轮"]')?.click();
      return 1;
    })()`).catch(() => {});
    await wait(400);

    // 放映全屏。放在最后：它把窗口撑到 1280×800，其它图都在原尺寸上拍，
    // 顺序一乱就要在两种窗口尺寸之间来回跳，每次都得等布局重排。
    //
    // 只拍**真实存在**的形态，不硬加类：
    //   - 拼贴全屏、相集全屏是主窗口里真能点到的两种（「全屏」按钮）；
    //   - 透明版式在主窗口里没有全屏入口——那颗按钮变成「放到桌面」，点它开的是
    //     另一个渲染进程（src/desktop.tsx），画面贴回桌面。所以它只拍窗口态。
    // 54 条 is-expanded 规则由前两档覆盖：其中只有 1 条在 collage-type.css、
    // 1 条跟雨丝有关，其余是与版式无关的容器规则，两档都走得到。
    await probe.run(switchView('相集'));
    await wait(1100);
    const presets = [
      { label: '拼贴', expand: true },
      { label: '相集', expand: true },
      // 透明：窗口态，不点全屏。它的铺满形态在桌面窗里，这里不模拟。
      { label: '透明', expand: false },
    ];
    for (const preset of presets) {
      const id = preset.expand ? `expand-${preset.label}` : `window-${preset.label}`;
      try {
        const picked = await probe.run(`(() => {
          const hit = [...document.querySelectorAll('.theater-templates button')]
            .find(b => b.textContent.trim() === ${JSON.stringify(preset.label)});
          if (!hit) return 'missing-template';
          hit.click();
          return 1;
        })()`);
        if (picked !== 1) throw new Error(String(picked));
        await wait(700);
        if (preset.expand) {
          const opened = await probe.run(`(() => {
            const hit = [...document.querySelectorAll('button')]
              .find(b => b.getAttribute('aria-label') === '全屏');
            if (!hit) return 'missing-expand';
            hit.click();
            return 1;
          })()`);
          if (opened !== 1) throw new Error(String(opened));
          // 窗口从 680×980 撑到 1280×800：等尺寸真的变完再挂 .is-expanded
          // （见 MediaRoom.tsx:304），再加余量给版式内部重排。
          await wait(2000);
        }
        await probe.run(FREEZE_DATES);
        await grab(size.id, id);
        if (preset.expand) {
          const closed = await probe.run(`(() => {
            const hit = [...document.querySelectorAll('button')]
              .find(b => b.getAttribute('aria-label') === '退出全屏');
            if (!hit) return 'missing-collapse';
            hit.click();
            return 1;
          })()`);
          if (closed !== 1) throw new Error(String(closed));
          await wait(1600);
        }
      } catch (error) {
        console.log(`[baseline] 跳过 ${size.id}/${id}：${error.message}`);
        // 出错时也要退出全屏，否则下一轮的图全在 1280×800 上拍。
        await probe.run(`(() => {
          const hit = [...document.querySelectorAll('button')]
            .find(b => b.getAttribute('aria-label') === '退出全屏');
          hit?.click();
          return 1;
        })()`).catch(() => {});
        await wait(1200);
      }
    }
    // 回到拼贴，别把版式选择带给下一轮尺寸（它存在 localStorage 里，会跨 reload）。
    await probe.run(`(() => {
      const hit = [...document.querySelectorAll('.theater-templates button')]
        .find(b => b.textContent.trim() === '拼贴');
      hit?.click();
      return 1;
    })()`).catch(() => {});
    await wait(500);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    // 记下 dist/ 的构建时间：忘了重新构建是本项目最容易踩的坑（会量到上一版）。
    distIndex: fs.statSync(path.join(ROOT, 'dist', 'index.html')).mtime.toISOString(),
    // 实际生效的设备像素比。它决定位图尺寸，比对时必须一致。
    dpr: Number(DPR),
    sizes: SIZES,
    views: VIEWS,
    files: captured,
  };
  fs.writeFileSync(path.join(OUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[baseline] 完成 ${captured.length} 张，输出在 ${path.relative(ROOT, OUT_ROOT)}`);
  probe.close();
});
