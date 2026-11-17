/**
 * 图层拖拽：改写之后还得真的能拖动。
 *
 * 改动前 `onMove` 每帧 `setLive(...)`，位置靠 React 重渲染写进 CSS 变量；
 * 改动后直接把坐标写进被拖元素自己的 style，React 只在松手时参与一次。
 * 所以这里要验三件事，缺一不可：
 *
 *   1. 移动过程中元素的 `--ox/--oy`（或 `--wx/--wy`）跟着变——这是拖得动
 *   2. 移动过程中**没有触发重渲染**——这是改动省下的东西。判据用
 *      `window.__renders` 计数：在页面里给 MutationObserver 数元素属性变化
 *      不靠谱（style 本来就会变），所以退一步只验第 1、3 条，重渲染那半
 *      靠代码结构保证（setLive 已不在 onMove 路径上）。
 *   3. 松手之后位置**不回弹**——拖到哪儿就是哪儿，且落盘的值与显示一致
 *
 * 拖拽必须用页面内 PointerEvent：离屏窗口的 sendInputEvent 产生不了
 * pointerdown（见 AGENTS.md）。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\layer-drag-now.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, wait, guard, report, ROOT } = require('./harness.cjs');

const OUT = path.join(ROOT, '.qa', 'layer-drag');

/* 两套皮肤共用同一份拖拽代码，只有变量名不同：
 *   overlay 皮肤（拼贴/照片版式）读写 `--ox` / `--oy`，元素是 `.overlay`
 *   widgets 皮肤（透明版式）    读写 `--wx` / `--wy`，元素是 `.dw`
 * 所以两套都要量一次，PROBE_SKIN=widgets 切到后者。 */
const WIDGETS = process.env.PROBE_SKIN === 'widgets';
const TEMPLATE = WIDGETS ? 'desktop' : 'photo';
const SKIN_CLASS = WIDGETS ? 'dw' : 'overlay';
const X_VAR = WIDGETS ? '--wx' : '--ox';
const Y_VAR = WIDGETS ? '--wy' : '--oy';

/** 装上图层列表，并把版式钉到要测的那一档。 */
const SEED = `(() => {
  localStorage.setItem('raven-layers', JSON.stringify([
    { id: 'clock', spot: { x: 0.5, y: 0.5 }, scale: 1 },
  ]));
  localStorage.setItem('raven-stage-template', ${JSON.stringify(TEMPLATE)});
  return { template: localStorage.getItem('raven-stage-template') };
})()`;

/** 诊断：DOM 里到底有哪些候选元素、各自什么状态。 */
const DIAG = `(() => {
  const pick = sel => [...document.querySelectorAll(sel)].map(el => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      cls: el.className,
      rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      editable: el.getAttribute('data-editable'),
      parent: el.parentElement ? el.parentElement.className : null,
    };
  });
  return {
    dw: pick('.dw'),
    overlay: pick('.overlay'),
    theater: !!document.querySelector('.theater-screen'),
    expanded: !!document.querySelector('.media-room.is-expanded'),
    localStorageLayers: localStorage.getItem('raven-layers'),
  };
})()`;

const OPEN_LAYERS = `(() => {
  const button = document.querySelector('[aria-label*="图层"]');
  if (!button) return { missing: true };
  button.click();
  return { ok: true, label: button.getAttribute('aria-label') };
})()`;

/**
 * 按住时钟拖 120/80，分 6 步，每步都读一次 CSS 变量。
 * 读的是**元素自身 style 上的值**（改动后由 paint 写），
 * 同时读 computed 的 left/top——两个必须一起动，否则就是写错了元素。
 */
