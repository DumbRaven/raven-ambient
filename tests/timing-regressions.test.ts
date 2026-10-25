import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DuckEnvelope, duckProfile } from '../src/ducking.ts';
import { initialFocusState, defaultFocusSettings, startFocus, pauseFocus, tickFocus, elapsedFraction, applyFocusSettings, focusDuration, resetFocus, remainingFocus, MINUTE } from '../src/focus.ts';

test('森林先等待 0.45 秒再压低；重复时间戳和倒退时钟不推进包络', () => {
  const env = new DuckEnvelope(), profile = duckProfile('forest', 9);
  assert.equal(profile.attackDelay, 0.45);
  assert.equal(env.step(0.5, 0, true, true, profile), 0);
  assert.equal(env.step(0.5, 0.4, true, true, profile), 0);
  assert.equal(env.step(0.5, 0.45, true, true, profile), 0);
  const value = env.step(0.5, 0.6, true, true, profile);
  assert.ok(Math.abs(value - 0.15 / profile.attackTime) < 1e-9);
  assert.equal(env.step(0.5, 0.6, true, true, profile), value);
  assert.equal(env.step(0.5, 0.3, true, true, profile), value);
  assert.equal(env.step(0.5, NaN, true, true, profile), value);
});
test('不足等待时长的音乐脉冲不会压低环境音，下一次重新等待', () => {
  const env = new DuckEnvelope(), profile = duckProfile('forest', 9);
  env.step(0.5, 0, true, true, profile); env.step(0, 0.2, false, true, profile);
  assert.equal(env.step(0, 1, false, true, profile), 0);
  env.step(0.5, 2, true, true, profile);
  assert.equal(env.step(0.5, 2.4, true, true, profile), 0);
  assert.ok(env.step(0.5, 2.6, true, true, profile) > 0);
});
test('不同采样频率在相同实际时刻得到相同避让量，长间隔也按实际时间恢复', () => {
  const profile = duckProfile('rain', 9);
  function run(times: number[]) {
    const env = new DuckEnvelope(); env.step(0.5, 0, true, true, profile);
    for (const time of times) env.step(0.5, time, true, true, profile);
    return env;
  }
  const fine = run(Array.from({ length: 10 }, (_, i) => (i + 1) / 20));
  const sparse = run([0.2, 0.5]); assert.ok(Math.abs(fine.value - sparse.value) < 1e-9);
  sparse.step(0.5, 5, true, true, profile); assert.equal(sparse.value, 1);
  sparse.step(0, 5, false, true, profile);
  assert.equal(sparse.step(0, 5 + profile.holdTime, false, true, profile), 1);
  const half = sparse.step(0, 5 + profile.holdTime + profile.releaseTime / 2, false, true, profile);
  assert.ok(Math.abs(half - 0.5) < 1e-9);
  assert.equal(sparse.step(0, 100, false, true, profile), 0);
});
test('开始后改成 45 分钟，本轮仍按 25 分钟显示、结束和入账', () => {
  const original = defaultFocusSettings, next = { ...original, focusMinutes: 45, shortBreakMinutes: 10 };
  const state = startFocus(initialFocusState(original), original, 0);
  assert.equal(applyFocusSettings(state, next), state);
  assert.equal(focusDuration(state, next), 25 * MINUTE);
  assert.equal(elapsedFraction(state, next, 10 * MINUTE), 0.4);
  const tick = tickFocus(state, next, 25 * MINUTE);
  assert.equal(tick.finished?.record?.minutes, 25); assert.equal(tick.state.remainingMs, 10 * MINUTE);
});
test('暂停后改提示音和时长均保留剩余时间，恢复后准确记录原时长', () => {
  const original = defaultFocusSettings, next = { ...original, chime: false, focusMinutes: 45 };
  const paused = pauseFocus(startFocus(initialFocusState(original), original, 0), 10 * MINUTE);
  const changed = applyFocusSettings(paused, next);
  assert.equal(changed, paused); assert.equal(changed.remainingMs, 15 * MINUTE);
  assert.equal(elapsedFraction(changed, next, 50 * MINUTE), 0.4);
  const resumed = startFocus(changed, next, 50 * MINUTE);
  assert.equal(resumed.endAt, 65 * MINUTE);
  assert.equal(tickFocus(resumed, next, 65 * MINUTE).finished?.record?.minutes, 25);
  const reset = resetFocus(paused, next); assert.equal(reset.remainingMs, 45 * MINUTE); assert.equal(reset.session, undefined);
});
test('未开始的阶段使用新偏好，本轮长休息规则则在开始时冻结', () => {
  const original = defaultFocusSettings, next = { ...original, focusMinutes: 45, roundsBeforeLong: 1 };
  const idle = applyFocusSettings(initialFocusState(original), next);
  assert.equal(idle.remainingMs, 45 * MINUTE);
  assert.equal(startFocus(idle, next, 0).endAt, 45 * MINUTE);
  const running = startFocus(initialFocusState(original), original, 0);
  const tick = tickFocus(running, next, 25 * MINUTE);
  assert.equal(tick.state.phase, 'break');
});
test('开始前等待或长按不会让首帧时长增加，下一拍不反向跳秒', () => {
  const settings = defaultFocusSettings;
  const started = startFocus(initialFocusState(settings), settings, 8000);
  assert.equal(remainingFocus(started, 0), 25 * MINUTE);
  assert.equal(remainingFocus(started, 8000), 25 * MINUTE);
  assert.equal(remainingFocus(started, 8250), 25 * MINUTE - 250);
});
test('暂停很久再长按继续，旧时钟也不能把暂停时间加回来', () => {
  const settings = defaultFocusSettings;
  const paused = pauseFocus(startFocus(initialFocusState(settings), settings, 0), 5 * MINUTE);
  const resumed = startFocus(paused, settings, 30 * MINUTE);
  assert.equal(remainingFocus(resumed, 5 * MINUTE), 20 * MINUTE);
  assert.equal(remainingFocus(resumed, 30 * MINUTE), 20 * MINUTE);
  assert.equal(remainingFocus(resumed, 30 * MINUTE + 500), 20 * MINUTE - 500);
});
