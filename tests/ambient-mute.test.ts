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

test('存档里的 muted 只收库里还在的环境音，且最多 8 条', () => {
  const clean = sanitizeCabinet({
    ...cabinet(),
    // 42 / null 不是 id；'不存在' 和 'd' 到 'j' 都不是库里的唱片。
    muted: ['a', 42, null, '不存在', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  } as unknown as Cabinet);
  assert.deepEqual(clean.muted, ['a', 'b', 'c']);
});

test('删掉的唱片不会继续占着静音名额', () => {
  // 这是修过的真问题：原来这里只校验「是字符串」，于是删掉 6 张唱片之后
  // muted 里那 6 个死 id 会一直占着 slice(0, 8) 的位置，
  // 用户之后无论怎么静音，超出 2 条的都存不进去。
  const many = Array.from({ length: 10 }, (_, i) => ({
    ...ambient('r' + i),
    id: 'r' + i,
    assetId: 'asset-r' + i,
  }));
  const clean = sanitizeCabinet({
    ...emptyCabinet,
    records: many,
    ambience: many.map(r => r.id),
    // 前 6 个是已经不存在的 id，后 4 个才是真唱片
    muted: ['gone-1', 'gone-2', 'gone-3', 'gone-4', 'gone-5', 'gone-6', 'r1', 'r2', 'r3', 'r4'],
  } as unknown as Cabinet);
  assert.deepEqual(clean.muted, ['r1', 'r2', 'r3', 'r4']);
});

test('同一个 id 在 muted 里写两遍也只算一条', () => {
  const clean = sanitizeCabinet({ ...cabinet(), muted: ['a', 'a', 'b', 'a'] } as unknown as Cabinet);
  assert.deepEqual(clean.muted, ['a', 'b']);
});
