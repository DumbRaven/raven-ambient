import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liftForVinyl } from '../src/vinyl.ts';

const rgb = (hex: string) => {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const hue = (hex: string) => {
  const [r, g, b] = rgb(hex).map(n => n / 255);
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), span = hi - lo;
  if (span < 0.001) return -1;
  const h = hi === r ? ((g - b) / span + (g < b ? 6 : 0)) / 6 : hi === g ? ((b - r) / span + 2) / 6 : ((r - g) / span + 4) / 6;
  return Math.round(h * 360);
};
const value = (hex: string) => Math.max(...rgb(hex)) / 255;

test('暗封面的颜色会被抬到看得见层次', () => {
  for (const dark of ['#101a20', '#192831', '#0f2f42', '#1a1208', '#000000']) {
    assert.ok(value(liftForVinyl(dark)) >= 0.4, `${dark} 抬完还是太暗`);
  }
});

test('抬亮度时不改色相', () => {
  for (const color of ['#101a20', '#0f2f42', '#1a1208']) {
    assert.ok(Math.abs(hue(color) - hue(liftForVinyl(color))) <= 2, `${color} 的色相被改了`);
  }
});

test('本来就够亮的颜色原样不动', () => {
  for (const bright of ['#a8e6c1', '#d9eb6c', '#f7b7a8', '#8b9188']) {
    assert.equal(liftForVinyl(bright), bright);
  }
});

test('灰色抬高后仍然是灰色，不会被染成别的颜色', () => {
  for (const gray of ['#000000', '#2a2a2a', '#333333']) {
    const lifted = liftForVinyl(gray);
    assert.equal(hue(lifted), -1, `${gray} 被染成了 ${lifted}`);
  }
});
