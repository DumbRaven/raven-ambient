/**
 * `src/desktop-bridge.ts` 里那几个纯逻辑。
 *
 * 只测能在 Node 里跑的部分：这里没有 window，所以跑的是抽出来的 `drainCommands`。
 * 通道本身（主进程每 200ms 搬一次）在 tools/probe/desktop-stage.cjs 里实机验。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainCommands, type StageCommand } from '../src/desktop-bridge.ts';

type Host = { __ravenDesktopQueue?: StageCommand[] };

test('取走攒下的动作，顺序不变', () => {
  const host: Host = { __ravenDesktopQueue: [{ type: 'stone' }, { type: 'next' }] };
  assert.deepEqual(drainCommands(host), [{ type: 'stone' }, { type: 'next' }]);
});

test('取走之后队列是空的，再取一次什么都没有', () => {
  const host: Host = { __ravenDesktopQueue: [{ type: 'prev' }] };
  drainCommands(host);
  assert.deepEqual(drainCommands(host), []);
});

test('一条动作都没有时返回空数组，不是 undefined', () => {
  assert.deepEqual(drainCommands({}), []);
});

test('取走的是原来的那一整条，不是拷一半', () => {
  // 这条守的是「换新数组而不是原地清空」：原地 splice 会把要返回的东西一起清掉。
  const host: Host = {};
  const queued: StageCommand[] = [{ type: 'next' }];
  host.__ravenDesktopQueue = queued;
  const taken = drainCommands(host);
  assert.deepEqual(taken, [{ type: 'next' }]);
  assert.notEqual(host.__ravenDesktopQueue, taken);
});

test('取走期间新压进来的动作留在新队列里', () => {
  const host: Host = { __ravenDesktopQueue: [{ type: 'next' }] };
  const taken = drainCommands(host);
  // 模拟主进程那边刚取完、用户又点了一下
  host.__ravenDesktopQueue = [...(host.__ravenDesktopQueue ?? []), { type: 'prev' }];
  assert.deepEqual(taken, [{ type: 'next' }]);
  assert.deepEqual(drainCommands(host), [{ type: 'prev' }]);
});

test('图层与雨滴这两条带值的动作原样带过去', () => {
  const layers = [
    { id: 'clock' as const, spot: { x: 0.4, y: 0.2 }, scale: 1 },
    { id: 'title' as const, spot: { x: 0.4, y: 0.5 }, scale: 1.2 },
  ];
  const host: Host = { __ravenDesktopQueue: [{ type: 'layers', value: layers }] };
  const [command] = drainCommands(host);
  assert.equal(command.type, 'layers');
  assert.deepEqual('value' in command ? command.value : null, layers);
});
