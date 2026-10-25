import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BOOST_DB, MAX_CUT_DB, TARGET_RMS_DB, dbToLinear, linearToDb, loudnessGain, measureRms } from '../src/loudness.ts';

/**
 * 关心的是「用户上传什么素材，听起来都差不多响」。
 * 素材响度极不齐是实测出来的真问题：同一份收藏里最轻的一段比最响的低 13 dB。
 */

/** 造一段定长、定幅度的假音频，用来验证抽样与增益计算。 */
function bufferOf(amplitude: number, length = 1000, channels = 2): AudioBuffer {
  return {
    length, numberOfChannels: channels, sampleRate: 48000, duration: length / 48000,
    getChannelData: () => {
      const data = new Float32Array(length);
      for (let i = 0; i < length; i += 1) data[i] = i % 2 ? amplitude : -amplitude;
      return data;
    },
  } as unknown as AudioBuffer;
}

test('RMS 量得准：方波幅度就是 RMS', () => {
  assert.ok(Math.abs(measureRms(bufferOf(0.5)) - 0.5) < 1e-6);
  assert.ok(Math.abs(measureRms(bufferOf(0.1)) - 0.1) < 1e-6);
});

test('双声道会一起算，不会因为只读一条把另一条漏掉', () => {
  const mono = bufferOf(0.4, 1000, 1);
  const stereo = bufferOf(0.4, 1000, 2);
  assert.ok(Math.abs(measureRms(mono) - measureRms(stereo)) < 1e-6);
});

test('空音频与静音不炸，量出来是 0', () => {
  assert.equal(measureRms({ length: 0, numberOfChannels: 0 } as unknown as AudioBuffer), 0);
  assert.equal(measureRms(bufferOf(0)), 0);
  assert.equal(measureRms({} as unknown as AudioBuffer), 0);
});

test('太轻的素材补上去，太响的压下来，都朝 −23 dB 靠', () => {
  // −37.6 dB 的素材（实测里「书写」就是这个量级）要补 14.6 dB，
  // 上限 15 dB 以内，所以能一次补到基准
  const source = -37.6;
  const light = dbToLinear(source);
  const lifted = linearToDb(loudnessGain(light) * light);
  assert.ok(Math.abs(lifted - TARGET_RMS_DB) < 0.5, `实际补到 ${lifted.toFixed(2)} dB`);

  // 更轻的素材会撞上限：−50 dB 需要 27 dB，只补 15 dB
  const tiny = -50;
  assert.ok(Math.abs(linearToDb(loudnessGain(dbToLinear(tiny)) * dbToLinear(tiny)) - (tiny + MAX_BOOST_DB)) < 0.01);

  // −10 dB 的素材要压 13 dB，超过上限，只压 12 dB
  const loudSource = -10;
  const loud = dbToLinear(loudSource);
  assert.ok(Math.abs(linearToDb(loudnessGain(loud) * loud) - (loudSource - MAX_CUT_DB)) < 0.01);

  // 正好在基准上的原样不动
  assert.ok(Math.abs(loudnessGain(dbToLinear(TARGET_RMS_DB)) - 1) < 1e-9);
});

test('量不出响度时增益是 1，宁可不动也不要乱放大', () => {
  assert.equal(loudnessGain(0), 1);
  assert.equal(loudnessGain(-1), 1);
  assert.equal(loudnessGain(Number.NaN), 1);
});

test('分贝与倍率互为反函数', () => {
  for (const db of [-40, -23, -12, 0, 6]) {
    assert.ok(Math.abs(linearToDb(dbToLinear(db)) - db) < 1e-9);
  }
  assert.equal(linearToDb(0), Number.NEGATIVE_INFINITY);
});
