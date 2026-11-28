/**
 * 把主进程抓来的系统音频拼成一条 MediaStream。
 *
 * 为什么需要这一层：macOS 上抓系统音频靠一个子进程（见 electron/audio-tap.cjs），
 * 它吐的是裸 PCM 字节。而 `src/audio.ts` 的 `attachLineIn()` 要的是 `MediaStream`——
 * 那条路径是 Windows 虚拟声卡走过来的，形状对了就完全不用改。
 *
 * 所以这里只做一件事：PCM 字节 → `AudioData` → `MediaStreamTrackGenerator`，
 * 交给 `new MediaStream([track])`。
 *
 * ── 三个必须同时满足的条件（2026-11-28 实测，缺任何一个都是静音）──────
 *
 *   1. **按实时节奏连续写**。写完一块就停，后面的数据再也不会被拉走——
 *      generator 只在有消费者要数据时才推进。探针 v1 就是这么失败的：
 *      写了一块 1 秒的正弦波，peak 读到 0。
 *
 *   2. **timestamp 必须用微秒且连续递增**。写 0 会让每一块都被当成「同一时刻」，
 *      合成器收到就丢。
 *
 *   3. **目标节点必须接到 destination**。只在中间挂个 AnalyserNode 是不够的——
 *      整条链被判定为无人消费，Chromium 不会去拉 generator。这条最反直觉，
 *      探针里 analyser.connect(ctx.destination) 之后立刻就有数据了。
 *
 * 完整实验记录见 docs/macOS-实测记录.md 第 5.4 节。
 */

const FALLBACK_RATE = 48000;
const FALLBACK_CHANNELS = 1;

/**
 * 主进程推来的一块 PCM，或一条抓取状态。与 audio-tap.cjs 的 post() 形状一致。
 *
 * `state` 是状态名本身，不能只看 `live`：
 *   starting   —— 平台对、二进制在、进程刚起。**不是失败**。
 *   live       —— 真的读到了非零样本（权限是通的）。
 *   silent     —— 进程在跑、字节在读，但两秒半里全是零。
 *                 多半是缺权限，也可能只是播放器暂停着——所以它给流也给人话。
 *   denied / missing / error / unsupported / idle —— 有结论的结局，各自对应不同的提示。
 */
export type TapMessage =
  | { type: 'pcm'; sampleRate: number; channels: number; bytes: Uint8Array }
  | { type: 'state'; live: boolean; state: string; reason: string };

/**
 * 把 16 位有符号小端 PCM 转成 Float32。
 *
 * `AudioData` 也接受 `s16` 格式，那样能省掉这一次转换。但实测发现
 * `AudioData` 的 `s16` 在 generator 里会被重采样一次，而且它要求 `numberOfFrames`
 * 与字节数严格对齐，超出一个字节就整个构造抛异常。转成 f32 之后这条路是稳的，
 * 48000 个样本的循环对每 200ms 一次来说完全不值得优化。
 */
export function pcmToFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const frames = Math.floor(bytes.byteLength / 2);
  // 显式从 ArrayBuffer 建：AudioData 的 data 字段要求
  // `ArrayBufferView<ArrayBuffer>`，而 `new Float32Array(n)` 在 TS 5.9 里被推断成
  // `Float32Array<ArrayBufferLike>`（含 SharedArrayBuffer），直接传会被判错。
  const out = new Float32Array(new ArrayBuffer(frames * 4));
  const data = new DataView(bytes.buffer, bytes.byteOffset, frames * 2);
  for (let i = 0; i < frames; i += 1) {
    // 32768 而不是 32767：16 位有符号的范围是 -32768..32767，
    // 除以 32767 会让 -32768 变成 -1.0000305，超出 [-1,1] 被裁掉。
    out[i] = data.getInt16(i * 2, true) / 32768;
  }
  return out;
}

/**
 * 一条持续可读的音频轨，数据由 `write()` 喂进来。
 *
 * 生命周期：`start()` 之后 `write()` 多少块都能收；`stop()` 关掉 generator，
 * 轨道进入 ended，上游的 `attachLineIn` 会走它自己的 ended 处理（detach）。
 */
