import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AmbientEngine } from '../src/audio.ts';
import { defaultMix } from '../src/model.ts';

/**
 * 关心的是三条链路的相对响度：外部音乐、本地音乐、环境音。
 * 这里不跑真实音频，只把增益链上的系数读出来——
 * 之前外部音乐满幅直连 master，比本地音乐响一倍，环境音被压得几乎听不见。
 */
class Parameter {
  value = 1;
  setTargetAtTime(value: number, _now: number, _smoothing: number) { this.value = value; }
  setValueAtTime(value: number, _at: number) { this.value = value; }
  linearRampToValueAtTime(value: number, _at: number) { this.value = value; }
  cancelScheduledValues(_at: number) {}
}
class NodeStub {
  gain = new Parameter(); pan = new Parameter(); frequency = new Parameter(); Q = new Parameter();
  threshold = new Parameter(); knee = new Parameter(); ratio = new Parameter(); attack = new Parameter(); release = new Parameter();
  next?: NodeStub;
  connect(node: NodeStub) { this.next = node; return node; }
  disconnect() { this.next = undefined; }
  start() {} stop() {}
}
class ContextStub {
  static current: ContextStub;
  currentTime = 1; destination = new NodeStub(); sources: NodeStub[] = [];
  rms = 0.1;
  constructor() { ContextStub.current = this; }
  createGain() { return new NodeStub(); }
  createDynamicsCompressor() { return new NodeStub(); }
  createBiquadFilter() { return new NodeStub(); }
  createStereoPanner() { return new NodeStub(); }
  createWaveShaper() { return new NodeStub(); }
  createMediaElementSource() { return new NodeStub(); }
  createBufferSource() { const source = new NodeStub(); this.sources.push(source); return source; }
  createAnalyser() { return Object.assign(new NodeStub(), { fftSize: 1024, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(this.rms) }); }
  async resume() {} async close() {}
}
class MediaStub extends EventTarget {
  duration = 10; currentTime = 0;
  async play() { this.dispatchEvent(new Event('play')); }
  pause() { this.dispatchEvent(new Event('pause')); }
  removeAttribute() {} load() {}
}

async function withEngine(run: (engine: AmbientEngine, ctx: ContextStub) => Promise<void> | void) {
  const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: ContextStub });
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: MediaStub });
  const engine = new AmbientEngine();
  try {
    await run(engine, ContextStub.current ?? (undefined as never));
  } finally {
    engine.dispose();
    if (previousContext) Object.defineProperty(globalThis, 'AudioContext', previousContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
    if (previousAudio) Object.defineProperty(globalThis, 'Audio', previousAudio); else Reflect.deleteProperty(globalThis, 'Audio');
  }
}

const run = (engine: AmbientEngine) => engine as unknown as {
  init(): void; master: NodeStub; musicGain: NodeStub; lineGain: NodeStub; ambient: NodeStub;
  voices: Map<string, { gain: NodeStub }>;
};

test('外部音乐和本地音乐吃同一档「音乐总音量」，不再是满幅直通', async t => {
  t.mock.method(globalThis, 'setInterval', () => 0 as unknown as ReturnType<typeof setInterval>);
  await withEngine(engine => {
    const inner = run(engine);
    inner.init();
    const mix = {
      ...defaultMix,
      master: 80, musicVolume: 50, lineVolume: 100,
      tracks: defaultMix.tracks.slice(0, 1).map(track => ({ ...track, enabled: true, volume: 60 })),
    };
    for (const track of mix.tracks) engine.cacheBuffer(track.id, {} as AudioBuffer);
    engine.setMix(mix);

    // 音乐总音量 50%：本地与外部两条线必须落在同一个值上
    assert.equal(inner.musicGain.gain.value, 0.5);
    assert.equal(inner.lineGain.gain.value, 0.5);

    // 外部音乐那档微调是个附加系数，不是另一把尺子
    engine.setMix({ ...mix, lineVolume: 60 });
    assert.equal(inner.lineGain.gain.value, 0.3);
    // 调外部那档不影响本地音乐
    assert.equal(inner.musicGain.gain.value, 0.5);
  });
});

test('环境音的基础系数抬到 0.55，避免被音乐盖死', async t => {
  t.mock.method(globalThis, 'setInterval', () => 0 as unknown as ReturnType<typeof setInterval>);
  await withEngine(async engine => {
    const mix = {
      ...defaultMix,
      tracks: defaultMix.tracks.slice(0, 1).map(track => ({ ...track, enabled: true, volume: 60, duckDepth: 0 })),
    };
    for (const track of mix.tracks) engine.cacheBuffer(track.id, {} as AudioBuffer);
    await engine.start(mix);
    engine.setMix(mix);
    const voice = run(engine).voices.get(mix.tracks[0].id)!;
    // 音量 60% × 基础系数 0.55 = 0.33；旧值 0.45 会得到 0.27
    assert.ok(Math.abs(voice.gain.gain.value - 0.33) < 1e-6, `实际 ${voice.gain.gain.value}`);
  });
});

test('环境音可以推到 200%，音乐唱片不会跟着放宽', async t => {
  t.mock.method(globalThis, 'setInterval', () => 0 as unknown as ReturnType<typeof setInterval>);
  await withEngine(async engine => {
    const mix = {
      ...defaultMix,
      tracks: defaultMix.tracks.slice(0, 1).map(track => ({ ...track, enabled: true, volume: 200, duckDepth: 0 })),
    };
    for (const track of mix.tracks) engine.cacheBuffer(track.id, {} as AudioBuffer);
    await engine.start(mix);
    engine.setMix(mix);
    const voice = run(engine).voices.get(mix.tracks[0].id)!;
    // 200% × 0.55 = 1.10，单路允许略微超过满幅；限幅器会在总线上兜底
    assert.ok(Math.abs(voice.gain.gain.value - 1.1) < 1e-6, `实际 ${voice.gain.gain.value}`);
  });
});

test('三路以内不做叠加补偿，四路起按 sqrt(3/路数) 折回', async t => {
  t.mock.method(globalThis, 'setInterval', () => 0 as unknown as ReturnType<typeof setInterval>);
  await withEngine(async engine => {
    // defaultMix 只带三路，第四路由第一条复制出来
    const base = defaultMix.tracks.slice(0, 3).map(track => ({ ...track, enabled: true, volume: 100, duckDepth: 0 }));
    const tracks = [...base, { ...base[0], id: 'extra' }];
    const mix = { ...defaultMix, tracks };
    for (const track of tracks) engine.cacheBuffer(track.id, {} as AudioBuffer);
    await engine.start(mix);
    engine.setMix(mix);
    const voices = () => run(engine).voices;
    assert.equal(voices().size, 4, '四路都应该建出声部');

    // 四路全 100%：100% × 0.55 × sqrt(3/4) = 0.476
    for (const track of tracks) {
      const gain = voices().get(track.id)!.gain.gain.value;
      assert.ok(Math.abs(gain - 0.476) < 1e-3, `四路时 ${track.id} 实际 ${gain}`);
    }

    // 只剩两路在响：补偿应该撤销，回到 100% × 0.55
    const quieter = tracks.map((track, i) => ({ ...track, enabled: i < 2 }));
    engine.setMix({ ...mix, tracks: quieter });
    for (const track of quieter.filter(item => item.enabled)) {
      const gain = voices().get(track.id)!.gain.gain.value;
      assert.ok(Math.abs(gain - 0.55) < 1e-3, `两路时 ${track.id} 实际 ${gain}`);
    }
  });
});
