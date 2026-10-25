import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPage, pageCount, paginate, PAGE_SIZE } from '../src/records.ts';

const items = (n: number) => Array.from({ length: n }, (_, i) => i);

test('每页最多 6 张', () => {
  assert.equal(PAGE_SIZE, 6);
  assert.deepEqual(paginate(items(20), 0), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(paginate(items(20), 1), [6, 7, 8, 9, 10, 11]);
  assert.deepEqual(paginate(items(20), 3), [18, 19]);
});

test('页数至少为 1，正好整除不多出空页', () => {
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(1), 1);
  assert.equal(pageCount(6), 1);
  assert.equal(pageCount(7), 2);
  assert.equal(pageCount(12), 2);
  assert.equal(pageCount(13), 3);
});

test('页码越界会被收敛，删唱片后不会停在空白页', () => {
  assert.equal(clampPage(5, 20), 3);
  assert.equal(clampPage(-3, 20), 0);
  assert.equal(clampPage(1, 0), 0);
  assert.equal(clampPage(Number.NaN, 20), 0);
  assert.equal(clampPage(1.9, 20), 1);
  // 第 3 页只剩 2 张，删到只剩 6 张时应回落到第 0 页
  assert.deepEqual(paginate(items(6), 2), [0, 1, 2, 3, 4, 5]);
});

test('空列表分页返回空数组', () => {
  assert.deepEqual(paginate([], 0), []);
  assert.deepEqual(paginate([], 3), []);
});
