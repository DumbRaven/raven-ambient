import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterResize, canToggle, RESIZE_TIMEOUT, TOGGLE_COOLDOWN, type WaitDeps } from '../src/fullscreen-timing.ts';

// 一个能手动推帧的假环境：尺寸表由测试自己改，帧要手动 flush。
function harness(sizes: { width: number; height: number }[], startAt = 0) {
  let clock = startAt;
  let at = 0;
  const frames: (() => void)[] = [];
  const cancelled = new Set<number>();
  let nextHandle = 1;
  const deps: WaitDeps = {
    size: () => sizes[Math.min(at, sizes.length - 1)],
    frame: run => {
      const handle = nextHandle++;
      frames.push(() => { if (!cancelled.has(handle)) run(); });
      return handle;
    },
    cancel: handle => { cancelled.add(handle); },
    now: () => clock,
  };
  return {
    deps,
    /** 推进到第 n 个尺寸，并 flush 当前排队的那一帧。 */
    step(n: number, ms = 16) {
      at = n;
      clock += ms;
      const run = frames.shift();
      run?.();
    },
    get pending() { return frames.length; },
  };
}

test('窗口尺寸一变就立刻执行，不等满超时', () => {
  const env = harness([{ width: 1906, height: 1017 }, { width: 2560, height: 1414 }]);
  let ran = 0;
  afterResize(env.deps, () => { ran += 1; });
  assert.equal(ran, 0, '第一帧还没到，不能提前执行');

  env.step(0);
  assert.equal(ran, 0, '尺寸没变，继续等');

  env.step(1);
  assert.equal(ran, 1, '尺寸变了就执行');
});

test('尺寸一直不变时，超时兜底仍然执行——不能让点击没有下文', () => {
  const env = harness([{ width: 1906, height: 1017 }]);
  let ran = 0;
  afterResize(env.deps, () => { ran += 1; });

  // 一帧一帧推到超过上限。每帧 16ms，所以帧数要够。
  const frames = Math.ceil(RESIZE_TIMEOUT / 16) + 2;
  for (let i = 0; i < frames; i += 1) env.step(0);

  assert.equal(ran, 1, '超时后必须执行一次');
});

test('超时只执行一次，不会因为还在排队而重复', () => {
  const env = harness([{ width: 1906, height: 1017 }]);
  let ran = 0;
  afterResize(env.deps, () => { ran += 1; });

  const frames = Math.ceil(RESIZE_TIMEOUT / 16) + 2;
  for (let i = 0; i < frames; i += 1) env.step(0);
  env.step(1);

  assert.equal(ran, 1, '执行过就不再执行，哪怕尺寸随后又变了');
});

test('取消之后绝不再执行——连点两次时前一次的回调必须作废', () => {
  const env = harness([{ width: 1906, height: 1017 }, { width: 2560, height: 1414 }]);
  let first = 0;
  let second = 0;

  const cancelFirst = afterResize(env.deps, () => { first += 1; });
  cancelFirst();
  afterResize(env.deps, () => { second += 1; });

  // 队列里此时有两帧：被取消那个留下的空壳，和第二次排的那一帧。
  // 两帧都推过去，才能证明「取消的确实没跑、后面的确实跑了」。
  env.step(1);
  env.step(1);

  assert.equal(first, 0, '被取消的那次不能执行，否则会各自铺满一次');
  assert.equal(second, 1, '后一次照常执行');
});

test('进入和退出都走同一条路：先窗口、后页面', () => {
  // 进入：视口从小变大。
  const enter = harness([{ width: 1906, height: 1017 }, { width: 2560, height: 1414 }]);
  const order: string[] = [];
  order.push('window');
  afterResize(enter.deps, () => order.push('page'));
  enter.step(1);
  assert.deepEqual(order, ['window', 'page'], '进入时窗口先变，页面后铺满');

  // 退出：视口从大变小。
  const leave = harness([{ width: 2560, height: 1440 }, { width: 1906, height: 1043 }]);
  const undo: string[] = [];
  undo.push('window');
  afterResize(leave.deps, () => undo.push('page'));
  leave.step(1);
  assert.deepEqual(undo, ['window', 'page'], '退出时窗口先缩，页面后撤回');
});

test('只变宽或只变高也算窗口动了', () => {
  const onlyWide = harness([{ width: 1906, height: 1017 }, { width: 2560, height: 1017 }]);
  let a = 0;
  afterResize(onlyWide.deps, () => { a += 1; });
  onlyWide.step(1);
  assert.equal(a, 1);

  const onlyTall = harness([{ width: 1906, height: 1017 }, { width: 1906, height: 1440 }]);
  let b = 0;
  afterResize(onlyTall.deps, () => { b += 1; });
  onlyTall.step(1);
  assert.equal(b, 1);
});

test('冷却期内连点被挡，过了冷却就放行', () => {
  const start = 1000;
  assert.equal(canToggle(start, start + 10), false, '10ms 后连点要挡');
  assert.equal(canToggle(start, start + TOGGLE_COOLDOWN - 1), false, '差 1ms 也要挡');
  assert.equal(canToggle(start, start + TOGGLE_COOLDOWN), true, '到点就放行');
  assert.equal(canToggle(start, start + TOGGLE_COOLDOWN + 500), true, '隔久了当然放行');
});

test('第一次点击不被冷却挡住', () => {
  // lastAt 的初值是 -Infinity（从没点过），而 performance.now() 在页面刚起来时
  // 完全可能是 0，所以不能拿 0 当「没点过」的哨兵值——那样第一次点击会被挡。
  assert.equal(canToggle(-Infinity, 0), true);
  assert.equal(canToggle(-Infinity, 5), true);
});
