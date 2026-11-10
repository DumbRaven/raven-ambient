/**
 * 只补拍「透明」那一档的版式胶囊。
 *
 * 为什么单独一个文件：`tag-透明.png` 拍出来是张全黑的图。上一版在点完
 * 立刻等了 520ms 就裁，而切到透明版式要换掉整块幕布（径向渐变 + 组件层重挂），
 * 那一下比切别的版式慢，抓到的是中间态。这里改成**连拍到连续两帧一样**再收。
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, guard, wait, report } = require('./harness.cjs');

const PICK = name => `(() => {
  const group = document.querySelector('.theater-templates');
  [...group.querySelectorAll('button')].find(b => b.textContent.trim() === '${name}')?.click();
  return 1;
})()`;

/** 读胶囊当前状态：谁选中、滑块在哪。 */
const STATE = `(() => {
  const group = document.querySelector('.theater-templates');
  if (!group) return null;
  const marker = group.querySelector('.template-marker');
  const box = marker.getBoundingClientRect();
  const buttons = [...group.querySelectorAll('button')].map(b => ({
    name: b.textContent.trim(),
    on: b.classList.contains('on'),
    color: getComputedStyle(b).color,
  }));
  return {
    template: document.querySelector('.media-theater')?.getAttribute('data-template') || null,
    marker: { x: Math.round(box.x), w: Math.round(box.width) },
    buttons,
  };
})()`;

const BOX = `(() => {
  const group = document.querySelector('.theater-templates');
  const b = group.getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
})()`;

/** 同一块矩形连拍，两张逐字节一致才算这一帧稳了。 */
async function settledShot(win, rect, tries = 12) {
  let previous = null;
  for (let i = 0; i < tries; i += 1) {
    const png = (await win.webContents.capturePage(rect)).toPNG();
    if (previous && previous.equals(png)) return { png, tries: i + 1 };
    previous = png;
    await wait(120);
  }
  return { png: previous, tries };
}

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'collage', expand: true, settle: 2600 });
  const { run, win } = probe;

  await run(PICK('透明'));
  await wait(900);
  const state = await run(STATE);
  const box = await run(BOX);
  const rect = {
    x: Math.max(0, Math.round(box.x) - 10),
    y: Math.max(0, Math.round(box.y) - 10),
    width: Math.round(box.width) + 20,
    height: Math.round(box.height) + 20,
  };
  const shot = await settledShot(win, rect);
  fs.writeFileSync(path.join(__dirname, 'tag-透明.png'), shot.png);

  report({ state, rect, tries: shot.tries, file: 'tools/probe/tag-透明.png' });
});
