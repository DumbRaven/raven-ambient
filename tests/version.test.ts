/**
 * 版本号比较。
 *
 * 被 `electron/update.cjs` 用来回答「有没有新版本」。实现就在
 * `electron/version.cjs` 里——只有那一份，渲染进程从不自己比版本，
 * 所以这里直接测它。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { compareVersion, parseVersion } = require('../electron/version.cjs');

test('版本号拆成三段数字，前缀 v 与预发布标签都忽略', () => {
  assert.deepEqual(parseVersion('0.4.0'), [0, 4, 0]);
  assert.deepEqual(parseVersion('v0.4.0'), [0, 4, 0]);
  assert.deepEqual(parseVersion(' 1.2.3 '), [1, 2, 3]);
  assert.deepEqual(parseVersion('0.4.0-beta.1'), [0, 4, 0]);
  assert.deepEqual(parseVersion('2.0.1+abc'), [2, 0, 1]);
});

test('少写的段落当 0，不是解析失败', () => {
  assert.deepEqual(parseVersion('1.2'), [1, 2, 0]);
  assert.deepEqual(parseVersion('1'), [1, 0, 0]);
  assert.deepEqual(parseVersion(''), [0, 0, 0]);
  assert.deepEqual(parseVersion('abc'), [0, 0, 0]);
});

test('0.10.0 比 0.9.0 新——这就是不能用字符串比较的那一档', () => {
  assert.equal(compareVersion('0.10.0', '0.9.0'), 1);
  // 反证：字符串比较会给出相反答案，所以这条断言真的在守东西
  assert.ok('0.10.0' < '0.9.0');
});

test('相同版本返回 0，含前面补 v 的写法', () => {
  assert.equal(compareVersion('0.4.0', '0.4.0'), 0);
  assert.equal(compareVersion('v0.4.0', '0.4.0'), 0);
  assert.equal(compareVersion('0.4', '0.4.0'), 0);
});

test('更旧返回 -1', () => {
  assert.equal(compareVersion('0.3.3', '0.4.0'), -1);
  assert.equal(compareVersion('1.0.0', '1.0.1'), -1);
});

test('先比主段再比次段再比修订段', () => {
  assert.equal(compareVersion('1.0.0', '0.9.9'), 1);
  assert.equal(compareVersion('0.1.0', '0.0.9'), 1);
  assert.equal(compareVersion('0.0.2', '0.0.1'), 1);
});

test('拿到垃圾字符串不抛错，当 0.0.0 处理', () => {
  assert.equal(compareVersion('abc', '0.0.0'), 0);
  assert.equal(compareVersion('0.4.0', 'abc'), 1);
  assert.equal(compareVersion(undefined, '0.0.0'), 0);
  assert.equal(compareVersion(null, '0.0.0'), 0);
});