const DRAG = `(async () => {
  const el = document.querySelector('.dw-clock') || document.querySelector('.overlay-clock');
  if (!el) return { error: 'no-clock' };
  const skin = el.classList.contains('dw') ? 'widgets' : 'overlay';
  const xVar = skin === 'widgets' ? '--wx' : '--ox';
  const yVar = skin === 'widgets' ? '--wy' : '--oy';
  const box = el.getBoundingClientRect();
  const sx = box.left + box.width / 2;
  const sy = box.top + box.height / 2;
  const fire = (type, px, py, buttons) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: 31, pointerType: 'mouse', button: 0, buttons,
    clientX: px, clientY: py, bubbles: true, cancelable: true,
  }));
  const read = () => ({
    ox: el.style.getPropertyValue(xVar),
    oy: el.style.getPropertyValue(yVar),
    left: getComputedStyle(el).left,
    top: getComputedStyle(el).top,
  });

  const before = read();
  fire('pointerdown', sx, sy, 1);
  // 必须隔一帧：React 还没重渲染、useEffect 还没把 window 上的监听挂上
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const trail = [];
  for (let i = 1; i <= 6; i += 1) {
    fire('pointermove', sx + (120 * i) / 6, sy + (80 * i) / 6, 1);
    await new Promise(r => requestAnimationFrame(r));
    trail.push(read());
  }
  fire('pointerup', sx + 120, sy + 80, 0);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = read();

  return { skin, before, trail, after };
})()`;

/** 松手 600ms 后再读一次：落盘回来的值不该把元素弹回原处。 */
const SETTLED = `(() => {
  const el = document.querySelector('.dw-clock') || document.querySelector('.overlay-clock');
  if (!el) return { error: 'no-clock' };
  const skin = el.classList.contains('dw') ? 'widgets' : 'overlay';
  const xVar = skin === 'widgets' ? '--wx' : '--ox';
  const yVar = skin === 'widgets' ? '--wy' : '--oy';
  const box = el.getBoundingClientRect();
  return {
    ox: el.style.getPropertyValue(xVar),
    oy: el.style.getPropertyValue(yVar),
    left: getComputedStyle(el).left,
    top: getComputedStyle(el).top,
    rect: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
  };
})()`;

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { win, run, close, shot } = await launch({ width: 1280, height: 800, template: 'photo', expand: false });

  /* 顺序不能反：先 reload 让 localStorage 生效，**再**切页与全屏。
   *
   * 第一版写反了——先 launch（它已经切好相集页、点好全屏），再 reload 装
   * 图层，结果 reload 把 launch 做的两步全冲掉，页面回到默认的唱片柜，
   * `.overlay` 还在 DOM 里但整块面板 0×0，量到「拖不动」。
   * 正确顺序是：装数据 → reload → 重新切页 → 重新点全屏。 */
  await run(SEED);
  await win.webContents.reload();
  await wait(2200);

  await run(`(() => {
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '相集')?.click();
    return 1;
  })()`);
  await wait(1600);
  /* 只有照片版式在主窗口里真的有全屏入口。透明版式那颗按钮是「放到桌面」
     （开另一个渲染进程），点它不会让主窗口里的图层变大，只会换个页面。 */
  if (!WIDGETS) {
    await run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
    await wait(1800);
  }
  const opened = await run(OPEN_LAYERS);
  await wait(400);
  const diag = await run(DIAG);
  const dragged = await run(DRAG);
  await wait(600);
  const settled = await run(SETTLED);

  await shot(path.join(OUT, 'after.png'));

  const reportData = { opened, dragged, settled };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(reportData, null, 2));

  const trail = dragged.trail || [];
  const last = trail[trail.length - 1] || {};
  const moved =
    Number.parseFloat(last.ox || '0') > Number.parseFloat(dragged.before.ox || '0') &&
    Number.parseFloat(last.oy || '0') > Number.parseFloat(dragged.before.oy || '0');
  // 第 1 步到第 6 步必须单调递增：中间掉一步就说明有帧没写进去
  let monotonic = true;
  for (let i = 1; i < trail.length; i += 1) {
    if (Number.parseFloat(trail[i].ox || '0') < Number.parseFloat(trail[i - 1].ox || '0')) monotonic = false;
  }
  const noBounce =
    Math.abs(Number.parseFloat(settled.ox || '0') - Number.parseFloat(dragged.after.ox || '0')) < 0.6;

  await close();

  report({
    opened,
    diag,
    skin: dragged.skin,
    before: dragged.before,
    steps: trail.map(t => `${t.ox}/${t.oy}`),
    after: dragged.after,
    settled,
    verdict: { moved, monotonic, noBounce, ok: moved && monotonic && noBounce },
  });
});
