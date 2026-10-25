import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cabinetRecords, emptyCabinet, sanitizeCabinet, toggleRecord, removeRecord, nextInQueue, cabinetMix, isAudioFile, percentToDepth, type RecordItem } from '../src/records.ts';

const record = (id: string, category: 'music' | 'ambient'): RecordItem => ({ id, assetId: id, name: id, artist: '本地', description: '', category, duration: 10, format: 'WAV', size: 100, color: '#aabbcc', fingerprint: id, volume: 50, pan: 0, warmth: 10, duckDepth: 9 });
test('music selection preserves click order separately from simultaneous ambience', () => {
  let state = { ...emptyCabinet, records: [record('a', 'music'), record('b', 'music'), record('rain', 'ambient')] };
  state = toggleRecord(state, 'b'); state = toggleRecord(state, 'rain'); state = toggleRecord(state, 'a');
  assert.deepEqual(state.queue, ['b', 'a']); assert.deepEqual(state.ambience, ['rain']);
  state = toggleRecord(state, 'b'); state = toggleRecord(state, 'b');
  assert.deepEqual(state.queue, ['a', 'b']);
  assert.equal(nextInQueue(state.queue, 'a'), 'b'); assert.equal(nextInQueue(state.queue, 'b'), 'a');
  assert.equal(nextInQueue([], 'missing'), undefined); assert.equal(nextInQueue(['a'], 'missing'), 'a');
});
test('removing a record cleans both selections without modifying source catalog', () => {
  const state = { ...emptyCabinet, records: [record('a', 'music'), record('rain', 'ambient')], queue: ['a'], ambience: ['rain'] };
  const next = removeRecord(state, 'a'); assert.deepEqual(next.queue, []); assert.deepEqual(next.ambience, ['rain']);
  assert.equal(state.records.length, 2); assert.equal(next.records.length, 1);
});
test('recovery sanitizes stale queue ids, duplicate records, wrong categories and invalid levels', () => {
  const bad = { ...record('rain', 'ambient'), duckDepth: -2 } as RecordItem;
  const state = sanitizeCabinet({ ...emptyCabinet, records: [record('a', 'music'), bad, record('a', 'music'), null], queue: ['missing', 'rain', 'a', 'a'], ambience: ['a', 'rain'], master: 180 });
  assert.deepEqual(state.queue, ['a']); assert.deepEqual(state.ambience, ['rain']); assert.equal(state.records.length, 2);
  assert.equal(state.master, 100);
  // 负数深度收敛到 0，也就是「这张不避让」
  assert.equal(state.records[1].duckDepth, 0);
  assert.equal(cabinetMix(state).tracks.length, 1); assert.equal(cabinetMix(state).tracks[0].id, 'rain');
});

test('old percent ducking migrates to decibels; depth is clamped to 0..24 dB', () => {
  // 旧数据只有百分比：65% ≈ 让出 9.1 dB
  const legacy = { ...record('rain', 'ambient'), duckAmount: 65, duckDepth: undefined } as unknown as RecordItem;
  const state = sanitizeCabinet({ ...emptyCabinet, records: [legacy] });
  assert.equal(state.records[0].duckDepth, 9.1);
  assert.equal('duckAmount' in state, false);

  // 全局旧的 duckAmount 作为兜底，逐张深度优先
  const bare = { ...record('fire', 'ambient'), duckAmount: undefined, duckDepth: undefined } as unknown as RecordItem;
  const migrated = sanitizeCabinet({ ...emptyCabinet, duckAmount: 42, ambience: ['fire', 'wind'], records: [bare, { ...record('wind', 'ambient'), duckDepth: 200 }] } as unknown);
  assert.deepEqual(migrated.records.map(r => r.duckDepth), [percentToDepth(42), 24]);
  assert.equal(percentToDepth(65), 9.1);
  assert.equal(percentToDepth(0), 0);

  // 落盘再读回来，深度不变
  const restored = sanitizeCabinet(JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(restored.records.map(r => r.duckDepth), migrated.records.map(r => r.duckDepth));
  assert.deepEqual(cabinetMix(restored).tracks.map(t => t.duckDepth), migrated.records.map(r => r.duckDepth));
});

test('selected shelf contains only selections, follows queue order, and updates on removal', () => {
  const state = { ...emptyCabinet, records: [record('a', 'music'), record('b', 'music'), record('rain', 'ambient'), record('fire', 'ambient')], queue: ['b', 'a'], ambience: ['rain'] };
  assert.deepEqual(cabinetRecords(state, 'selected').map(r => r.id), ['b', 'a', 'rain']);
  assert.deepEqual(cabinetRecords(state, 'selected', ' RAIN ').map(r => r.id), ['rain']);
  assert.deepEqual(cabinetRecords(toggleRecord(state, 'rain'), 'selected').map(r => r.id), ['b', 'a']);
  assert.equal(cabinetRecords({ ...state, queue: [], ambience: [] }, 'selected').length, 0);
  assert.equal(cabinetRecords(state, 'ambient').length, 2);
});
test('limit simultaneous ambience to eight while allowing deselection', () => {
  const records = Array.from({ length: 9 }, (_, i) => record(String(i), 'ambient'));
  const state = { ...emptyCabinet, records, ambience: records.slice(0, 8).map(r => r.id) };
  assert.throws(() => toggleRecord(state, '8'), /8/); assert.equal(toggleRecord(state, '0').ambience.length, 7);
});
test('folder import recognizes extensions when operating systems omit MIME types', () => {
  assert.equal(isAudioFile({ name: 'RAIN.FLAC', type: '' }), true);
  assert.equal(isAudioFile({ name: 'notes.txt', type: 'text/plain' }), false);
  assert.equal(isAudioFile({ name: 'sound', type: 'audio/wav' }), true);
});
