// 页面和主进程之间的最小约定。
//
// 页面是 sandbox: true、没有 preload，里面既没有 ipcRenderer 也没有 require，
// 而主进程可以通过 executeJavaScript 在页面里执行代码。所以方向反过来定：
//   主进程 -> 页面：调 window.__ravenNowPlaying(snapshot)
//   页面 -> 主进程：把动作写进 window.__ravenNowPlayingOutbox，主进程每 400ms 取一次
// 轮询看着笨，但这是在不放开沙箱的前提下唯一能用的办法，空数组时几乎不花钱。
import type { MediaAction, NowPlaying } from './now-playing';

type RavenWindow = Window & {
  __ravenNowPlaying?: (raw: unknown) => void;
  __ravenNowPlayingOutbox?: string[];
};

const raven = window as RavenWindow;

/** 注册接收器。返回取消函数，组件卸载时调。 */
export function listenNowPlaying(onChange: (raw: unknown) => void): () => void {
  raven.__ravenNowPlaying = onChange;
  return () => {
    if (raven.__ravenNowPlaying === onChange) delete raven.__ravenNowPlaying;
  };
}

/** 控制链路的三种消息：开始 / 停止监听、要一份当前快照。 */
type BridgeAction = MediaAction | 'start' | 'stop' | 'ping';

function push(action: BridgeAction) {
  raven.__ravenNowPlayingOutbox = [...(raven.__ravenNowPlayingOutbox ?? []), action];
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

/** 主进程已经取走队列。这里只用于测试断言。 */
export function pendingActions(): number {
  return raven.__ravenNowPlayingOutbox?.length ?? 0;
}

export type { NowPlaying };
