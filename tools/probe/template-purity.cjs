/**
 * 探针：相集是不是真的一个字都没有（用户 m12760 第 3 条）。
 *
 * 「删掉了 JSX」不等于「页面干净」——`.tpl-photo-*` 那些 CSS 还在的话，
 * 只要有人（以后的我）把节点加回来就会重新出现；更常见的是删了 JSX
 * 但留下 `::after` 那种伪元素暗角，肉眼上也能看出来。所以这里量三件事：
 *   1. `.tpl-photo` 子树里有没有非空文本
 *   2. 有没有 `::before` / `::after` 还画着东西
 *   3. 拼贴版式该有的那些标签还在（改相集不许波及拼贴，用户 m11244）
 */
const { launch, guard, wait, report } = require('./harness.cjs');

const PICK = name => `(() => {
  [...document.querySelector('.theater-templates').querySelectorAll('button')]
    .find(b => b.textContent.trim() === '${name}')?.click();
  return 1;
})()`;

/** 数一棵子树里所有「看得见的字」，顺便把装饰伪元素也列出来。 */
const SCAN = label => `(() => {
  const root = document.querySelector('.template');
  if (!root) return { label: '${label}', missing: true };

  const skip = new Set(['SCRIPT', 'STYLE']);
  const texts = [];
  const walk = node => {
    if (node.nodeType === 3) {
      const value = node.nodeValue.replace(/\\s+/g, ' ').trim();
      if (value) {
        const holder = node.parentElement;
        const box = holder ? holder.getBoundingClientRect() : null;
        // 只算画在画面里的：display:none 的（隐藏分支）不算
        const shown = holder && holder.offsetParent !== null && (!box || (box.width > 0 && box.height > 0));
        if (shown) texts.push({ text: value.slice(0, 60), tag: holder.tagName.toLowerCase(), cls: holder.className || '' });
      }
      return;
    }
    if (node.nodeType !== 1 || skip.has(node.nodeName)) return;
    for (const child of node.childNodes) walk(child);
  };
  walk(root);

  // 伪元素：content 不是 none 且在画面里的
  const pseudo = [];
  for (const el of root.querySelectorAll('*')) {
    for (const side of ['::before', '::after']) {
      const style = getComputedStyle(el, side);
      if (!style || style.content === 'none' || style.content === 'normal') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (Number(style.opacity) === 0) continue;
      pseudo.push({ cls: (el.className || '').toString().slice(0, 40), side, content: style.content.slice(0, 24) });
    }
  }

  return {
    label: '${label}',
    cls: root.className,
    textCount: texts.length,
    texts: texts.slice(0, 12),
    pseudo: pseudo.slice(0, 12),
  };
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'photo', expand: true, settle: 2800 });
  const { run } = probe;
  const out = {};

  await run(PICK('相集'));
  await wait(700);
  out.photo = await run(SCAN('相集'));

  await run(PICK('拼贴'));
  await wait(900);
  out.collage = await run(SCAN('拼贴'));

  report(out);
});
