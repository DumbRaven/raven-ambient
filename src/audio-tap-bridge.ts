/**
 * 系统音频抓取的两条通道（mac 专有）。
 *
 * 形状和 src/now-playing-bridge.ts 一致：先看 `window.raven` 在不在，
 * 不在就说明没有 preload（探针自己建的窗口就是这样），这时静默退回「没有这个能力」。
 * 探针从来不需要系统音频，所以没有轮询兜底那一套——没 preload 就等于用不了，
 * 这比让探针去轮询一个只有真机才有的东西诚实。
 */

import type { TapMessage } from './audio-tap.ts';

type Raven = { platform?: string; send: (channel: string, payload?: unknown) => boolean; on: (channel: string, handler: (payload: never) => void) => () => void };

function raven(): Raven | undefined {
  return (window as unknown as { raven?: Raven }).raven;
}

/**
 * 这台机器上「外部音乐」的音频该从哪来。
 *
 * 三种情况要分开，因为下一步动作完全不同：
 *   darwin  —— 主进程的 Core Audio tap。页面上没有设备可选，也没有虚拟声卡。
 *   win32   —— 虚拟声卡（VB-Cable），靠 getUserMedia。
 *   其它    —— 没 preload 的探针窗口走这里。探针从来没在 mac 上跑过外部音乐，
 *              让它退回虚拟声卡那条老路即可，行为和改动前完全一致。
 */
export function tapPlatform(): 'darwin' | 'other' {
  return raven()?.platform === 'darwin' ? 'darwin' : 'other';
}

/**
 * 请主进程开始抓。
 *
 * 返回 false 表示「这次请求没发出去」——三种可能：没有 preload、
 * 通道不在白名单里、主进程拒绝（平台不是 darwin 或二进制缺失）。
 * 调用方据此判断「这条路根本不存在」，而不是「还没声音」。
 */
export function startTap(): boolean {
  return raven()?.send('tap:start') === true;
}

export function stopTap(): void {
  raven()?.send('tap:stop');
}

/** 订阅 PCM 与状态。返回取消函数；没有 preload 时返回一个空的取消函数。 */
export function listenTap(handler: (message: TapMessage) => void): () => void {
  const api = raven();
  if (!api) return () => {};
  return api.on('tap:chunk', handler as (payload: never) => void);
}
