import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioBufferCache } from '../src/audio-buffer-cache.ts';
const buffer = (length: number) => ({ length, numberOfChannels: 2 }) as AudioBuffer;
test('缓存按解码后的 PCM 大小和最近使用顺序回收，不保留超额单文件', () => {
  const cache = new AudioBufferCache(160), a = buffer(10), b = buffer(10), c = buffer(10);
  cache.set('a', a); cache.set('b', b); assert.equal(cache.get('a'), a);
  cache.set('c', c); assert.equal(cache.get('b'), undefined); assert.equal(cache.get('a'), a);
  cache.set('large', buffer(100)); assert.equal(cache.get('large'), undefined); assert.equal(cache.get('c'), c);
  cache.delete('a'); cache.set('d', b); assert.equal(cache.get('c'), c);
  cache.clear(); assert.equal(cache.get('c'), undefined);
});
