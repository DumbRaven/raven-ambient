import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clock,
  dayKey,
  defaultFocusSettings,
  elapsedFraction,
  focusMinutes,
  focusStats,
  initialFocusState,
  pauseFocus,
  phaseMs,
  resetFocus,
  sanitizeFocusHistory,
  sanitizeFocusSettings,
  skipFocus,
  startFocus,
  tickFocus,
} from '../src/focus.ts';

const MINUTE = 60_000;
const T0 = new Date(2026, 4, 20, 9, 0, 0).getTime();

test('clock 用 m:ss 显示，倒计时向上取整', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(999), '0:01');
  assert.equal(clock(1500), '0:02');
  assert.equal(clock(25 * MINUTE), '25:00');
  assert.equal(clock(-5), '0:00');
});

test('phaseMs 按阶段取时长', () => {
  const settings = { ...defaultFocusSettings, focusMinutes: 30, shortBreakMinutes: 6, longBreakMinutes: 20 };
  assert.equal(focusMinutes(settings, 'focus'), 30);
  assert.equal(focusMinutes(settings, 'break'), 6);
  assert.equal(phaseMs(settings, 'longBreak'), 20 * MINUTE);
});

test('专注结束进入小憩并记录一次番茄', () => {
  const settings = defaultFocusSettings;
  const state = startFocus(initialFocusState(settings), settings, T0);
  assert.equal(tickFocus(state, settings, T0 + 25 * MINUTE - 1).finished, undefined);
  const done = tickFocus(state, settings, T0 + 25 * MINUTE);
  assert.equal(done.finished?.phase, 'focus');
  assert.deepEqual(done.finished?.record, { at: T0 + 25 * MINUTE, minutes: 25 });
  assert.equal(done.state.phase, 'break');
  assert.equal(done.state.rounds, 1);
  assert.equal(done.state.running, false);
  assert.equal(done.state.remainingMs, 5 * MINUTE);
});

test('第四轮专注后进入长休息，长休息结束清零轮次', () => {
  const settings = { ...defaultFocusSettings, roundsBeforeLong: 4 };
  let state = initialFocusState(settings);
  let now = T0;
  for (let round = 1; round <= 4; round += 1) {
    state = startFocus(state, settings, now);
    now += 25 * MINUTE;
    state = tickFocus(state, settings, now).state;
    assert.equal(state.rounds, round);
    if (round < 4) {
      assert.equal(state.phase, 'break');
      state = startFocus(state, settings, now);
      now += 5 * MINUTE;
      state = tickFocus(state, settings, now).state;
      assert.equal(state.phase, 'focus');
    }
  }
  assert.equal(state.phase, 'longBreak');
  assert.equal(state.remainingMs, 15 * MINUTE);
  state = startFocus(state, settings, now);
  now += 15 * MINUTE;
  state = tickFocus(state, settings, now).state;
  assert.equal(state.phase, 'focus');
  assert.equal(state.rounds, 0);
});

test('暂停保留剩余时间，继续后从原地走', () => {
  const settings = defaultFocusSettings;
  const running = startFocus(initialFocusState(settings), settings, T0);
  const paused = pauseFocus(running, T0 + 10 * MINUTE);
  assert.equal(paused.running, false);
  assert.equal(paused.remainingMs, 15 * MINUTE);
  const resumed = startFocus(paused, settings, T0 + 60 * MINUTE);
  assert.equal(resumed.running, true);
  assert.equal(resumed.endAt, T0 + 75 * MINUTE);
});

test('重置回到整段时长', () => {
  const settings = defaultFocusSettings;
  const running = startFocus(initialFocusState(settings), settings, T0);
  const reset = resetFocus(pauseFocus(running, T0 + MINUTE), settings);
  assert.equal(reset.remainingMs, 25 * MINUTE);
  assert.equal(reset.running, false);
});

test('跳过阶段会推进轮次但不产生记录', () => {
  const settings = defaultFocusSettings;
  const skipped = skipFocus(startFocus(initialFocusState(settings), settings, T0), settings);
  assert.equal(skipped.phase, 'break');
  assert.equal(skipped.rounds, 1);
  assert.equal(skipped.running, false);
  const back = skipFocus(skipped, settings);
  assert.equal(back.phase, 'focus');
  assert.equal(back.rounds, 1);
});

test('设置清洗：非法值回落、范围收敛、提示音默认开', () => {
  assert.deepEqual(sanitizeFocusSettings(null), defaultFocusSettings);
  const fixed = sanitizeFocusSettings({
    focusMinutes: 500,
    shortBreakMinutes: 0,
    longBreakMinutes: -3,
    roundsBeforeLong: 99,
    chime: false,
  });
  assert.equal(fixed.focusMinutes, 180);
  assert.equal(fixed.shortBreakMinutes, 1);
  assert.equal(fixed.longBreakMinutes, 1);
  assert.equal(fixed.roundsBeforeLong, 12);
  assert.equal(fixed.chime, false);
  assert.equal(sanitizeFocusSettings({}).chime, true);
});

test('历史清洗丢掉坏数据并保留最近 500 条', () => {
  assert.deepEqual(sanitizeFocusHistory('x'), []);
  const list: { at: number; minutes: number }[] = Array.from({ length: 600 }, (_, i) => ({ at: T0 + i, minutes: 25 }));
  list.push({ at: Number.NaN, minutes: 25 });
  list.push({ at: T0, minutes: 0 });
  const clean = sanitizeFocusHistory(list);
  assert.equal(clean.length, 500);
  assert.equal(clean[0].at, T0 + 100);
});

test('今日统计只算本地当天', () => {
  const records = [
    { at: T0, minutes: 25 },
    { at: T0 + 2 * 60 * MINUTE, minutes: 25 },
    { at: T0 - 24 * 60 * MINUTE, minutes: 25 },
  ];
  const stats = focusStats(records, T0 + 3 * 60 * MINUTE);
  assert.equal(stats.todayCount, 2);
  assert.equal(stats.todayMinutes, 50);
  assert.equal(stats.totalCount, 3);
  assert.equal(stats.totalMinutes, 75);
});

test('dayKey 用本地日期', () => {
  assert.equal(dayKey(T0), '2026-5-20');
});

test('进度环在运行与暂停时保持同一进度', () => {
  const settings = defaultFocusSettings;
  const state = startFocus(initialFocusState(settings), settings, T0);
  assert.equal(elapsedFraction(state, settings, T0), 0);
  assert.equal(elapsedFraction(state, settings, T0 + 25 * MINUTE), 1);
  assert.ok(Math.abs(elapsedFraction(state, settings, T0 + 10 * MINUTE) - 0.4) < 1e-9);
  const paused = pauseFocus(state, T0 + 10 * MINUTE);
  assert.ok(Math.abs(elapsedFraction(paused, settings, T0 + 10 * MINUTE) - 0.4) < 1e-9);
});
