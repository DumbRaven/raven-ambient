/**
 * 探针：控制条那三件事（用户 m11693 的三条）。
 *
 *   1. 透明版式下，全屏键变成「放到桌面」；
 *   2. 全屏时组件也能拖（原来是只有主窗口非全屏预览能拖）；
 *   3. 「叠加元素」与「加组件」合并成一颗按钮，菜单内容随版式切换。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules/electron/dist/electron.exe tools/probe/layers-button.cjs --no-sandbox
 *
 * 为什么要点胶囊/按钮而不是直接读 state：这三条都是「用户点什么会发生什么」，
 * 读 CSS 只能证明样式对，证明不了接线对。所以每一步都真点。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait } = require('./harness.cjs');

/** 读控制条上那几颗按钮现在长什么样。 */
const READ_BAR = `(() => {
  const bar = document.querySelector('.theater-bar');
  if (!bar) return { error: 'no-bar' };
  const pick = sel => {
    const el = bar.querySelector(sel);
    if (!el) return null;
    return {
      label: el.getAttribute('aria-label'),
      pressed: el.getAttribute('aria-pressed'),
      title: el.getAttribute('title'),
      icon: el.querySelector('svg')?.getAttribute('class') || null,
    };
  };
  const layers = bar.querySelector('.theater-overlays');
  const menu = layers?.querySelector('.theater-overlay-menu');
  return {
    layersButton: pick('.theater-overlay-toggle'),
    layersOpen: !!menu,
    menuItems: menu ? [...menu.querySelectorAll(':scope > button')].map(b => ({
      name: b.querySelector('b')?.textContent?.trim() || '',
      checked: b.getAttribute('aria-checked'),
      dot: !!b.querySelector('.overlay-dot'),
    })) : [],
    menuTip: menu?.querySelector('.theater-overlay-tip')?.textContent?.trim() || '',
    expandButton: pick('.theater-expand'),
    // 合并之后这两颗不该再存在
    staleWidgets: !!bar.querySelector('.theater-widgets'),
    staleDesktop: !!bar.querySelector('.theater-desktop'),
    widgetCount: document.querySelectorAll('.dw').length,
  };
})()`;

/** 点开图层按钮，再点第一项。 */
const OPEN_LAYERS = `(() => {
  document.querySelector('.theater-overlays .theater-overlay-toggle')?.click();
  return 1;
})()`;

const CLOSE_LAYERS = `(() => {
  document.querySelector('.theater-overlays .theater-overlay-veil')?.click();
  return 1;
})()`;

/** 换版式：直接点控制条上那颗（和用户一样）。 */
const PICK_TEMPLATE = name => `(() => {
  [...document.querySelectorAll('.theater-templates > button')]
    .find(b => b.textContent.trim() === ${JSON.stringify(name)})?.click();
  return 1;
})()`;

/**
 * 拖一块组件。**必须分帧派发**：pointerdown 之后 React 要重渲染、effect 要绑监听，
 * 同一个 tick 里连发 pointermove 会整段丢掉（实测「一动不动」）。
 */
const DRAG = (id, dx, dy) => `(async () => {
  const el = document.querySelector('.dw-' + ${JSON.stringify(id)});
  if (!el) return { error: 'no-widget' };
  const box = el.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const before = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const fire = (type, px, py) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1,
    clientX: px, clientY: py, bubbles: true, cancelable: true,
  }));
  fire('pointerdown', x, y);
  await new Promise(r => setTimeout(r, 260));
  fire('pointermove', x + ${dx}, y + ${dy});
  await new Promise(r => setTimeout(r, 60));
  fire('pointerup', x + ${dx}, y + ${dy});
  await new Promise(r => setTimeout(r, 260));
  const after = el.getBoundingClientRect();
  return {
    before,
    after: { x: after.left + after.width / 2, y: after.top + after.height / 2 },
    movedX: Math.round(after.left - box.left),
    movedY: Math.round(after.top - box.top),
  };
})()`;

/** 主窗口那份存档（localStorage）里，时钟那块的坐标。 */
const STORED_SPOT = `(() => {
  const raw = localStorage.getItem('raven-desktop-widgets');
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    const clock = list.find(w => w.id === 'clock');
    return clock ? clock.spot : null;
  } catch {
    return null;
  }
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'collage', expand: true, settle: 2600 });
  const { run, win } = probe;
  const out = {};

  // ---- 1. 拼贴版式：按钮管叠加元素，全屏键就是全屏键
  out.collage = await run(READ_BAR);
  await run(OPEN_LAYERS);
  await wait(260);
  out.collageMenu = await run(READ_BAR);
  await run(CLOSE_LAYERS);
  await wait(180);

  // ---- 2. 切到透明版式：按钮改管组件，全屏键变「放到桌面」
  await run(PICK_TEMPLATE('透明'));
  await wait(900);
  out.desktop = await run(READ_BAR);

  // 点开菜单：应该变成六项组件
  await run(OPEN_LAYERS);
  await wait(260);
  out.desktopMenu = await run(READ_BAR);

  // 加一块「曲目」：数量从默认两块变三块
  await run(`(() => {
    const menu = document.querySelector('.theater-overlay-menu');
    [...menu.querySelectorAll(':scope > button')]
      .find(b => b.querySelector('b')?.textContent?.trim() === '曲目')?.click();
    return 1;
  })()`);
  await wait(320);
  out.afterAdd = await run(READ_BAR);
  await run(CLOSE_LAYERS);
  await wait(180);

  // ---- 3. 全屏时拖组件（原本只有非全屏预览能拖）
  out.fullscreen = await run(`(() => ({
    expanded: !!document.querySelector('.media-room.is-expanded'),
    editable: document.querySelector('.desktop-widgets')?.getAttribute('data-editable') || null,
  }))()`);

  // 先记下原来的位置，拖完再看变化与落盘
  const beforeSpot = await run(STORED_SPOT);
  out.drag = await run(DRAG('clock', 150, 90));
  await wait(400);
  const afterSpot = await run(STORED_SPOT);
  out.spot = { before: beforeSpot, after: afterSpot };

  const png = (await win.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(__dirname, 'layers-button.png'), png);
  out.shot = 'tools/probe/layers-button.png';

  report(out);
});
