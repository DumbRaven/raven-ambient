import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveItem } from '../src/records.ts';

const list = ['a', 'b', 'c', 'd'];

test('往下拖：把第 1 项挪到第 3 格，中间两项整体上移', () => {
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
});

test('往上拖：把最后一项挪到最前面', () => {
  assert.deepEqual(moveItem(list, 3, 0), ['d', 'a', 'b', 'c']);
});

test('原地放下不产生新数组', () => {
  assert.equal(moveItem(list, 2, 2), list);
});

test('越界位置原样返回，不会把项吞掉', () => {
  assert.equal(moveItem(list, -1, 2), list);
  assert.equal(moveItem(list, 4, 0), list);
  assert.equal(moveItem(list, 0, 9), list);
});

test('不修改传入的数组', () => {
  const source = [...list];
  moveItem(source, 0, 3);
  assert.deepEqual(source, list);
});

test('单项列表怎么拖都不变', () => {
  assert.deepEqual(moveItem(['only'], 0, 0), ['only']);
  assert.deepEqual(moveItem(['only'], 0, 1), ['only']);
});
