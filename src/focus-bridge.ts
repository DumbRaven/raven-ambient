/**
 * 番茄钟与桌面小组件之间的通道。
 *
 * 页面跑在 sandbox: true 的渲染进程里，没有 ipcRenderer，也没有 require，
 * 所以方向是反的：页面把状态挂到 window 上，主进程定时来取；
 * 主进程要下命令时，直接调页面里挂的回调。
 * 和 now-playing-bridge 用的是同一套做法，只是那边传歌名，这边传计时。
 */

import type { FocusPhase } from './focus';
import type { PressingStyle } from './vinyl';

/**
 * 小窗计时圈里转的那张碟。
 * 和「正在听」唱盘上是同一张，但小窗是另一个渲染进程，拿不到 React 状态，
 * 也加载不了 blob: 地址（CSP 只放行 data:），所以颜色和封面都要随快照一起推过去。
 */
export type MiniDisc = {
  /** 变了就说明换碟了，小窗据此播一次切换动画。 */
  key: string;
  /** 封面。转不成 data: 时留空，只画彩胶。 */
  art: string;
  pressing: PressingStyle;
  base: string;
  accent: string;
  accent2: string;
  sheen: string;
  /** 压片角度，云石纹靠它错开方向。 */
  angle: string;
  /** 盘面偏浅时标签要换深色。 */
  light: boolean;
  spinning: boolean;
};

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
  /** 有没有歌可切，决定上一曲/下一曲要不要置灰。 */
  canSkip: boolean;
  /** 现在在放的碟。没有音乐时是 null，小窗退回只画进度环。 */
  disc: MiniDisc | null;
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
 * 接收小组件上按下的动作（toggle / skip / close / prev / next）。
 * 返回取消函数，卸载时调用。
 */
export function listenFocusCommand(onCommand: (action: string) => void) {
  raven.__ravenFocusCommand = onCommand;
  return () => {
    if (raven.__ravenFocusCommand === onCommand) raven.__ravenFocusCommand = undefined;
  };
}

/**
 * 把封面转成小窗能用的 data: 地址。
 *
 * 小窗的 CSP 是 `img-src data:`，blob: 会被拦；而封面在页面里本来就是 blob: 或
 * 打包进来的 svg 路径，所以得先画到 canvas 再导出来。缩到 96px 是因为小窗里
 * 这个圈只有 40 多个像素，原图几百 KB 白传。
 *
 * 拿不到就返回空串——小窗那边会只画彩胶，不影响计时。
 */
export async function miniArt(src: string | undefined): Promise<string> {
  if (!src || typeof document === 'undefined') return '';
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<boolean>(resolve => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
    });
    image.src = src;
    if (!(await loaded)) return '';
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return '';
    // 居中裁成正方形，否则方窗里放圆碟会把封面压扁
    const scale = Math.max(size / image.width, size / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    context.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return '';
  }
}
