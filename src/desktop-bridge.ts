/**
 * 桌面放映窗与主窗口之间的通道。
 *
 * 为什么要有这么一个文件：桌面窗是**另一个渲染进程**，它拿不到主窗口的 React 状态，
 * 也拿不到主窗口里的 blob: 地址（那个只在创建它的进程里有效）。而页面跑在
 * `sandbox: true` 里没有 ipcRenderer，所以方向只能反过来：两边各自把东西挂到
 * `window` 上，主进程定时搬运。这套做法与 focus-bridge.ts 是同一个形状，
 * 那边搬的是番茄钟读数，这边搬的是「现在该画什么」。
 *
 * 三个命名前缀分工：
 *   __ravenStageSnapshot —— 主窗口写、桌面窗读（要画的内容）
 *   __ravenStageCommand  —— 主进程调、主窗口接（桌面窗上点了什么）
 *   __ravenDesktopDrain  —— 桌面窗写、主进程取（攒下来的点击）
 */

import type { MediaItem } from './records';
import type { LayerList } from './layers';
import type { StoneStyle } from './marble.ts';
import type { TemplateId } from './templates';
import type { ToneHint } from './templates';
import type { StageAmbience, StageDisc, StageFocus, StageNow } from './TemplateStage';

/**
 * 主窗口交给桌面窗的一整份「放映状态」。
 *
 * 为什么把 palette 也传过去、而不是让桌面窗自己按 item.path 重新取色：
 * 取色对视频要**解码一帧**，桌面窗再取一次就是第二份解码。传一份颜色数组过去
 * 只有几十字节，而且保证两边的配色完全一样（取色有随机性，两次可能不同）。
 */
export type StageSnapshot = {
  item: MediaItem | null;
  template: TemplateId;
  stone: StoneStyle;
  /** 主窗口取到的原始色板。桌面窗用 collageTone(colors, hint) 算出同一套颜色。 */
  palette: string[];
  hint: ToneHint;
  disc: StageDisc | null;
  focus: StageFocus | null;
  ambience: StageAmbience | null;
  now: StageNow;
  /**
   * 图层表（时间/日期/标题/番茄钟/唱片/曲目）。
   *
   * 主窗口与桌面窗两边都能拖、都能删——所以这份表是一个来回跑的双向状态：
   * 主窗口改完推过去，桌面窗拖完发 {@link StageCommand} 里的 `layers` 回来。
   * 存档只有主窗口那份（localStorage），桌面窗那边永远是只读的副本。
   */
  layers: LayerList;
  /** 番茄钟剩余毫秒，图层里计时那块用。 */
  focusLeft: number | null;
  /** 图层里「标题」那一块写的字。 */
  title: string;
  /** 能不能切歌，决定桌面窗里的唱片接不接指针。 */
  canPrev: boolean;
  canNext: boolean;
};

/**
 * 桌面窗上发生的动作。
 *
 * 只列真正需要在主窗口那边改状态的东西：桌面窗自己不持有播放器、不持有收藏柜，
 * 它点一下只能「请求」主窗口去做。凡是不需要主窗口知道的（比如拖动叠加元素的位置）
 * 也走这里，因为那份位置设置存在主窗口的 localStorage 里。
 */
export type StageCommand =
  | { type: 'stone' }
  | { type: 'prev' }
  | { type: 'next' }
  /**
   * 桌面窗里拖了 / 删了一块图层，整份表回传。
   *
   * 为什么回整份而不是「哪一块挪到了哪」：位置是连续拖出来的，
   * 一次拖动会经过几十个中间位置，只有松手那一下才该落盘——回整份就天然合并了，
   * 主窗口直接覆盖回去，不需要在这两条线之间对账。
   */
  | { type: 'layers'; value: LayerList };

type RavenWindow = Window & {
  __ravenStageSnapshot?: StageSnapshot;
  __ravenStageCommand?: (command: StageCommand) => void;
  __ravenDesktopPaint?: (snapshot: StageSnapshot) => void;
  __ravenDesktopDrain?: () => StageCommand[];
  __ravenDesktopQueue?: StageCommand[];
  __ravenStageClosed?: () => void;
};

/** 见 electron/preload.cjs。有它就走 IPC，没有就退回下面的 window 全局量。 */
type RavenChannel = {
  send: (channel: string, payload: unknown) => boolean;
  on: (channel: string, handler: (payload: unknown) => void) => () => void;
};

function channel(): RavenChannel | undefined {
  return (window as Window & { raven?: RavenChannel }).raven;
}

/**
 * 拿 window 上的桥接对象。
 *
 * 写成函数而不是模块级的常量：`installStageDrain` 这类要在 Node 的测试里跑，
 * 那里没有 window，模块一加载就炸。取的时候才碰它，和 media.ts 一个写法。
 */
