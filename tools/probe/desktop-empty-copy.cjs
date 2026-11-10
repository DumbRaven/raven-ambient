/**
 * 组件一件都没有时，透明版式里那句「怎么开始」到底长什么样。
 *
 * 两条探针坑（都踩过）：
 *   ① 一路点菜单摘图层：摘一颗 React 就重渲染一次，手上那串按钮引用立刻
 *      变成游离节点，第二颗点了不生效。所以改成直接写空存档；
 *   ② `reload()` 之后应用回到唱片柜页，`媒体`那一层是 `display: none`，
 *      量什么都是 0×0。**reload 之后必须重新点一次导航。**
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, guard, wait, report } = require('./harness.cjs');

const SET_EMPTY = `(() => { localStorage.setItem('raven-layers', '[]'); return 1; })()`;

const OPEN_MEDIA = `(() => {
  [...document.querySelectorAll('.view-tabs > button')]
    .find(b => b.getAttribute('aria-label') === '相集')?.click();
  return 1;
})()`;

const DUMP = `(() => {
  const root = document.querySelector('.desktop-widgets');
  const empty = document.querySelector('.desktop-widgets-empty');
  const p = empty ? empty.querySelector('p') : null;
  return {
    rootClass: root ? root.className : null,
    hasEmpty: !!empty,
    text: p ? p.textContent.trim() : null,
    box: empty ? (() => { const b = empty.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })() : null,
    pill: p ? (() => { const b = p.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) }; })() : null,
    stored: localStorage.getItem('raven-layers'),
  };
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'desktop', expand: true, settle: 2400 });
  const { run, win } = probe;
  const out = {};

  out.before = await run(DUMP);
  await run(SET_EMPTY);
  await win.webContents.reload();
  await wait(2000);
  await run(OPEN_MEDIA);
  await wait(1600);
  await run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
  await wait(1200);
  out.after = await run(DUMP);

  if (out.after.pill) {
    const { x, y, w, h } = out.after.pill;
    const rect = { x: Math.max(0, x - 30), y: Math.max(0, y - 24), width: w + 60, height: h + 48 };
    fs.writeFileSync(path.join(__dirname, 'empty-copy.png'), (await win.webContents.capturePage(rect)).toPNG());
    out.shot = 'tools/probe/empty-copy.png';
  }

  report(out);
});
