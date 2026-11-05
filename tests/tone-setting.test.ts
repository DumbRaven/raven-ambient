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
