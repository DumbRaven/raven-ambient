/**
 * macOS 上「外部音乐」的音频来源。
 *
 * Windows 那边是虚拟声卡（用户装 VB-Cable，页面 getUserMedia 拿到）；
 * macOS 上没有等价的免费虚拟声卡，走的是内置的 Core Audio tap 子进程
 * （见 electron/audio-tap.cjs），字节流由主进程推给页面，这里拼成 MediaStream。
 *
 * 之所以单独一个模块而不是塞进 line-in.ts：line-in 讲的是「输入设备」，
 * 这里的 mac 这条路**没有设备**——它不经过任何声卡。硬塞进去会让
 * `findCable` / `listInputs` 那些东西在 mac 上变成一堆没意义的死代码。
 */

import { listenTap, startTap, stopTap } from './audio-tap-bridge.ts';
import { TapStream, type TapMessage } from './audio-tap.ts';

/** 抓取没成的原因。每一种对应一句不同的话，不能混成一句「没声音」。 */
export type TapReason = 'unsupported' | 'denied' | 'missing' | 'error';

export type TapResult = { ok: true; stream: MediaStream } | { ok: false; reason: TapReason; detail: string };

/**
 * 等第一条「有结论」的状态消息的超时。
 *
 * `asking` 那一条只说「平台对、二进制在」，真正的结论在后面（live / denied）。
 * 用户在系统弹窗前面犹豫多久都合理，但**弹窗本身**在 2 秒内就该出现；
 * 5 秒还没结论说明这条路卡住了，那时候退回「没接上」比一直转圈好。
 */
const CONCLUDE_MS = 5000;

/**
 * 主进程报上来的状态名 → 页面用的失败原因。
 *
 * `idle` 是「我们自己把它停了」，页面不必显示任何东西，归到 error 只是兜底
 * （正常情况下开关一关，这条路已经没人听了）。
 */
function reasonOf(state: string): TapReason {
  if (state === 'missing') return 'missing';
  if (state === 'unsupported') return 'unsupported';
  if (state === 'denied') return 'denied';
  return 'error';
}

/**
 * 开一路系统音频。
 *
 * 返回失败而不是抛异常：调用方（LineIn.open）要按原因决定显示哪句话，
 * 而「用户没给权限」和「程序坏了」是两件事，用异常类型区分不如显式返回清楚。
 */
export function openSystemAudio(): Promise<TapResult> {
  return new Promise<TapResult>(resolve => {
    const tap = new TapStream();
    const stream = tap.open();
    if (!stream) {
      resolve({ ok: false, reason: 'unsupported', detail: '这个运行环境没有 MediaStreamTrackGenerator' });
      return;
    }

    let settled = false;
    // 这两个先声明成 undefined，下面 finish 里用 `?.` 兜住：
    // finish 可能在 timer / off 赋值之前就被同步调用（比如 startTap() 立刻返回 false），
    // 那时访问会抛 TDZ 的 `Cannot access before initialization`。
    let timer: number | undefined;
    let off: (() => void) | undefined;

    const finish = (result: TapResult) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      off?.();
      if (!result.ok) tap.close();
      resolve(result);
    };

    timer = window.setTimeout(() => {
      finish({ ok: false, reason: 'error', detail: '系统音频没有响应' });
    }, CONCLUDE_MS);

    // 先订阅再发 start：主进程收到 start 之后会立刻推 asking，
    // 反过来先发再订阅会漏掉开头几条（表现是偶尔要多点一次开关）。
    off = listenTap((message: TapMessage) => {
      if (message.type === 'pcm') { tap.write(message); return; }
      // asking 只说明「平台对、二进制在、正在等用户点弹窗」，还没有结论。
      // 把它当成失败会让开关一按下去就显示「没权限」，而弹窗根本还没出来。
      if (message.state === 'asking') return;
      if (message.state === 'live') { finish({ ok: true, stream }); return; }
      finish({ ok: false, reason: reasonOf(message.state), detail: message.reason });
    });

    if (!startTap()) {
      finish({ ok: false, reason: 'unsupported', detail: '没有 preload 通道（探针窗口就是这样）' });
      return;
    }

    // 轨道 ended 时（用户关开关、主进程退出）把订阅摘掉，否则每开一次攒一个监听。
    stream.getAudioTracks().forEach(track => {
      track.addEventListener('ended', () => { off?.(); stopTap(); }, { once: true });
    });
  });
}

/** 关掉抓取。轨道 ended 时会自己调一次，这里是给「用户关开关」用的显式入口。 */
export function closeSystemAudio(): void {
  stopTap();
}

/**
 * 没接上时给用户看的那句话。
 *
 * 三种原因三句话，因为它们的下一步动作完全不同：
 *   denied    —— 用户得去系统设置里打开一个开关。
 *   missing   —— 装包出问题，用户自己修不了，别让他去找设置。
 *   error     —— 说不清，给一次重试的机会。
 *
 * 措辞里不出现「虚拟声卡」：mac 上根本不需要装那个东西，提它只会让人去搜一个
 * 不存在的下载页。
 */
export function systemAudioHint(reason: TapReason): string {
  if (reason === 'denied') {
    return '还没拿到系统音频的录制权限。到「系统设置 → 隐私与安全性 → 录屏与系统录音」里，把「仅系统录音」那一节的开关打开。';
  }
  if (reason === 'missing') return '安装包里缺少音频抓取程序，重新下载一次安装包可以解决。';
  if (reason === 'unsupported') return '这个系统版本不支持直接抓系统音频。只有歌名，环境音不会自动避让。';
  return '系统音频没接上。关掉再打开这个开关可以重试。';
}
