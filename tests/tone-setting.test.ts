/**
 * 配色设置：三组手填色（信息条 / 面板 / 胶囊·署名）。
 *
 * 这里测的是**存档兼容**——用户机器上已经存了一份老格式
 * `{ mode, pick, custom: { base, panel, bar } }`，新版本多了
 * `onPanel / onBar / gold` 三档。必须能读进来、缺的档当空处理，
 * 否则读失败会整份退回 defaultTone，用户之前调的颜色全没了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultTone,
  normaliseHex,
  readTone,
  toneGroups,
  toneHint,
  type ToneSetting,
} from '../src/tone-setting.ts';
import { collageTone } from '../src/templates.ts';
import { toRgb } from '../src/vinyl.ts';

function hsl(hex: string) {
  const [r, g, b] = toRgb(hex).map(n => n / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return { h: 0, s, l };
}

test('老存档（只有三档底色）能读进来，新字段补空', () => {
  const legacy = JSON.stringify({ mode: 'custom', pick: 2, custom: { base: '#112233', panel: '#445566', bar: '#778899' } });
  const tone = readTone(legacy);
  assert.equal(tone.mode, 'custom');
  assert.equal(tone.pick, 2);
  assert.equal(tone.custom.base, '#112233');
  assert.equal(tone.custom.panel, '#445566');
  assert.equal(tone.custom.bar, '#778899');
  assert.equal(tone.custom.onPanel, '', '老存档没有这一档，当空处理');
  assert.equal(tone.custom.onBar, '');
  assert.equal(tone.custom.gold, '');
});

test('读进来的一律小写，非法色值当空', () => {
  const raw = JSON.stringify({
    mode: 'custom',
    custom: { base: '#ABCDEF', panel: 'not-a-color', onBar: '#00FF00', gold: '#12345' },
  });
  const tone = readTone(raw);
  assert.equal(tone.custom.base, '#abcdef');
  assert.equal(tone.custom.panel, '', '认不出就当空，不要原样留着');
  assert.equal(tone.custom.onBar, '#00ff00');
  assert.equal(tone.custom.gold, '', '五位不是合法色值');
});

test('坏 JSON / 空值退回默认，不抛异常', () => {
  assert.deepEqual(readTone(null), defaultTone);
  assert.deepEqual(readTone('{'), defaultTone);
  assert.deepEqual(readTone('null'), defaultTone);
});

test('custom 模式把六档全带进 hint，空的给 undefined', () => {
  const tone: ToneSetting = {
    mode: 'custom',
    pick: 1,
    custom: { base: '', panel: '#4a5363', onPanel: '', bar: '', onBar: '#ffffff', gold: '#d4a040' },
  };
  const hint = toneHint(tone, []);
  assert.equal(hint.base, undefined, '留空的那档要落到 undefined，collageTone 才会去自动算');
  assert.equal(hint.panel, '#4a5363');
  assert.equal(hint.onPanel, undefined);
  assert.equal(hint.bar, undefined);
  assert.equal(hint.onBar, '#ffffff');
  assert.equal(hint.gold, '#d4a040');
});

test('auto / pick 模式不受手填影响', () => {
  const tone: ToneSetting = { ...defaultTone, custom: { ...defaultTone.custom, gold: '#ff0000' } };
  assert.deepEqual(toneHint({ ...tone, mode: 'auto' }, ['#123456']), {});
  const picked = toneHint({ ...tone, mode: 'pick', pick: 0 }, ['#123456']);
  assert.equal(typeof picked.hue, 'number');
  assert.equal(picked.gold, undefined, 'pick 模式不吃手填色');
});

/**
 * 「挑一个」必须把饱和度和色相一起交出去。
 *
 * 这一条锁的是一次真实翻车（用户 m04458「配色那个功能里面的挑一个里面
 * 不是会给 4 套配色吗」）：`toneHint` 原来只传 `hue`，饱和度仍由
 * `collageTone` 从**整个色板里最艳的那个色**算。
 *
 * 「原神抖音风（1080P）」实测：4 个色块 `['#ccd2cd','#8d9574','#d8966e','#e4b08e']`，
 * 挑第 1 块 `#ccd2cd`（h130，饱和度只有 0.062，几乎是一块灰绿），
 * 算出来的面板是 `#4dcb62`——饱和度 0.548 的荧光绿。
 * 用户挑的是灰的，看到的是荧光绿，中间那 0.49 全是画面里
 * `#e4b08e`（s0.614）的饱和度被借过去了。
 *
 * 所以断言分两层：hint 里必须带 `sat`，而且用它算出来的面板
 * 饱和度必须贴着挑中那块本身，不能被别人的高饱和顶起来。
 */
