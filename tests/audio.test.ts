import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMix, defaultMix, formatTime } from '../src/model.ts';
import { depthRange } from '../src/ducking.ts';
import { makeDemoMusic } from '../src/audio.ts';

test('corrupt saved settings cannot create invalid audio parameters', () => {
  const mix = sanitizeMix({ ...defaultMix, master: Infinity, musicVolume: -40,
    tracks: [{ ...defaultMix.tracks[0], volume: NaN, pan: 500, warmth: -1, duckDepth: undefined }, null, { kind: 'unknown' }] });
  assert.equal(mix.master, 0); assert.equal(mix.musicVolume, 0);
  // 没给深度、也没有全局兜底时，退回默认的 9 dB
  assert.equal(mix.tracks[0].duckDepth, 9);
  assert.equal(mix.tracks.length, 1); assert.equal(mix.tracks[0].volume, 0); assert.equal(mix.tracks[0].pan, 100);
  assert.equal(mix.tracks[0].warmth, 0);
  // 越界的一律夹到 0..24
  assert.equal(sanitizeMix({ ...defaultMix, tracks: [{ ...defaultMix.tracks[0], duckDepth: 999 }] }).tracks[0].duckDepth, depthRange.max);
  assert.equal(sanitizeMix({ ...defaultMix, tracks: [{ ...defaultMix.tracks[0], duckDepth: -3 }] }).tracks[0].duckDepth, 0);
  // 全局值也越界时同样被夹住
  assert.equal(sanitizeMix({ ...defaultMix, duckDepth: 150, tracks: [{ ...defaultMix.tracks[0], duckDepth: undefined }] }).tracks[0].duckDepth, depthRange.max);
  assert.deepEqual(sanitizeMix(null), defaultMix);
});

test('旧数据里的百分比避让会被读成分贝，不会丢失设置', () => {
  // 老版本只有 duckAmount: 65，完全没有 duckDepth 字段
  const legacyTrack = { ...defaultMix.tracks[0], duckAmount: 65, duckDepth: undefined } as unknown as typeof defaultMix.tracks[0];
  const legacy = sanitizeMix({ ...defaultMix, tracks: [legacyTrack] });
  assert.equal(legacy.tracks[0].duckDepth, 9.1);
  // 老的全局 duckDepth 作为兜底
  const globalFallback = sanitizeMix({ ...defaultMix, duckDepth: 12, tracks: [{ ...defaultMix.tracks[0], duckDepth: undefined }] });
  assert.equal(globalFallback.tracks[0].duckDepth, 12);
  // 新字段在时，绝不被旧的百分比覆盖
  const both = sanitizeMix({ ...defaultMix, tracks: [{ ...defaultMix.tracks[0], duckDepth: 18, duckAmount: 65 }] });
  assert.equal(both.tracks[0].duckDepth, 18);
});

test('demo WAV is well formed, bounded, and includes a silent recovery interval', async () => {
  const blob = makeDemoMusic(); const view = new DataView(await blob.arrayBuffer());
  assert.equal(view.getUint32(24, true), 22050);
  assert.equal(view.getUint32(40, true), 32 * 22050 * 2);
  let peak = 0, quietPeak = 0;
  for (let i = 0; i < 32 * 22050; i++) {
    const sample = Math.abs(view.getInt16(44 + i * 2, true)); peak = Math.max(peak, sample);
    if (i > 14.1 * 22050 && i < 16 * 22050) quietPeak = Math.max(quietPeak, sample);
  }
  assert.ok(peak > 1000 && peak < 32767); assert.equal(quietPeak, 0);
  assert.equal(formatTime(NaN), '0:00'); assert.equal(formatTime(125), '2:05');
});
