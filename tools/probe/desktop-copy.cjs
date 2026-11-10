/**
 * 探针：透明模式下，界面上每一句话是不是还对得上（用户 m12760 第 4 条）。
 *
 * 「说明文字不匹配了」不是某一处写错，是**一串**：改了数据模型、改了入口、
 * 加了缩放之后，好几句话还在描述已经不存在的动作。所以这里不测某一句话，
 * 而是**把透明版式下能看见的文字全捞出来**，逐条对着当前功能核。
 *
 * 捞三处：
 *   1. 版式胶囊的 hint（鼠标停在按钮上的那个 title）
 *   2. 图层菜单里六项的副标题 + 底下那行提示
 *   3. 空台面那一块（标题 + 副行）
 *   4. 库里一件都没有时的空状态（标题 + 说明 + 两颗按钮）
 *   5. 组件空列表的那句「怎么开始」
 *
 * 判据：不许出现指向已删除入口的词。「＋」那颗按钮早就没了（用户 m12005
 * 合并成「图层」），任何一句还在说「点 ＋」都是错的。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, guard, wait, report } = require('./harness.cjs');

const PICK_TEMPLATE = name => `(() => {
  const group = document.querySelector('.theater-templates');
  [...group.querySelectorAll('button')].find(b => b.textContent.trim() === '${name}')?.click();
  return 1;
})()`;

/** 版式胶囊上三颗的 title（= preset.hint）。 */
const TEMPLATE_HINTS = `(() => {
  const group = document.querySelector('.theater-templates');
  if (!group) return [];
  return [...group.querySelectorAll('button')].map(b => ({ name: b.textContent.trim(), hint: b.getAttribute('title') || '' }));
})()`;

const OPEN_MENU = `(() => {
  document.querySelector('.theater-overlay-toggle')?.click();
  return 1;
})()`;

/** 图层菜单：六项副标题 + 末尾提示。 */
const MENU_TEXT = `(() => {
  const menu = document.querySelector('.theater-overlay-menu');
  if (!menu) return null;
  return {
    items: [...menu.querySelectorAll('button')].map(b => ({
      name: b.querySelector('b')?.textContent?.trim() || '',
      hint: b.querySelector('small')?.textContent?.trim() || '',
    })),
    tip: menu.querySelector('.theater-overlay-tip')?.textContent?.trim() || '',
  };
})()`;

const CLOSE_MENU = `(() => {
  document.querySelector('.theater-overlay-veil')?.click();
  return 1;
})()`;

/** 台面上那块（有内容时是标题 / 空库时是「空台面」）。 */
const BAR_TEXT = `(() => {
  const copy = document.querySelector('.theater-copy');
  return copy ? { title: copy.querySelector('b')?.textContent?.trim() || '', sub: copy.querySelector('small')?.textContent?.trim() || '' } : null;
})()`;

const BLANK_HINT = `(() => {
  const hint = document.querySelector('.theater-blank-hint');
  return hint ? hint.textContent.trim() : null;
})()`;

/** 组件空列表那句。没有图层时才在。 */
const WIDGET_EMPTY = `(() => {
  const box = document.querySelector('.desktop-widgets-empty');
  return box ? box.textContent.trim() : null;
})()`;

/**
 * 把所有图层都摘掉，逼出组件空列表那句。
 *
 * 只点「已经勾上」的那几项——六项全点一遍会把没加的也加上，
 * 反而永远清不空。
 */
const CLEAR_LAYERS = `(() => {
  const menu = document.querySelector('.theater-overlay-menu');
  if (!menu) return 0;
  let removed = 0;
  for (const button of [...menu.querySelectorAll('button')]) {
    if (button.getAttribute('aria-checked') === 'true') {
      button.click();
      removed += 1;
    }
  }
  return removed;
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'desktop', expand: true, settle: 2600 });
  const { run, win } = probe;
  const out = {};

  out.templateHints = await run(TEMPLATE_HINTS);
  out.bar = await run(BAR_TEXT);
  out.blankHint = await run(BLANK_HINT);

  // ---- 图层菜单（透明版式：应该提到「右下角那点改大小」）
  await run(OPEN_MENU);
  await wait(320);
  out.menuDesktop = await run(MENU_TEXT);

  // ---- 全摘掉，看空列表那句
  out.removed = await run(CLEAR_LAYERS);
  await run(CLOSE_MENU);
  await wait(420);
  out.widgetEmpty = await run(WIDGET_EMPTY);

  // ---- 换成拼贴：同一块菜单的提示不该再提缩放（拼贴改不了）
  await run(PICK_TEMPLATE('拼贴'));
  await wait(700);
  await run(OPEN_MENU);
  await wait(320);
  out.menuCollage = await run(MENU_TEXT);
  await run(CLOSE_MENU);
  await wait(200);

  // ---- 截图两张：透明（空组件）与拼贴
  await run(PICK_TEMPLATE('透明'));
  await wait(800);
  fs.writeFileSync(path.join(__dirname, 'text-desktop.png'), (await win.webContents.capturePage()).toPNG());
  out.shots = ['tools/probe/text-desktop.png'];

  report(out);
});
