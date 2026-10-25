import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AmbientEngine } from '../src/audio.ts';
import { defaultMix } from '../src/model.ts';
import { dbToGain } from '../src/ducking.ts';

class Parameter {
  value = 1;
  smoothing = 0;
  /** 记录最后一次线性推量，用来验证交叉淡化/淡出淡入的编排 */
  ramp?: { from: number; to: number; at: number };
  setTargetAtTime(value: number, _now: number, smoothing: number) { this.value = value; this.smoothing = smoothing; }
  setValueAtTime(value: number, _at: number) { this.value = value; }
  linearRampToValueAtTime(value: number, at: number) { this.ramp = { from: this.value, to: value, at }; this.value = value; }
  cancelScheduledValues(_at: number) { this.ramp = undefined; }
}
class AudioNodeStub {
  gain = new Parameter(); pan = new Parameter(); frequency = new Parameter(); Q = new Parameter();
  threshold = new Parameter(); knee = new Parameter(); ratio = new Parameter(); attack = new Parameter(); release = new Parameter();
  next?: AudioNodeStub;
  connect(node: AudioNodeStub) { this.next = node; return node; }
  disconnect() { this.next = undefined; }
  start() {} stop() {}
}
class ContextStub {
  static current: ContextStub;
  currentTime = 1; destination = new AudioNodeStub(); sources: AudioNodeStub[] = [];
  rms = 0.1;
  constructor() { ContextStub.current = this; }
  createGain() { return new AudioNodeStub(); }
  createDynamicsCompressor() { return new AudioNodeStub(); }
  createBiquadFilter() { return new AudioNodeStub(); }
  createStereoPanner() { return new AudioNodeStub(); }
  createWaveShaper() { return new AudioNodeStub(); }
  createMediaElementSource() { return new AudioNodeStub(); }
  createBufferSource() { const source = new AudioNodeStub(); this.sources.push(source); return source; }
  createAnalyser() { return Object.assign(new AudioNodeStub(), { fftSize: 1024, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(this.rms) }); }
  async resume() {} async close() {}
}
class MediaStub extends EventTarget {
  duration = 10; currentTime = 0;
  async play() { this.dispatchEvent(new Event('play')); }
  pause() { this.dispatchEvent(new Event('pause')); }
  removeAttribute() {} load() {}
}

/** 手动推进播放器的内部节拍，并把时钟往前拨，模拟真实的 80ms 心跳。 */
function beat(engine: AmbientEngine, ctx: ContextStub, times = 1, step = 0.08) {
  for (let i = 0; i < times; i++) {
    ctx.currentTime += step;
    (engine as unknown as { tick: () => void }).tick();
  }
}

test('每个声部按自己的深度和封面手感独立避让，且不会碰共享总线', async t => {
  t.mock.method(globalThis, 'setInterval', () => 0 as unknown as ReturnType<typeof setInterval>);
  const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: ContextStub });
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: MediaStub });
  const engine = new AmbientEngine();
  try {
    // 第一张：9 dB、雨（跟得紧）；第二张：0 dB，也就是不避让
    const mix = {
      ...defaultMix,
      tracks: defaultMix.tracks.slice(0, 2).map((track, i) => ({
        ...track, enabled: true, duckDepth: i ? 0 : 9, coverId: i ? 'forest' : 'rain',
      })),
    };
    for (const track of mix.tracks) engine.cacheBuffer(track.id, {} as AudioBuffer);
    await engine.start(mix);
    const ctx = ContextStub.current;
    // 声部链路：source → filter → pan → gain → clip → duck → ambient
    // clip 是每路自己的软限幅器（响应上传素材的响度落差），不参与避让，所以跳过它再取 duck。
    const voices = ctx.sources.map(source => ({
      volume: source.next!.next!.next!,
      duck: source.next!.next!.next!.next!.next!,
    }));
    assert.equal(voices.length, 2);

    await engine.playMusic();
    // 起手时刚开始淡入，远没压到底
    assert.ok(voices[0].duck.gain.value > 0.9, `起手 ${voices[0].duck.gain.value} 应该接近 1`);

    // 跑够雨声的淡入时长（0.7s），第一张应该压到 −9 dB 附近
    beat(engine, ctx, 12);
    assert.ok(Math.abs(voices[0].duck.gain.value - dbToGain(9)) < 0.02, `实际 ${voices[0].duck.gain.value}`);
    // 第二张深度为 0，一点不动
    assert.equal(voices[1].duck.gain.value, 1);
    // 两条声部接的是同一个环境音总线，避让只作用在各自的 duck 节点上
    assert.equal(voices[0].duck.next, voices[1].duck.next);
    assert.equal(voices[0].duck.next!.gain.value, 1, '共享总线不能被压低');

    // 实时把第一张改成 18 dB，下一拍按新深度走
    engine.setMix({ ...mix, tracks: mix.tracks.map((track, i) => ({ ...track, duckDepth: i ? 0 : 18 })) });
    beat(engine, ctx, 20);
    assert.ok(Math.abs(voices[0].duck.gain.value - dbToGain(18)) < 0.02, `实际 ${voices[0].duck.gain.value}`);

    // 关掉自动避让：保持期过后放开
    engine.setMix({ ...mix, ducking: false });
    beat(engine, ctx, 60);
    assert.equal(voices[0].duck.gain.value, 1);

    // 移走声部，节点断开
    engine.forget(mix.tracks[0].id);
    assert.equal(voices[0].duck.next, undefined);
  } finally {
    engine.dispose();
    if (previousContext) Object.defineProperty(globalThis, 'AudioContext', previousContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
    if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio); else Reflect.deleteProperty(globalThis, 'Audio');
  }
});

test('封面类型决定手感：同一拍里慢声部压得比快声部少', async t => {
  t.mock.method(globalThis, 'setInterval', () => 0 as unknown as ReturnType<typeof setInterval>);
  const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: ContextStub });
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: MediaStub });
  const engine = new AmbientEngine();
  try {
    const mix = {
      ...defaultMix,
      tracks: defaultMix.tracks.slice(0, 2).map((track, i) => ({
        ...track, enabled: true, duckDepth: 9, coverId: i ? 'forest' : 'keyboard',
      })),
    };
    for (const track of mix.tracks) engine.cacheBuffer(track.id, {} as AudioBuffer);
    await engine.start(mix);
    const ctx = ContextStub.current;
    const voices = ctx.sources.map(source => ({ duck: source.next!.next!.next!.next!.next! }));
    await engine.playMusic();
    beat(engine, ctx, 5); // 0.4s
    // 键盘声几乎立刻让位，森林还在慢慢退
    assert.ok(voices[0].duck.gain.value < voices[1].duck.gain.value,
      `键盘 ${voices[0].duck.gain.value} 应该比森林 ${voices[1].duck.gain.value} 压得更低`);
  } finally {
    engine.dispose();
    if (previousContext) Object.defineProperty(globalThis, 'AudioContext', previousContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
    if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio); else Reflect.deleteProperty(globalThis, 'Audio');
  }
});
