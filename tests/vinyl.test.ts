import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pressings,
  recordPressing,
  vinylPalette,
  shade,
  tint,
  luminance,
  toRgb,
  toHex,
} from '../src/vinyl.ts';

test('压片工艺固定五种，每种都有名字和角度', () => {
  assert.equal(pressings.length, 5);
  const ids = pressings.map(pressing => pressing.style);
  assert.deepEqual([...ids].sort(), ['glow', 'halo', 'marble', 'splatter', 'swirl']);
  for (const pressing of pressings) {
    assert.ok(pressing.name.length > 0);
    assert.ok(Number.isFinite(pressing.angle));
  }
});

test('同一张唱片在同一次启动里工艺不变', () => {
  const first = recordPressing('record-1', 'seed-a');
  const second = recordPressing('record-1', 'seed-a');
  assert.equal(first.style, second.style);
  assert.equal(first.angle, second.angle);
});

test('不同唱片会分到不止一种工艺', () => {
  const styles = new Set<string>();
  for (let index = 0; index < 60; index++) {
    styles.add(recordPressing(`record-${index}`, 'seed-a').style);
  }
  assert.ok(styles.size >= 3, `只分到了 ${styles.size} 种工艺`);
});

test('换一次启动会打乱工艺分配', () => {
  let changed = 0;
  for (let index = 0; index < 40; index++) {
    if (recordPressing(`record-${index}`, 'seed-a').style !== recordPressing(`record-${index}`, 'seed-b').style) {
      changed++;
    }
  }
  assert.ok(changed > 4, `只有 ${changed} 张换了工艺`);
});

test('封面取色成功时，胶盘底色比主色更深', () => {
  const palette = vinylPalette(['#b0623f', '#d8c58a', '#5b6d7a'], '#879a91');
  assert.equal(palette.accent, '#b0623f');
  assert.ok(luminance(palette.base) < luminance(palette.accent), '底色没有压深');
  assert.notEqual(palette.accent2, palette.accent);
  assert.equal(palette.light, luminance(palette.base) > 0.55);
});

test('取不到色时退回唱片自己的颜色，画面不空', () => {
  const palette = vinylPalette([], '#879a91');
  assert.equal(palette.accent, '#879a91');
  assert.ok(/^#[0-9a-f]{6}$/.test(palette.base));
  assert.ok(/^#[0-9a-f]{6}$/.test(palette.sheen));
});

test('颜色工具能往返换算，并保持亮度单调', () => {
  const rgb = toRgb('#9a8b78');
  assert.deepEqual(rgb, [154, 139, 120]);
  assert.equal(toHex(rgb), '#9a8b78');
  assert.ok(luminance(shade('#9a8b78', 0.4)) < luminance('#9a8b78'));
  assert.ok(luminance(tint('#9a8b78', 0.4)) > luminance('#9a8b78'));
});

test('非法颜色不会让取色流程崩掉', () => {
  const palette = vinylPalette(['not-a-color', '#ffffff'], '#5b6d7a');
  assert.ok(/^#[0-9a-f]{6}$/.test(palette.base));
});
