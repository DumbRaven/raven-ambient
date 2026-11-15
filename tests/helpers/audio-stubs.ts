import type { TestContext } from 'node:test';
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
export class Parameter {
  value = 1;
  events: { kind: string; value?: number; at: number }[] = [];
  setTargetAtTime(value: number, at: number) { this.value = value; this.events.push({ kind: 'target', value, at }); }
  setValueAtTime(value: number, at: number) { this.value = value; this.events.push({ kind: 'set', value, at }); }
  linearRampToValueAtTime(value: number, at: number) { this.value = value; this.events.push({ kind: 'ramp', value, at }); }
  cancelScheduledValues(at: number) { this.events = this.events.filter(event => event.at < at); }
}
class AudioNode {
  gain = new Parameter(); pan = new Parameter(); frequency = new Parameter(); Q = new Parameter();
  threshold = new Parameter(); knee = new Parameter(); ratio = new Parameter(); attack = new Parameter(); release = new Parameter();
  stopped = false;
  connect(node: AudioNode) { return node; }
  disconnect() {} start() {} stop() { this.stopped = true; }
}
export class Context {
  static current: Context;
  currentTime = 10; destination = new AudioNode(); sources: AudioNode[] = [];
  /** 挂过的外部音乐源，一个流一个。 */
  lineSources: AudioNode[] = [];
  resumeGate?: ReturnType<typeof deferred>;
  decodeGate?: ReturnType<typeof deferred>;
  decodes = 0; activeDecodes = 0; maxDecodes = 0;
  constructor() { Context.current = this; }
  createGain() { return new AudioNode(); }
  createDynamicsCompressor() { return new AudioNode(); }
  createStereoPanner() { return new AudioNode(); }
  createWaveShaper() { return new AudioNode(); }
  createBiquadFilter() { return new AudioNode(); }
  createBufferSource() { const node = new AudioNode(); this.sources.push(node); return node; }
  createMediaElementSource() { return new AudioNode(); }
  /** 外部音乐那一路。返回的节点记进 `lineSources`，测试可以断言「断开过」。 */
  createMediaStreamSource(stream: unknown) {
    const node = new AudioNode();
    // 真实的 MediaStreamAudioSourceNode 上有 .mediaStream，attachLineIn 靠它
    // 判断「这个 ended 是不是当前这条流的」——旧流断开时不该动新流。
    (node as AudioNode & { mediaStream?: unknown }).mediaStream = stream;
    this.lineSources.push(node);
    return node;
  }
  createAnalyser() { return Object.assign(new AudioNode(), { fftSize: 1024, getFloatTimeDomainData: (s: Float32Array) => s.fill(0.1) }); }
  async decodeAudioData() { this.decodes++; this.maxDecodes = Math.max(this.maxDecodes, ++this.activeDecodes); await this.decodeGate?.promise; this.activeDecodes--; return { length: 100, numberOfChannels: 2 }; }
  async resume() { await this.resumeGate?.promise; }
  async close() {}
}
export class Media extends EventTarget {
  static created: Media[] = [];
  paused = true; src = ''; currentTime = 0; duration = 60; deferMetadata = false; waiting = false;
  playGate?: ReturnType<typeof deferred>; playRequested = false;
  /**
   * 有没有一个还没落地的 play()。
   *
   * 只有「悬着的那一次」才会被 load() 打断。已经 resolved 的播放请求不受影响——
   * 浏览器里 load() 之后再 play() 是正常起播，不是 AbortError。
   */
  private pendingPlay = false;
  private interrupted = false;
  constructor() { super(); Media.created.push(this); }
  load() {
    if (!this.src) return;
    // 浏览器里 load() 会中止还没落地的播放请求。桩必须照做，
    // 否则「先 play() 再 load()」这种写法在测试里永远看不出问题。
    if (this.pendingPlay) this.interrupted = true;
    if (this.deferMetadata) this.waiting = true; else queueMicrotask(() => this.ready());
  }
  ready() { this.waiting = false; this.dispatchEvent(new Event('loadedmetadata')); }
  async play() {
    this.playRequested = true; this.pendingPlay = true;
    await this.playGate?.promise;
    this.pendingPlay = false;
    if (this.interrupted) {
      this.interrupted = false;
      const error = new Error('play interrupted by load');
      error.name = 'AbortError';
      throw error;
    }
    this.paused = false; this.dispatchEvent(new Event('play'));
  }
  pause() { if (this.paused) return; this.paused = true; this.dispatchEvent(new Event('pause')); }
  removeAttribute() { this.src = ''; }
}
export function installAudio(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const [name, value] of Object.entries({ AudioContext: Context, Audio: Media })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  Media.created = [];
}
export async function flushUntil(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
  if (!predicate()) throw new Error('async test precondition not reached');
}

/**
 * 一条能自己「被拔掉」的音频流。
 *
 * 真实场景是虚拟声卡驱动被卸载、或者 USB 声卡被拔走：这时 track 会自己派发
 * `ended`，而 `MediaStreamSource` 还连着、status.lineLive 还是 true——
 * 界面上那块「外部音乐」一直显示已接上，其实一点声都没有。
 * 桩要能重现这个事件，否则那条修正只能等用户来报。
 */
class FakeTrack extends EventTarget {
  /** 挂过几个 ended 监听。测试可以断言「确实挂上了」。 */
  ended = 0;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (type === 'ended') this.ended += 1;
    super.addEventListener(type, listener as EventListener, options);
  }
}

export class FakeStream {
  private tracks = [new FakeTrack()];

  getAudioTracks() { return this.tracks; }

  /** 模拟设备被拔掉：每条 track 派发 ended。 */
  unplug() {
    for (const track of this.tracks) track.dispatchEvent(new Event('ended'));
  }

  /** 挂上了几个 ended 监听；0 表示这段代码根本没在听设备断开。 */
  get listened() { return this.tracks.reduce((n, track) => n + track.ended, 0); }
}
