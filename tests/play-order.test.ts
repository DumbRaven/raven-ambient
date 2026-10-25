import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextInOrder, nextOrder, orderNames, playOrders, previousInOrder } from '../src/records.ts';

const queue = ['a', 'b', 'c'];

test('播放顺序按列表 → 单曲 → 随机循环切换，不会漏掉也不会跳档', () => {
  assert.deepEqual(playOrders, ['sequence', 'repeat-one', 'shuffle']);
  assert.equal(nextOrder('sequence'), 'repeat-one');
  assert.equal(nextOrder('repeat-one'), 'shuffle');
  assert.equal(nextOrder('shuffle'), 'sequence');
  // 三种顺序都能回到自己，说明这是一个闭环
  for (const order of playOrders) {
    let current = order;
    for (let i = 0; i < playOrders.length; i++) current = nextOrder(current);
    assert.equal(current, order);
  }
});

test('三种播放顺序都有中文名称', () => {
  assert.equal(orderNames.sequence, '列表循环');
  assert.equal(orderNames['repeat-one'], '单曲循环');
  assert.equal(orderNames.shuffle, '随机播放');
  for (const order of playOrders) assert.ok(orderNames[order]);
});

test('列表循环按顺序走，走到末尾回到开头', () => {
  assert.equal(nextInOrder(queue, 'a', 'sequence'), 'b');
  assert.equal(nextInOrder(queue, 'c', 'sequence'), 'a');
  assert.equal(nextInOrder(queue, undefined, 'sequence'), 'a');
  assert.equal(previousInOrder(queue, 'a', 'sequence'), 'c');
  assert.equal(previousInOrder(queue, 'b', 'sequence'), 'a');
});

test('单曲循环自然放完重播同一首，手动切歌仍然换下一首', () => {
  assert.equal(nextInOrder(queue, 'b', 'repeat-one', Math.random, false), 'b');
  assert.equal(nextInOrder(queue, 'b', 'repeat-one', Math.random, true), 'c');
  // 当前曲目已经不在队列里时，退回首曲而不是卡住
  assert.equal(nextInOrder(queue, 'gone', 'repeat-one', Math.random, false), 'a');
  assert.equal(nextInOrder(queue, undefined, 'repeat-one', Math.random, false), 'a');
});

test('随机播放不会连续两次挑到同一首，只有一首时除外', () => {
  for (let i = 0; i < 40; i++) {
    const picked = nextInOrder(queue, 'b', 'shuffle', () => i / 40);
    assert.notEqual(picked, 'b');
    assert.ok(queue.includes(picked!));
  }
  assert.equal(nextInOrder(['only'], 'only', 'shuffle'), 'only');
  // 空队列不能返回一个凭空的 id
  assert.equal(nextInOrder([], undefined, 'sequence'), undefined);
  assert.equal(previousInOrder([], undefined, 'shuffle'), undefined);
});

test('随机播放的取值由注入的随机源决定，可复现', () => {
  const first = nextInOrder(queue, 'a', 'shuffle', () => 0);
  const again = nextInOrder(queue, 'a', 'shuffle', () => 0);
  assert.equal(first, again);
  assert.equal(first, 'b');
});
