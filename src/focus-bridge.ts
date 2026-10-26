/**
 * 番茄钟与桌面小组件之间的通道。
 *
 * 页面跑在 sandbox: true 的渲染进程里，没有 ipcRenderer，也没有 require，
 * 所以方向是反的：页面把状态挂到 window 上，主进程定时来取；
 * 主进程要下命令时，直接调页面里挂的回调。
 * 和 now-playing-bridge 用的是同一套做法，只是那边传歌名，这边传计时。
 */

import type { FocusPhase } from './focus';

export type FocusSnapshot = {
  phase: FocusPhase;
  running: boolean;
  /** 剩余毫秒。 */
  remaining: number;
  /** 本阶段总时长毫秒，用来画进度环。 */
  total: number;
  /** 自上次长休息以来完成的专注轮数。 */
  rounds: number;
  roundsBeforeLong: number;
  /** 计时是否处于「应该显示小组件」的状态：开始了、或者暂停着但没走完。 */
  visible: boolean;
};

type RavenWindow = Window & {
  __ravenFocusSnapshot?: FocusSnapshot;
  __ravenFocusCommand?: (action: string) => void;
  __ravenFocusWanted?: boolean;
};

const raven = window as RavenWindow;

/** 把当前计时状态挂到 window 上，等主进程来取。每次状态变化调一次即可。 */
export function publishFocus(snapshot: FocusSnapshot) {
  raven.__ravenFocusSnapshot = snapshot;
}

/**
 * 请求把桌面小窗重新显示出来。
 * 用户点过小窗上的收起之后，就靠这个把它找回来。
 * 主进程读取后会把标记清掉（见 electron/focus-mini.cjs）。
 */
export function requestMiniFocus() {
  raven.__ravenFocusWanted = true;
}

/**
 * 接收小组件上按下的动作（toggle / skip / close）。
 * 返回取消函数，卸载时调用。
 */
export function listenFocusCommand(onCommand: (action: string) => void) {
  raven.__ravenFocusCommand = onCommand;
  return () => {
    if (raven.__ravenFocusCommand === onCommand) raven.__ravenFocusCommand = undefined;
  };
}
