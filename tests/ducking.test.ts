import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DuckEnvelope, dbToGain, duckGain, duckProfile, describeDepth, gainToDb, percentToDb, depthRange } from '../src/ducking.ts';

/**
 * 以 80ms 一拍推进包络，返回每一步的值。
 * now 在闭包里连续累加，模拟真实播放的时间轴——否则保持期永远走不出去。
 */
function makeRunner(envelope: DuckEnvelope) {
  let now = 0;
  return (seconds: number, rms: number, playing: boolean, enabled: boolean, profile = duckProfile('forest', 9)) => {
    const steps: number[] = [];
    const beats = Math.round(seconds / 0.08);
    for (let i = 0; i < beats; i++) {
      now += 0.08;
      steps.push(envelope.step(rms, now, playing, enabled, profile));
    }
    return steps;
  };
}

test('分贝与线性增益互为反函数，且 -0 被归一成 0', () => {
  assert.ok(Math.abs(dbToGain(9) - 0.3548) < 1e-3);
  assert.equal(dbToGain(0), 1);
  assert.equal(dbToGain(-5), 1, '负数按 0 dB 处理');
  assert.equal(gainToDb(1), 0);
  assert.equal(Object.is(gainToDb(1), -0), false, '不能返回 -0');
  for (const db of [0, 3, 6, 9, 12, 24]) {
    assert.ok(Math.abs(gainToDb(dbToGain(db)) - db) < 0.05, `${db} dB 往返一致`);
  }
});

test('包络按淡入时长线性推进，不会一步跳到底', () => {
  const env = new DuckEnvelope();
  const run = makeRunner(env);
  const profile = duckProfile('rain', 9);
  const steps = run(profile.attackDelay + profile.attackTime + 0.08, 0.5, true, true, profile);
  // 起手第一拍不该直接满
  assert.ok(steps[0] < 0.2, `第一拍 ${steps[0]} 应该很小`);
  // 单调不减
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1] - 1e-9);
  // 等待期加完整淡入时长之后才压到底
  assert.ok(steps.at(-1)! > 0.9, `末端 ${steps.at(-1)} 应该接近 1`);
  assert.equal(env.value, steps.at(-1));
});

test('慢的声音比快的声音压得更慢，这是按封面类型绑定的手感', () => {
  const slow = duckProfile('forest', 9);
  const fast = duckProfile('keyboard', 9);
  assert.ok(slow.attackTime > fast.attackTime);
  assert.ok(slow.releaseTime > fast.releaseTime);
  assert.ok(slow.threshold >= fast.threshold, '慢声部对音乐更宽容一点');

  // 同样跑 0.4 秒，慢的那张压得更少
  const slowEnv = new DuckEnvelope();
  const fastEnv = new DuckEnvelope();
  makeRunner(slowEnv)(0.4, 0.5, true, true, slow);
  makeRunner(fastEnv)(0.4, 0.5, true, true, fast);
  assert.ok(slowEnv.value < fastEnv.value, `慢 ${slowEnv.value} < 快 ${fastEnv.value}`);
});

test('没有匹配封面时走通用手感，未知封面不会崩', () => {
  const fallback = duckProfile(undefined, 9);
  const unknown = duckProfile('不存在的封面', 9);
  assert.deepEqual(fallback, unknown);
  assert.equal(fallback.depthDb, 9);
});

test('深度被夹在 0..24 dB，0 表示这张完全不避让', () => {
  assert.equal(duckProfile('rain', -5).depthDb, depthRange.min);
  assert.equal(duckProfile('rain', 999).depthDb, depthRange.max);

  const env = new DuckEnvelope();
  const steps = makeRunner(env)(3, 0.5, true, true, duckProfile('rain', 0));
  assert.ok(steps.every(v => v === 0), '深度 0 时包络始终为 0');
  assert.equal(duckGain(1, 0), 1);
});

test('音乐停下时包络先保持、再平滑恢复，不会突然弹回去', () => {
  const profile = duckProfile('forest', 9);
  const env = new DuckEnvelope();
  const run = makeRunner(env);
  run(3, 0.5, true, true, profile);
  assert.ok(env.value > 0.9, '先在避让中');

  // 前 holdTime 内应保持在原位
  const held = run(profile.holdTime * 0.6, 0, false, true, profile);
  assert.ok(held.every(v => v > 0.9), '保持期内不放回');

  // 保持期之后开始平滑恢复
  const releasing = run(profile.releaseTime + profile.holdTime, 0, false, true, profile);
  for (let i = 1; i < releasing.length; i++) assert.ok(releasing[i] <= releasing[i - 1] + 1e-9, '恢复过程单调递减');
  assert.equal(releasing.at(-1), 0, '最终完全放开');
});

test('关掉自动避让时同样先保持再放开', () => {
  const profile = duckProfile('rain', 9);
  const env = new DuckEnvelope();
  const run = makeRunner(env);
  run(3, 0.5, true, true, profile);
  assert.ok(env.value > 0.9);
  // 保持期 + 完整恢复时长，再多给半秒余量
  const off = run(profile.holdTime + profile.releaseTime + 0.5, 0.5, true, false, profile);
  assert.equal(off.at(-1), 0, '用户关掉开关也要放开');
});

test('迟滞防抖：音量在阈值附近抖动时不会反复开关', () => {
  const profile = duckProfile('cafe', 9);
  const env = new DuckEnvelope();
  const run = makeRunner(env);
  run(3, 0.5, true, true, profile);
  assert.ok(env.value > 0.9);

  // 掉到阈值和阈值+迟滞之间：已经在避让中，应该保持不动
  const held = run(1, profile.threshold + profile.hysteresis / 2, true, true, profile);
  assert.ok(held.every(v => v > 0.9), '在迟滞带里保持避让');

  // 掉到阈值以下，且过了保持期，才开始恢复
  const dropping = run(profile.releaseTime + profile.holdTime + 0.5, profile.threshold / 2, true, true, profile);
  assert.equal(dropping.at(-1), 0);
});

test('把避让量换算成增益，落在 1 和 −depth 之间', () => {
  assert.equal(duckGain(0, 9), 1);
  assert.ok(Math.abs(duckGain(1, 9) - dbToGain(9)) < 1e-9);
  assert.ok(Math.abs(duckGain(0.5, 9) - (1 + (dbToGain(9) - 1) * 0.5)) < 1e-9);
  // 越界的输入被夹住，不会算出负增益
  assert.equal(duckGain(-1, 9), 1);
  assert.ok(Math.abs(duckGain(9, 9) - dbToGain(9)) < 1e-9);
  assert.ok(duckGain(1, 24) > 0);
});

test('分贝被翻译成人话，界面直接用', () => {
  assert.equal(describeDepth(0), '不避让');
  assert.equal(describeDepth(2), '轻轻让一点');
  assert.equal(describeDepth(4), '明显退后');
  assert.equal(describeDepth(9), '让出位置');
  assert.equal(describeDepth(12), '几乎退到底');
  assert.equal(describeDepth(20), '完全让位');
});

test('旧的百分比设置能换算成等价的分贝', () => {
  // 旧版「降低 65%」= 振幅乘 0.35 ≈ −9.1 dB
  assert.equal(percentToDb(65), 9.1);
  assert.equal(percentToDb(0), 0);
  assert.equal(percentToDb(100), depthRange.max);
  assert.ok(percentToDb(30) < percentToDb(65));
});
