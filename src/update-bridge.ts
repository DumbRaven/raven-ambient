/**
 * 检查更新的页面侧桥。
 *
 * 页面自己不联网——CSP 是 `default-src 'self'`，而真正的请求由主进程发
 * （见 electron/update.cjs）。这里只做两件事：把「查一下」送出去，把结果接回来。
 *
 * 没有 preload 时（tools/probe 里自己建的窗口）一律返回「查不到」。
 * 这不影响任何探针：检查更新是个纯 UI 动作，探针不需要它。
 */

import type { UpdateOutcome, UpdateReply } from './update-state';

type RavenChannel = {
  send: (channel: string, payload: unknown) => boolean;
  on: (channel: string, handler: (payload: unknown) => void) => () => void;
};

/** 见 electron/preload.cjs。 */
function channel(): RavenChannel | undefined {
  return (window as Window & { raven?: RavenChannel }).raven;
}

/** 没有 preload、或通道没通时的兜底。版本号给空串，界面会自己跳过那一行。 */
function fallback(reason: string): UpdateReply {
  return { current: '', result: { status: 'unknown', reason } };
}

/**
 * 请主进程去问一次 GitHub。
 *
 * 返回 Promise 而不是靠回调，是因为调用点要 `await` 它来收起「正在检查…」这个状态。
 * 没有 preload 时直接 resolve 成 unknown：探针里点这个按钮不该抛错。
 *
 * 注意即使查不到版本，返回里也带着主进程的本机版本号——界面那行版本文字
 * 用的是它，跟这次查询成不成功无关。
 */
export function checkForUpdate(): Promise<UpdateReply> {
  const ipc = channel();
  if (!ipc) return Promise.resolve(fallback('no-bridge'));

  return new Promise((resolve) => {
    // 只收一条：拿到结果立刻摘掉监听，不然设置面板开关几次就积一层。
    const off = ipc.on('update:result', (payload) => {
      off();
      resolve(payload as UpdateReply);
    });
    // send 返回 false 说明通道不在白名单里（改了 preload 却忘了这里）。
    // 这种情况下监听永远不会被触发，必须自己结算，否则那个「正在检查…」会一直转。
    if (!ipc.send('update:check', null)) {
      off();
      resolve(fallback('no-channel'));
    }
  });
}

/**
 * 让主进程用系统浏览器打开下载地址。
 *
 * **不传 URL**：要打开哪个地址由主进程自己缓存（它在上一次检查时记下的），
 * 页面传的任何地址都会被丢掉。这样这条通道即使被利用也只能打开同一个下载页。
 */
export function openDownload(): void {
  channel()?.send('update:open', null);
}

export type { UpdateOutcome, UpdateReply };

