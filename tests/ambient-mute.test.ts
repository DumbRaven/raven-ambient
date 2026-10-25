import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cabinetMix, emptyCabinet, sanitizeCabinet, type Cabinet } from '../src/records.ts';

const ambient = (id: string) => ({
  id, assetId: 'asset-' + id, name: '声 ' + id, artist: '自然', category: 'ambient' as const,
  duration: 600, format: 'MP3', size: 1000, fingerprint: 'fp-' + id, volume: 60, pan: 0,
  warmth: 50, duckDepth: 6, color: '#a8dbe8', addedAt: 1,
});

const cabinet = (patch: Partial<Cabinet> = {}): Cabinet => ({
  ...emptyCabinet, records: [ambient('a'), ambient('b'), ambient('c')],
  ambience: ['a', 'b', 'c'], ...patch,
});

test('没按过暂停时，每一路环境音都是启用的', () => {
  const mix = cabinetMix(cabinet());
  assert.equal(mix.tracks.length, 3);
  assert.deepEqual(mix.tracks.map(t => t.enabled), [true, true, true]);
});

test('被单独暂停的那一路不再启用，其它照旧', () => {
  const mix = cabinetMix(cabinet({ muted: ['b'] }));
  assert.deepEqual(mix.tracks.map(t => t.id), ['asset-a', 'asset-b', 'asset-c']);
  assert.deepEqual(mix.tracks.map(t => t.enabled), [true, false, true]);
});

test('暂停只影响声音，不动队列：ambience 里还在，恢复后立刻能响', () => {
  const paused = cabinet({ muted: ['a'] });
  assert.deepEqual(paused.ambience, ['a', 'b', 'c']);
  assert.equal(cabinetMix(paused).tracks[0].enabled, false);
  assert.equal(cabinetMix({ ...paused, muted: [] }).tracks[0].enabled, true);
});

test('全部暂停也不会把声部列表清空，只是都关掉', () => {
  const mix = cabinetMix(cabinet({ muted: ['a', 'b', 'c'] }));
  assert.equal(mix.tracks.length, 3);
  assert.ok(mix.tracks.every(t => !t.enabled));
});

test('muted 里出现队列外的 id 不影响任何人', () => {
  const mix = cabinetMix(cabinet({ muted: ['不存在'] }));
  assert.ok(mix.tracks.every(t => t.enabled));
});

test('读旧收藏时没有 muted 字段，回落成空数组', () => {
  const raw = { ...cabinet(), muted: undefined };
  delete (raw as { muted?: unknown }).muted;
  const clean = sanitizeCabinet(raw);
  assert.deepEqual(clean.muted, []);
  assert.equal(cabinetMix(clean).tracks[0].enabled, true);
});

test('存档里的 muted 只收字符串，且最多 8 条', () => {
  const clean = sanitizeCabinet({
    ...cabinet(),
    muted: ['a', 42, null, 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
  } as unknown as Cabinet);
  assert.deepEqual(clean.muted, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
});
