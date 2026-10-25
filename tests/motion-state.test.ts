import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialogTiming, MotionSequence, pageTiming } from '../src/motion-state.ts';

function fixture<T>(initial: T, timing = dialogTiming) {
  const tasks: { at: number; callback: () => void; cancelled: boolean }[] = [];
  let now = 0;
  const sequence = new MotionSequence(initial, timing, () => {}, (callback, delay) => {
    const task = { at: now + delay, callback, cancelled: false }; tasks.push(task);
    return () => { task.cancelled = true; };
  });
  return { sequence, tasks, advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const task = tasks.filter(t => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!task) break;
      now = task.at; task.cancelled = true; task.callback();
    }
    now = end;
  } };
}
test('弹窗关闭前保留内容，退场结束才释放', () => {
  const { sequence: s, advance } = fixture<string | null>(null);
  s.request('settings', false); assert.equal(s.state.phase, 'enter');
  advance(240); assert.equal(s.state.phase, 'idle');
  s.request(null, false); assert.equal(s.state.value, 'settings');
  advance(159); assert.equal(s.state.value, 'settings');
  advance(1); assert.equal(s.state.value, null); assert.equal(s.state.phase, 'idle');
});
test('关闭未结束又打开，过期回调不能关掉新窗口', () => {
  const { sequence: s, advance, tasks } = fixture<string | null>('settings');
  s.request(null, false); const stale = tasks.at(-1)!;
  advance(60); s.request('settings', false); stale.callback();
  advance(300); assert.equal(s.state.value, 'settings'); assert.equal(s.state.phase, 'idle');
});
test('快速切页只进入最后一个目标，方向保留', () => {
  const { sequence: s, advance } = fixture('cabinet', pageTiming);
  s.request('listening', false, 1); advance(30); s.request('focus', false, 1);
  // 退场还没走完，画面上仍是旧页面；这里只关心「不会先跳去 listening」
  advance(pageTiming.exit - 1); assert.equal(s.state.value, 'cabinet');
  advance(1); assert.equal(s.state.value, 'focus'); assert.equal(s.state.phase, 'enter');
  advance(pageTiming.enter); assert.equal(s.state.phase, 'idle');
  s.request('cabinet', false, -1); advance(pageTiming.exit); assert.equal(s.state.direction, -1);
});
test('退场期间返回原页，不会随后跳进已放弃的页面', () => {
  const { sequence: s, advance } = fixture('cabinet', pageTiming);
  s.request('focus', false); advance(35); s.request('cabinet', false);
  advance(pageTiming.exit + pageTiming.enter); assert.equal(s.state.value, 'cabinet'); assert.equal(s.state.phase, 'idle');
});
test('减少动画设置即时生效，包含正在退场的弹窗', () => {
  const { sequence: s, advance } = fixture<string | null>('settings');
  s.request(null, false); advance(40); s.request(null, true);
  assert.equal(s.state.value, null); assert.equal(s.state.phase, 'idle');
  s.request('guide', true); advance(300); assert.equal(s.state.value, 'guide'); assert.equal(s.state.phase, 'idle');
});
test('卸载取消后，已排队的回调不能再改变状态', () => {
  const { sequence: s, tasks } = fixture('cabinet', pageTiming);
  s.request('focus', false); const stale = tasks.at(-1)!; s.cancel(); stale.callback();
  assert.equal(s.state.value, 'cabinet');
});
