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
import type { Overlays } from './overlays';
import type { RainSetting } from './rain';
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
  index: number;
  total: number;
  template: TemplateId;
  stone: StoneStyle;
  /** 主窗口取到的原始色板。桌面窗用 collageTone(colors, hint) 算出同一套颜色。 */
  palette: string[];
  hint: ToneHint;
  disc: StageDisc | null;
  focus: StageFocus | null;
  ambience: StageAmbience | null;
  now: StageNow;
  rain: RainSetting;
  overlay: Overlays;
  /** 番茄钟剩余毫秒，叠加层画计时用。 */
  focusLeft: number | null;
  /** 叠加层里「标题」那一块写的字。 */
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
  | { type: 'overlay'; value: Overlays }
  | { type: 'rain'; value: RainSetting };

type RavenWindow = Window & {
  __ravenStageSnapshot?: StageSnapshot;
  __ravenStageCommand?: (command: StageCommand) => void;
  __ravenDesktopPaint?: (snapshot: StageSnapshot) => void;
  __ravenDesktopDrain?: () => StageCommand[];
  __ravenDesktopQueue?: StageCommand[];
  __ravenStageClosed?: () => void;
};

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

/** 把当前放映状态挂出去，等主进程来取。 */
export function publishStage(snapshot: StageSnapshot) {
  raven().__ravenStageSnapshot = snapshot;
}

/**
 * 接收桌面窗上按下的动作。返回取消函数，卸载时调用。
 *
 * 这里用「覆盖式」注册而不是数组：放映页同时只会有一只，多个处理器会让
 * 一次点击被处理两遍（切歌会跳两首）。
 */
export function listenStageCommand(onCommand: (command: StageCommand) => void) {
  const host = raven();
  host.__ravenStageCommand = onCommand;
  return () => {
    if (host.__ravenStageCommand === onCommand) host.__ravenStageCommand = undefined;
  };
}

/**
 * 接收「桌面窗关掉了」这个通知。
 *
 * 桌面窗可能是被用户关掉的（Alt+F4），也可能是系统带走的。主进程在窗口的
 * closed 事件里调这里，让控制条上那颗按钮回到「未按下」——不然按钮会一直亮着，
 * 而画面其实已经没了。
 */
export function listenStageClosed(onClosed: () => void) {
  const host = raven();
  host.__ravenStageClosed = onClosed;
  return () => {
    if (host.__ravenStageClosed === onClosed) host.__ravenStageClosed = undefined;
  };
}

/* ---------- 桌面窗侧 ---------- */

/** 主进程把主窗口的快照推过来，桌面窗存下来。 */
export function installStagePaint(onPaint: (snapshot: StageSnapshot) => void) {
  const host = raven();
  host.__ravenDesktopPaint = onPaint;
  return () => {
    if (host.__ravenDesktopPaint === onPaint) host.__ravenDesktopPaint = undefined;
  };
}

/**
 * 桌面窗上攒一个动作，等主进程来取。
 *
 * 为什么攒着而不是立刻想办法发出去：桌面窗没有 ipcRenderer，
 * 唯一的出口就是让主进程定时来读。攒成一个队列，连点两下也不会丢。
 */
export function sendStageCommand(command: StageCommand) {
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
