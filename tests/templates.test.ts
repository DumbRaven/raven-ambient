/**
 * 三套版式的名字与顺序。
 *
 * 这份测试存在的理由很具体：版式名同时出现在**四个地方**——控制条那排胶囊、
 * 导航栏的按钮、交接文档、一串探针里的文本匹配。用户 m12760 要求把「照片」
 * 改成「相集」时，探针靠文本找按钮，改漏一处就会静默点空（不报错，量到的
 * 还是旧页面）。所以名字一旦定下来，就在这里钉住，改的时候会先亮红灯。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { findTemplate, templateIds, templates, templateTitle } from '../src/templates.ts';

test('三套版式的 id 与顺序固定', () => {
  assert.deepEqual(templateIds, ['collage', 'photo', 'desktop']);
});

test('版式名：拼贴 / 相集 / 透明', () => {
  assert.deepEqual(
    templates.map(preset => preset.name),
    ['拼贴', '相集', '透明'],
  );
});

test('「照片」这个名字已经不用了', () => {
  // 用户 m12760 第 1 条：照片改成相集。留着旧名字会让人以为还有第四套版式。
  assert.equal(
    templates.some(preset => preset.name === '照片'),
    false,
  );
});

test('每套版式都有一句说明，且不空', () => {
  for (const preset of templates) {
    assert.equal(typeof preset.hint, 'string');
    assert.ok(preset.hint.length >= 6, `${preset.name} 的说明太短了`);
  }
});

test('相集那句说的是「不加任何字」', () => {
  // 用户 m12760 第 3 条。这不只是文案：TemplateStage 里 photo 分支确实一个字都不画，
  // 说明和实现对不上时，用户会照着说明去找一个不存在的东西。
  const photo = findTemplate('photo');
  assert.match(photo.hint, /不加任何字/);
});

test('找不到的 id 退回第一套，不抛错', () => {
  assert.equal(findTemplate('不存在').id, 'collage');
  assert.equal(findTemplate(null).id, 'collage');
});
