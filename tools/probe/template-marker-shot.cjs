/**
 * 只拍一张「版式胶囊」的特写，用来肉眼确认滑块确实压在选中那颗上。
 *
 * 为什么单独写：`capturePage()` 只能整窗截，控制条在 1080p 全屏下落在
 * 画面非常靠下的位置，靠手算裁切框老是偏（我已经偏过一次，裁到了唱片区）。
 * 这里先问页面要 `.theater-templates` 的矩形，再按它对位裁。
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, guard, wait, report } = require('./harness.cjs');

const BOX = `(() => {
  const group = document.querySelector('.theater-templates');
  if (!group) return null;
  const b = group.getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
})()`;

const PICK = name => `(() => {
  const group = document.querySelector('.theater-templates');
  [...group.querySelectorAll('button')].find(b => b.textContent.trim() === '${name}')?.click();
  return 1;
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'collage', expand: true, settle: 2600 });
  const { run, win } = probe;

  const shots = {};
  for (const name of ['拼贴', '相集', '透明']) {
    await run(PICK(name));
    await wait(520);
    const box = await run(BOX);
    // 外扩 10px：把胶囊外壳的圆角也带进来。
    const rect = {
      x: Math.max(0, Math.round(box.x) - 10),
      y: Math.max(0, Math.round(box.y) - 10),
      width: Math.round(box.width) + 20,
      height: Math.round(box.height) + 20,
    };
    const png = (await win.webContents.capturePage(rect)).toPNG();
    const file = path.join(__dirname, `tag-${name}.png`);
    fs.writeFileSync(file, png);
    shots[name] = { file: `tools/probe/tag-${name}.png`, rect, box };
  }

  report(shots);
});
