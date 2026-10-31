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