test('挑一个：hint 带上挑中那块的饱和度', () => {
  const tone: ToneSetting = { ...defaultTone, mode: 'pick', pick: 0 };
  const palette = ['#ccd2cd', '#d8966e'];
  const hint = toneHint(tone, palette);
  assert.equal(typeof hint.hue, 'number');
  assert.equal(typeof hint.sat, 'number', 'pick 模式必须把饱和度一起传出去');
  assert.ok(Math.abs(hint.sat! - 0.062) < 0.01, `#ccd2cd 的饱和度是 0.062，实际拿到 ${hint.sat}`);
  // 换成画面里最艳的那块，饱和度必须跟着换——这一条排掉了
  // 「不管挑哪块都给同一个 sat」的实现（比如错手写成 lead.s）。
  const warm = toneHint({ ...tone, pick: 1 }, palette);
  assert.ok(Math.abs(warm.sat! - 0.576) < 0.01, `#d8966e 的饱和度是 0.576，实际拿到 ${warm.sat}`);
});

test('挑一个：面板饱和度跟着挑中那块走，不跟画面最艳的那块走', () => {
  const palette = ['#ccd2cd', '#8d9574', '#d8966e', '#e4b08e'];
  const dull = collageTone(palette, toneHint({ ...defaultTone, mode: 'pick', pick: 0 }, palette));
  const vivid = collageTone(palette, toneHint({ ...defaultTone, mode: 'pick', pick: 2 }, palette));

  const dullSat = hsl(dull.panel).s;
  const vividSat = hsl(vivid.panel).s;
  assert.ok(dullSat < 0.12, `挑灰绿应当算出几乎无彩的面板，实际 ${dull.panel} 饱和 ${dullSat.toFixed(3)}`);
  assert.ok(vividSat > 0.4, `挑橙色应当算出明显有彩的面板，实际 ${vivid.panel} 饱和 ${vividSat.toFixed(3)}`);
  assert.ok(vividSat > dullSat * 3, '两块颜色的结果必须拉开，不能都被画面最艳色顶成同一个饱和度');
});

test('挑一个：纯灰色块不再退回自动模式', () => {
  const tone: ToneSetting = { ...defaultTone, mode: 'pick', pick: 0 };
  const hint = toneHint(tone, ['#787878', '#e4b08e']);
  assert.deepEqual(hint, { hue: 0, sat: 0 }, '原来这里 return {} 会让用户点了没反应');
  const out = collageTone(['#787878', '#e4b08e'], hint);
  assert.ok(hsl(out.panel).s < 0.02, `纯灰挑灰就该是灰的，实际 ${out.panel}`);
});

test('自动模式没有 sat 这个字段可传，行为不能变', () => {
  const palette = ['#ccd2cd', '#8d9574', '#d8966e', '#e4b08e'];
  const auto = collageTone(palette);
  assert.equal(hsl(auto.panel).s > 0.4, true, '自动模式仍用画面最艳那个色的饱和度');
});

test('三组覆盖全部六个字段，没有漏也没有重复', () => {
  const covered = toneGroups.flatMap(group => group.fields.map(([key]) => key));
  const expected = ['base', 'panel', 'onPanel', 'bar', 'onBar', 'gold'];
  for (const key of expected) {
    if (key === 'base') continue; // base 挂在信息条那组一起露出来，不在分组表里
    assert.ok(covered.includes(key as never), `分组表漏了 ${key}`);
  }
  assert.equal(new Set(covered).size, covered.length, '同一个字段不能出现两次');
});

test('normaliseHex 宽进严出', () => {
  assert.equal(normaliseHex('#ABC'), '#aabbcc');
  assert.equal(normaliseHex('abcdef'), '#abcdef');
  assert.equal(normaliseHex('  #AABBCC  '), '#aabbcc');
  assert.equal(normaliseHex('#12345'), '');
  assert.equal(normaliseHex(''), '');
});
