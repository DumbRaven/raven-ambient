import test from 'node:test';
import assert from 'node:assert/strict';
import { durationText } from '../src/clock.ts';

test('默认向下取整，分钟不补零——曲目时长的写法', () => {
  assert.equal(durationText(0), '0:00');
  assert.equal(durationText(9), '0:09');
  assert.equal(durationText(72), '1:12');
  assert.equal(durationText(125), '2:05');
  // 播到 2:05.9 就该显示 2:05，不能提前报 2:06
  assert.equal(durationText(125.9), '2:05');
});

test('向上取整：倒计时从第一帧就该显示完整的 25:00', () => {
  assert.equal(durationText(0, { round: 'ceil' }), '0:00');
  assert.equal(durationText(0.4, { round: 'ceil' }), '0:01');
  assert.equal(durationText(999 / 1000, { round: 'ceil' }), '0:01');
  assert.equal(durationText(1500 / 1000, { round: 'ceil' }), '0:02');
  assert.equal(durationText(1500), '25:00');
});

test('四舍五入 + 分钟补零：图层番茄钟的等宽读数', () => {
  assert.equal(durationText(0.4, { round: 'round', padMinutes: true }), '00:00');
  assert.equal(durationText(0.6, { round: 'round', padMinutes: true }), '00:01');
  assert.equal(durationText(59.4, { round: 'round', padMinutes: true }), '00:59');
  assert.equal(durationText(1500, { round: 'round', padMinutes: true }), '25:00');
});

test('超过 60 分钟分钟数继续往上加，不出小时位', () => {
  // 睡眠定时上限 90 分钟、专注时长上限 180 分钟都真能走到这里。
  // 显示成 90:00 / 180:00 而不是 1:30:00：后者比 59:59 还短，
  // 同样位置宽度会跳，读数看着在缩。
  assert.equal(durationText(3599), '59:59');
  assert.equal(durationText(3600), '60:00');
  assert.equal(durationText(90 * 60), '90:00');
  assert.equal(durationText(180 * 60), '180:00');
  assert.equal(durationText(180 * 60, { padMinutes: true }), '180:00');
});

test('脏数据退回 0:00，不让 NaN 印到界面上', () => {
  assert.equal(durationText(Number.NaN), '0:00');
  assert.equal(durationText(Number.POSITIVE_INFINITY), '0:00');
  assert.equal(durationText(Number.NEGATIVE_INFINITY), '0:00');
  assert.equal(durationText(-5), '0:00');
  assert.equal(durationText(Number.NaN, { padMinutes: true }), '00:00');
});