function raven(): RavenWindow {
  return window as RavenWindow;
}

/** 攒下来的动作。抽成纯函数是为了能在测试里直接喂一个数组验顺序。 */
export function drainCommands(host: { __ravenDesktopQueue?: StageCommand[] }): StageCommand[] {
  const queue = host.__ravenDesktopQueue ?? [];
  // 换一个新数组而不是 splice：正压进来的那一笔会跟着旧引用一起丢。
  host.__ravenDesktopQueue = [];
  return queue;
}

/* ---------- 主窗口侧 ---------- */

/**
 * 把当前放映状态挂出去，给桌面窗用。
 *
 * 有 preload 时直接发：主进程收到就转给桌面窗，不必等它每 200ms 来问一次
 * 「主窗口现在放的是什么」——那条路每轮都要 eval 一段字符串进去。
 * 没有 preload 时仍然挂到 window 上，探针靠这个读。
 */
export function publishStage(snapshot: StageSnapshot) {
  const ipc = channel();
  if (ipc) {
    ipc.send('stage:snapshot', snapshot);
    return;
  }
  raven().__ravenStageSnapshot = snapshot;
}

/**
 * 接收桌面窗上按下的动作。返回取消函数，卸载时调用。
 *
 * 这里用「覆盖式」注册而不是数组：放映页同时只会有一只，多个处理器会让
 * 一次点击被处理两遍（切歌会跳两首）。
 */
export function listenStageCommand(onCommand: (command: StageCommand) => void) {
  const ipc = channel();
  // 收的是 `stage:press`，不是页面自己发出去的 `stage:command`：
  // preload 的收发两份白名单互不相交（页面不能伪造主进程推来的消息），
  // 所以「桌面窗发的」和「主进程转给主窗口的」必须是两个名字。
  if (ipc) return ipc.on('stage:press', payload => { if (isStageCommand(payload)) onCommand(payload); });
  const host = raven();
  host.__ravenStageCommand = onCommand;
  return () => {
    if (host.__ravenStageCommand === onCommand) host.__ravenStageCommand = undefined;
  };
}

/**
 * 收窄 IPC 那头送来的 unknown。
 *
 * 主进程那边发的是我们自己序列化过去的东西，但通道本身没有类型约束，
 * 所以在这里判一次——错的数据应该被丢掉，而不是让下游的 switch 走到
 * 一个不存在的分支。
 */
function isStageCommand(value: unknown): value is StageCommand {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'stone' || type === 'prev' || type === 'next' || type === 'layers';
}

/**
 * 接收「桌面窗关掉了」这个通知。
 *
 * 桌面窗可能是被用户关掉的（Alt+F4），也可能是系统带走的。主进程在窗口的
 * closed 事件里调这里，让控制条上那颗按钮回到「未按下」——不然按钮会一直亮着，
 * 而画面其实已经没了。
 */
export function listenStageClosed(onClosed: () => void) {
  const ipc = channel();
  if (ipc) return ipc.on('stage:closed', () => onClosed());
  const host = raven();
  host.__ravenStageClosed = onClosed;
  return () => {
    if (host.__ravenStageClosed === onClosed) host.__ravenStageClosed = undefined;
  };
}

/* ---------- 桌面窗侧 ---------- */

/** 主进程把主窗口的快照推过来，桌面窗存下来。 */
export function installStagePaint(onPaint: (snapshot: StageSnapshot) => void) {
  const ipc = channel();
  if (ipc) return ipc.on('stage:paint', payload => onPaint(payload as StageSnapshot));
  const host = raven();
  host.__ravenDesktopPaint = onPaint;
  return () => {
    if (host.__ravenDesktopPaint === onPaint) host.__ravenDesktopPaint = undefined;
  };
}

/**
 * 桌面窗上攒一个动作，等主进程来取。
 *
 * 有 preload 时直接发出去（即时），没有时攒进队列等主进程来读——
 * 桌面窗在探针里是同一个页面，但探针建的窗口没有 preload。
 */
export function sendStageCommand(command: StageCommand) {
  const ipc = channel();
  if (ipc) {
    ipc.send('stage:command', command);
    return;
  }
  const host = raven();
  const queue = host.__ravenDesktopQueue ?? [];
  queue.push(command);
  host.__ravenDesktopQueue = queue;
}

/**
 * 主进程调它来取走攒下的动作。
 *
 * 取走时**换一个新数组**而不是原地 `splice(0)`：drain 返回的就是原来那个引用，
 * 原地清空会把要返回的东西一起清掉。换新数组则旧的一整条原样交出去，
 * 这期间正压进来的动作落到新数组里，两边都不丢。
 */
export function installStageDrain() {
  const host = raven();
  host.__ravenDesktopDrain = () => drainCommands(host);
}