export class TapStream {
  private writer: WritableStreamDefaultWriter<AudioData> | null = null;
  private track: MediaStreamTrack | null = null;
  /** 下一块的起始时间，微秒。**必须连续**，见文件头第 2 条。 */
  private stamp = 0;
  /** 正在等 `write()` 的字节（一块没凑齐就等下一块）。 */
  private queue: Uint8Array[] = [];
  private closed = false;

  /**
   * 建轨并把 `write()` 跑起来。
   *
   * 这里不接 AudioContext——`attachLineIn()` 会用 `createMediaStreamSource(stream)`
   * 把它接进图里，而 AudioContext 自己会一直拉数据（它是最终的消费者）。
   * 探针里那条 `analyser.connect(destination)` 在正式代码里由 audio.ts 现有链路满足。
   */
  open(): MediaStream | null {
    if (typeof MediaStreamTrackGenerator === 'undefined') return null;
    const generator = new MediaStreamTrackGenerator({ kind: 'audio' });
    this.writer = generator.writable.getWriter();
    this.track = generator;
    this.stamp = 0;
    this.closed = false;
    return new MediaStream([generator]);
  }

  /** 收一块 PCM。凑不够一帧的尾巴留到下一块（`AudioData` 不接受半个样本）。 */
  write(message: Extract<TapMessage, { type: 'pcm' }>) {
    if (this.closed || !this.writer) return;
    const bytes = message.bytes;
    if (!bytes.byteLength) return;

    // 攒到 2 字节的整数倍。正常情况下主进程切得整整齐齐，这里永远不触发。
    this.queue.push(bytes);
    let total = 0;
    for (const chunk of this.queue) total += chunk.byteLength;
    // 这个长度必须是偶数。奇数说明字节流错位了，丢掉最后那一个字节而不是让整个流崩。
    if (total % 2 !== 0) total -= 1;
    if (!total) return;

    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.queue) {
      if (offset + chunk.byteLength <= total) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    this.queue = [];

    const rate = message.sampleRate || FALLBACK_RATE;
    const channels = message.channels || FALLBACK_CHANNELS;
    const data = pcmToFloat(joined);
    const frames = Math.floor(data.length / channels);

    const audio = new AudioData({
      format: 'f32-planar',
      sampleRate: rate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: this.stamp,
      data,
    });
    // 下一块的时刻 = 这一块播完之后。用样本数算而不是用 performance.now()，
    // 那样即使某一块晚到，时间轴也是连续的，不会出现空洞。
    this.stamp += Math.round((frames * 1_000_000) / rate);

    // 不 await：await 会让后面的块排在前面那块之后，播放器卡一下就会累积出延迟。
    // `write()` 本身返回的 Promise 在这里被有意丢弃——写失败只可能是流已经关了，
    // 那种情况下面的 catch 会把 closed 置上，不用另外处理。
    writer_write(this.writer, audio);
  }

  close() {
    this.closed = true;
    this.queue = [];
    const writer = this.writer;
    this.writer = null;
    if (writer) { void writer.close().catch(() => { /* 已经关了 */ }); }
    const track = this.track;
    this.track = null;
    if (track) { try { track.stop(); } catch { /* 已经停了 */ } }
  }
}

/** 单独包一层只是因为 ESLint 不喜欢「调用了返回 Promise 的函数却不处理」。 */
function writer_write(writer: WritableStreamDefaultWriter<AudioData>, audio: AudioData) {
  writer.write(audio).catch(() => { /* 流被关掉时再来一块，属正常收尾 */ });
}

// 这里**故意不提供** openSystemAudio()：那是 src/system-audio.ts 的事。
//
// 早先在这个文件里也写了一份，结果两份逻辑各自维护：这里那份只会把状态转给
// 回调、不处理超时，system-audio.ts 那份要返回带原因的结果。留着两份的话，
// 下一个改这块的人会不知道该改哪一份（更糟的是改了一份、另一份照旧生效）。
// 这个文件只负责「字节 → MediaStream」，用法上的判断全在 system-audio.ts。
