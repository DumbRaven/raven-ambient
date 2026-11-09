/**
 * 探针：图层缩放（用户 m12474 选了「就地上手柄」、并定「拼贴不改，照片改」）。
 *
 * 要证明四件事：
 *   1. 拼贴版式**没有**手柄（那套字号写死在 CSS 里，出个拖不动的控件是骗人）；
 *   2. 照片版式有手柄；
 *   3. 拖手柄真能把字变大——量的是 computed font-size，不是 CSS 变量；
 *   4. 松手之后倍率落进 `raven-layers` 存档。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules/electron/dist/electron.exe tools/probe/layer-scale.cjs --no-sandbox
 *
 * 为什么要分帧派发：pointerdown 之后 React 要重渲染、effect 才把 window 上的
 * pointermove 绑好。同一个 tick 里连发会整段丢掉（层图层那次量到「一动不动」）。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait } = require('./harness.cjs');

const PICK_TEMPLATE = name => `(() => {
  [...document.querySelectorAll('.theater-templates > button')]
    .find(b => b.textContent.trim() === ${JSON.stringify(name)})?.click();
  return 1;
})()`;

/** 版式名、有几颗手柄、时钟的字号。 */
const READ_LAYERS = `(() => {
  const clock = document.querySelector('.overlay-clock .ov-clock');
  return {
    template: document.querySelector('.media-theater')?.getAttribute('data-template') || null,
    grips: document.querySelectorAll('.overlay .layer-grip').length,
    clockFont: clock ? getComputedStyle(clock).fontSize : null,
  };
})()`;

/**
 * 拖时钟那颗手柄：从手柄当前位置往右下拖 `dist` 像素。
 *
 * 手柄的缩放手感是「离中心越远越大」，所以往外拖一定是变大；
 * 具体倍率由起手距离决定，探针只验方向与落盘，不验某个精确值。
 */
const DRAG_GRIP = dist => `(async () => {
  const grip = document.querySelector('.overlay-clock .layer-grip');
  const host = grip?.closest('.overlay');
  if (!grip || !host) return { error: 'no-grip' };
  const box = host.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const start = grip.getBoundingClientRect();
  const sx = start.left + start.width / 2;
  const sy = start.top + start.height / 2;
  const beforeDistance = Math.hypot(sx - cx, sy - cy);
  const beforeFont = getComputedStyle(host.querySelector('.ov-clock')).fontSize;
  const fire = (type, px, py) => grip.dispatchEvent(new PointerEvent(type, {
    pointerId: 9, pointerType: 'mouse', button: 0, buttons: 1,
    clientX: px, clientY: py, bubbles: true, cancelable: true,
  }));
  fire('pointerdown', sx, sy);
  await new Promise(r => setTimeout(r, 260));
  const tx = sx + ${dist};
  const ty = sy + ${dist};
  fire('pointermove', tx, ty);
  await new Promise(r => setTimeout(r, 80));
  const midFont = getComputedStyle(host.querySelector('.ov-clock')).fontSize;
  fire('pointerup', tx, ty);
  await new Promise(r => setTimeout(r, 320));
  return {
    beforeDistance: Math.round(beforeDistance),
    beforeFont,
    midFont,
    afterFont: getComputedStyle(host.querySelector('.ov-clock')).fontSize,
    afterDistance: Math.round(Math.hypot(tx - cx, ty - cy)),
  };
})()`;

/** 存档里时钟那条的倍率。 */
const STORED_SCALE = `(() => {
  const raw = localStorage.getItem('raven-layers');
  if (!raw) return null;
  try {
    const clock = JSON.parse(raw).find(w => w.id === 'clock');
    return clock ? clock.scale : null;
  } catch {
    return null;
  }
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'collage', expand: true, settle: 2600 });
  const { run, win } = probe;
  const out = {};

  // ---- 1. 拼贴：不该有手柄（这是硬约束，用户 m11244 + m12474）
  out.collage = await run(READ_LAYERS);

  // ---- 2. 照片：该有手柄，拖了要变大
  await run(PICK_TEMPLATE('照片'));
  await wait(900);
  out.photo = await run(READ_LAYERS);
  out.scaleBefore = await run(STORED_SCALE);
  out.drag = await run(DRAG_GRIP(90));
  await wait(400);
  out.scaleAfter = await run(STORED_SCALE);
  out.photoAfter = await run(READ_LAYERS);

  // ---- 3. 回到拼贴：确认还是没手柄（切版式不该把状态带错）
  await run(PICK_TEMPLATE('拼贴'));
  await wait(900);
  out.backToCollage = await run(READ_LAYERS);

  // ---- 4. 透明版式在主窗口里也带手柄（皮肤不同，入口要一致）
  await run(PICK_TEMPLATE('透明'));
  await wait(900);
  out.desktop = await run(`(() => ({
    template: document.querySelector('.media-theater')?.getAttribute('data-template') || null,
    grips: document.querySelectorAll('.dw .layer-grip').length,
    widgets: document.querySelectorAll('.dw').length,
  }))()`);

  const png = (await win.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(__dirname, 'layer-scale.png'), png);
  out.shot = 'tools/probe/layer-scale.png';

  report(out);
});
