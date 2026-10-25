import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCabinet, sanitizeCabinet, trackTransitions, transitionDuration, transitionHints, transitionNames } from '../src/records.ts';

test('三种过渡方式都有中文名和说明', () => {
  assert.deepEqual(trackTransitions, ['off', 'crossfade', 'fade']);
  for (const value of trackTransitions) {
    assert.ok(transitionNames[value].length > 0);
    assert.ok(transitionHints[value].length > 0);
  }
  assert.equal(transitionNames.crossfade, '交叉淡化');
  assert.equal(transitionNames.fade, '淡出后淡入');
});

test('过渡时长与唱片的切换动画对齐，是 1 秒', () => {
  assert.equal(transitionDuration, 1);
});

test('默认是交叉淡化——听感上最连贯的一种', () => {
  assert.equal(emptyCabinet.transition, 'crossfade');
});

test('旧数据没有这个字段时回落到默认值', () => {
  const cabinet = sanitizeCabinet({ ...emptyCabinet, transition: undefined } as unknown as Record<string, unknown>);
  assert.equal(cabinet.transition, 'crossfade');
});

test('非法取值被收敛掉，不会传进音频层', () => {
  const cabinet = sanitizeCabinet({ ...emptyCabinet, transition: 'crossfad' } as unknown as Record<string, unknown>);
  assert.equal(cabinet.transition, 'crossfade');
});

test('合法取值原样保留', () => {
  for (const value of trackTransitions) {
    const cabinet = sanitizeCabinet({ ...emptyCabinet, transition: value } as unknown as Record<string, unknown>);
    assert.equal(cabinet.transition, value);
  }
});
