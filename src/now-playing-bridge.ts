// 页面和主进程之间的最小约定。
//
// 两条路并存：
//
//   有 preload（正常启动）：`window.raven.send('now:action', ...)` 直接送达，
//   `raven.on('now:snapshot', ...)` 收推送。
//
//   没有 preload（tools/probe 里自己建的窗口）：退回旧的 window 全局量，
//   主进程每 400ms 来取一次 outbox。
//
// 为什么保留旧路：探针和基线脚本自己定 webPreferences、自己建窗口，
// 它们的窗口上不会装 preload。删掉旧路等于让 130 个探针全部失灵，
// 而那些探针正是这个仓库唯一能证明「视觉和时序没被改坏」的东西。
import type { MediaAction, NowPlaying } from './now-playing';

type RavenWindow = Window & {
  __ravenNowPlaying?: (raw: unknown) => void;
  __ravenNowPlayingOutbox?: string[];
};

type RavenChannel = {
  send: (channel: string, payload: unknown) => boolean;
  on: (channel: string, handler: (payload: unknown) => void) => () => void;
};

/** 见 electron/preload.cjs。 */
function channel(): RavenChannel | undefined {
  return (window as Window & { raven?: RavenChannel }).raven;
}

/** 拿 window 上的桥接对象。写成函数是为了 Node 里跑测试时不会在加载期就炸。 */
function raven(): RavenWindow {
  return window as RavenWindow;
}

/** 注册接收器。返回取消函数，组件卸载时调。 */
export function listenNowPlaying(onChange: (raw: unknown) => void): () => void {
  const ipc = channel();
  if (ipc) return ipc.on('now:snapshot', onChange);
  const bridge = raven();
  bridge.__ravenNowPlaying = onChange;
  return () => {
    if (bridge.__ravenNowPlaying === onChange) delete bridge.__ravenNowPlaying;
  };
}

/** 控制链路的三种消息：开始 / 停止监听、要一份当前快照。 */
type BridgeAction = MediaAction | 'start' | 'stop' | 'ping';

function push(action: BridgeAction) {
  const ipc = channel();
  if (ipc) {
    ipc.send('now:action', action);
    return;
  }
  const bridge = raven();
  bridge.__ravenNowPlayingOutbox = [...(bridge.__ravenNowPlayingOutbox ?? []), action];
}

/**
 * 告诉主进程开始 / 停止监听外部音乐，或者 ping 一次要回当前快照。
 * ping 的用处：切走再切回来时，一首歌可能几分钟都不变，
 * 光等主进程推送会让卡片先空着闪一下。
 */
export function askNowPlaying(action: 'start' | 'stop' | 'ping') {
  push(action);
}

/**
 * 让外部播放器做事：暂停切换、下一首、上一首。
 * 不做本地乐观更新——播放器可能拒绝，状态以辅助程序推回来的快照为准。
 */
export function commandNowPlaying(action: MediaAction) {
  push(action);
}

export type { NowPlaying };
