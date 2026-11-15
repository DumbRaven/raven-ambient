import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAudio, Context, FakeStream } from './helpers/audio-stubs.ts';
import { AmbientEngine } from '../src/audio.ts';

// 外部音乐（虚拟声卡）那一路上，有两个只有真机能碰到的失效场景。
// 它们不会让程序崩，只会让界面一直说谎——所以特别需要用测试钉住。

test('设备被拔掉之后，不再显示「外部音乐已接上」', async t => {
  installAudio(t);
  const engine = new AmbientEngine();
  t.after(() => engine.dispose());
  let status = { lineLive: false } as { lineLive: boolean };
  engine.subscribe(next => { status = next; });

  const stream = new FakeStream();
  engine.attachLineIn(stream as unknown as MediaStream);
  assert.equal(stream.listened, 1, '必须真的监听 track 的 ended，否则拔设备没人知道');
  assert.equal(status.lineLive, true);

  stream.unplug();
  // detachLineIn 里会强制 emit 一次（tick 的 200ms 节流可能把这次吞掉）
  assert.equal(status.lineLive, false, '拔了之后还显示已接上，用户会一直以为声音该有');
  assert.equal(Context.current.lineSources.length, 1);
});

test('换一条新流之后，旧流自己结束不会把新流掐掉', async t => {
  installAudio(t);
  const engine = new AmbientEngine();
  t.after(() => engine.dispose());
  let status = { lineLive: false } as { lineLive: boolean };
  engine.subscribe(next => { status = next; });

  const first = new FakeStream();
  const second = new FakeStream();
  engine.attachLineIn(first as unknown as MediaStream);
  engine.attachLineIn(second as unknown as MediaStream);
  assert.equal(status.lineLive, true);

  // 旧设备姗姗来迟地报了个 ended。这时候用户已经换了新设备，
  // 不能因为旧流结束就把正在用的这一路也断开。
  first.unplug();
  assert.equal(status.lineLive, true, '旧流的 ended 不该动新流');

  second.unplug();
  assert.equal(status.lineLive, false);
});
