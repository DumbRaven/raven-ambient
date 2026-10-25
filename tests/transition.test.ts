import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AmbientEngine } from '../src/audio.ts';

/** 最小音频参数桩：够验证过渡编排的推量目标即可。 */
class Parameter {
  value = 0;
  threshold = 0; knee = 0; ratio = 0; attack = 0; release = 0;
  setTargetAtTime(value: number) { this.value = value; }
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
  cancelScheduledValues() {}
}
class Node2 {
  gain = new Parameter();
  threshold = new Parameter(); knee = new Parameter(); ratio = new Parameter(); attack = new Parameter(); release = new Parameter();
  next?: Node2;
  connect(node: Node2) { this.next = node; return node; }
  disconnect() { this.next = undefined; }
}
class Ctx {
  static current: Ctx;
  currentTime = 5;
  destination = new Node2();
  constructor() { Ctx.current = this; }
  createGain() { return new Node2(); }
  createDynamicsCompressor() { return new Node2(); }
  createAnalyser() { return Object.assign(new Node2(), { fftSize: 1024, getFloatTimeDomainData: (s: Float32Array) => s.fill(0.0001) }); }
  createMediaElementSource() { return new Node2(); }
  async resume() {} async close() {}
}
class Media extends EventTarget {
  static created: Media[] = [];
  src = ''; paused = true; currentTime = 0; duration = 10;
  constructor() { super(); Media.created.push(this); }
  async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  removeAttribute() { this.src = ''; }
  load() { queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
  get volume() { return 1; }
}

function setup(t: { mock: { method: (o: object, k: string, f: () => unknown) => void } }) {
  t.mock.method(globalThis, 'setInterval', () => 0);
  const prevCtx = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const prevAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Ctx });
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: Media });
  Media.created = [];
  return () => {
    if (prevCtx) Object.defineProperty(globalThis, 'AudioContext', prevCtx); else Reflect.deleteProperty(globalThis, 'AudioContext');
    if (prevAudio) Object.defineProperty(globalThis, 'Audio', prevAudio); else Reflect.deleteProperty(globalThis, 'Audio');
  };
}
/** 读引擎里两块唱盘的增益，用来断言推量目标 */
function deckGains(engine: AmbientEngine) {
  const decks = (engine as unknown as { decks: { gain: { gain: Parameter } }[] }).decks;
  const active = (engine as unknown as { activeDeck: number }).activeDeck;
  return { active: decks[active].gain.gain.value, other: decks[1 - active].gain.gain.value };
}

test('交叉淡化：新唱盘推满、旧唱盘归零，两块都装着不同的歌', async t => {
  const restore = setup(t);
  try {
    const engine = new AmbientEngine();
    await engine.loadMusic(new Blob(['a']));
    await engine.swapMusic(new Blob(['b']), 'crossfade', 1);
    const [first, second] = Media.created;
    assert.notEqual(first!.src, second!.src, '换歌换到了另一块唱盘');
    assert.ok(!second!.paused, '新的一首已经开始播放');
    const gains = deckGains(engine);
    assert.equal(gains.active, 1, '新唱盘推到满');
    assert.equal(gains.other, 0, '旧唱盘推到底');
    engine.dispose();
  } finally { restore(); }
});

test('淡出后淡入：同样以「旧的归零、新的推满」收尾', async t => {
  const restore = setup(t);
  try {
    const engine = new AmbientEngine();
    await engine.loadMusic(new Blob(['a']));
    await engine.swapMusic(new Blob(['b']), 'fade', 1);
    const gains = deckGains(engine);
    assert.equal(gains.active, 1);
    assert.equal(gains.other, 0);
    engine.dispose();
  } finally { restore(); }
});

test('直接切换：跳过推量，旧唱盘立刻停下', async t => {
  const restore = setup(t);
  try {
    const engine = new AmbientEngine();
    await engine.loadMusic(new Blob(['a']));
    const [first] = Media.created;
    await engine.swapMusic(new Blob(['b']), 'off', 1);
    assert.equal(deckGains(engine).active, 1);
    // off 模式下旧唱盘在 20ms 后被停，这里等一个宏任务再确认
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.ok(first!.paused, '旧唱盘被停下');
    engine.dispose();
  } finally { restore(); }
});
