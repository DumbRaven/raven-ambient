import assert from 'node:assert/strict';
import test from 'node:test';
import { hashText, launchSeed, pickSleeve, sleeveStyles, sleeveTones } from '../src/sleeves.ts';

test('同一次启动里同一张唱片总是同一款封套', () => {
  const first = pickSleeve('record-a', 'seed-1');
  const second = pickSleeve('record-a', 'seed-1');
  assert.deepEqual(first, second);
});

test('不同唱片会分到不同款式', () => {
  const motifs = new Set(Array.from({ length: 40 }, (_, index) => pickSleeve(`record-${index}`, 'seed-1').motif));
  assert.ok(motifs.size > 1, '所有唱片都拿到同一款，随机失效');
});

test('换一个启动种子会换掉大部分封面', () => {
  const ids = Array.from({ length: 24 }, (_, index) => `record-${index}`);
  const before = ids.map(id => pickSleeve(id, 'seed-1'));
  const after = ids.map(id => pickSleeve(id, 'seed-2'));
  const same = before.filter((art, index) => art.motif === after[index].motif).length;
  assert.ok(same < ids.length * 0.5, `换了种子仍有 ${same}/${ids.length} 张完全没变`);
});

test('款式和色调都来自预设清单', () => {
  const motifIds = new Set(sleeveStyles.map(style => style.id));
  const toneKeys = new Set(sleeveTones.map(tone => `${tone.from}${tone.to}`));
  for (let index = 0; index < 60; index++) {
    const art = pickSleeve(`record-${index}`, 'seed-x');
    assert.ok(motifIds.has(art.motif), `未知款式 ${art.motif}`);
    assert.ok(toneKeys.has(`${art.tone.from}${art.tone.to}`), '色调不在预设清单里');
  }
});

test('款式清单没有重复 id', () => {
  const ids = sleeveStyles.map(style => style.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('哈希是稳定且非负的整数', () => {
  assert.equal(hashText('raven'), hashText('raven'));
  assert.notEqual(hashText('raven'), hashText('raveN'));
  assert.ok(Number.isInteger(hashText('raven')) && hashText('raven') >= 0);
});

test('启动种子每次加载都不同', () => {
  assert.ok(launchSeed.length > 6);
  assert.match(launchSeed, /^[a-z0-9]+$/);
});
