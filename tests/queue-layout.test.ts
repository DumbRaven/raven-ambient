import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampQueueOffset, queueDropIndex, queueOffsets } from '../src/queue-layout.ts';
const slots = Array.from({ length: 4 }, (_, index) => ({ top: index * 50, height: 50 }));

test('拖过另一行中线才改变插入位置，向上向下都可返回', () => {
  assert.equal(queueDropIndex(slots, 0, 49), 0);
  assert.equal(queueDropIndex(slots, 0, 50), 1);
  assert.equal(queueDropIndex(slots, 0, 101), 2);
  assert.equal(queueDropIndex(slots, 3, -49), 3);
  assert.equal(queueDropIndex(slots, 3, -50), 2);
  assert.equal(queueDropIndex(slots, 3, -101), 1);
  assert.equal(queueDropIndex(slots, 0, 20), 0);
});
test('向下拖时路过的行上移，向上拖时路过的行下移，其余保持位置', () => {
  assert.deepEqual(queueOffsets(slots, 0, 2), [100, -50, -50, 0]);
  assert.deepEqual(queueOffsets(slots, 3, 1), [0, 50, 50, -100]);
  assert.deepEqual(queueOffsets(slots, 1, 1), [0, 0, 0, 0]);
});
test('拖出列表仍能准确落在首尾，不产生越界下标', () => {
  assert.equal(clampQueueOffset(slots, 1, -500), -50);
  assert.equal(clampQueueOffset(slots, 1, 500), 100);
  assert.equal(queueDropIndex(slots, 1, -500), 0);
  assert.equal(queueDropIndex(slots, 1, 500), 3);
  assert.equal(clampQueueOffset([], 0, 100), 0);
  assert.deepEqual(queueOffsets(slots, -1, 3), [0, 0, 0, 0]);
});
test('不同行高也会为完整的一行让位，松手后的目标位置与排版一致', () => {
  const varied = [{ top: 0, height: 80 }, { top: 84, height: 40 }, { top: 128, height: 60 }];
  assert.deepEqual(queueOffsets(varied, 0, 2), [108, -84, -84]);
  assert.deepEqual(queueOffsets(varied, 2, 0), [64, 64, -128]);
  assert.equal(queueDropIndex(varied, 0, 1000), 2);
  assert.equal(queueDropIndex(varied, 2, -1000), 0);
});
