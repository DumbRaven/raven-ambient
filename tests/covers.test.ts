import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ambientCovers, ambientCoverUrl, matchAmbientCover } from '../src/ambient-covers.ts';
import { emptyCabinet, sanitizeCabinet } from '../src/records.ts';

test('cover matching handles Chinese, English, filenames, and specific sound types', () => {
  const examples = { '窗边的雨.wav': 'rain', '松林微风.wav': 'forest', '雨夜雷声.mp3': 'thunder', 'TRAIN_station.wav': 'train', 'Soft_Rain-01.flac': 'rain', 'Pink_Noise.wav': 'noise', '电风扇.wav': 'fan', '机械键盘.mp3': 'keyboard', 'Café ambience.wav': 'cafe' };
  for (const [name, id] of Object.entries(examples)) assert.equal(matchAmbientCover(name)?.id, id, name);
  assert.equal(matchAmbientCover('my brain recording.wav'), undefined);
  assert.equal(matchAmbientCover('录音 001.wav'), undefined);
  assert.equal(matchAmbientCover('02 - 风穿过松树 - 10分钟循环.wav')?.id, 'forest');
  assert.equal(matchAmbientCover('03 - 书写 - 10分钟循环.wav')?.id, 'writing');
  assert.equal(ambientCoverUrl('../outside'), undefined);
});

test('every bundled cover is a small self-contained SVG with an accessible title', async () => {
  assert.equal(new Set(ambientCovers.map(c => c.id)).size, ambientCovers.length);
  for (const cover of ambientCovers) {
    const svg = await readFile(new URL(`../public/covers/${cover.id}.svg`, import.meta.url), 'utf8');
    assert.ok(svg.includes(`<title>${cover.name}</title>`));
    assert.ok(Buffer.byteLength(svg) < 3000);
    assert.doesNotMatch(svg, /<script|href=|<image/i);
  }
});

test('existing ambience gets matching artwork, preserves manual and uploaded covers', () => {
  const base = { id: 'a', assetId: 'a', name: '窗边的雨', category: 'ambient' };
  const state = sanitizeCabinet({ ...emptyCabinet, records: [base, { ...base, id: 'b', coverPreset: 'fire' }, { ...base, id: 'c', coverId: 'uploaded-cover' }, { ...base, id: 'd', category: 'music' }] });
  assert.deepEqual(state.records.map(r => r.coverPreset), ['rain', 'fire', undefined, undefined]);
  assert.equal(state.records[2].coverId, 'uploaded-cover');
  assert.deepEqual(sanitizeCabinet(state), state);
});
