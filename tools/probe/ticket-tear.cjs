/**
 * 探针：相集票根的新交互（用户 m14144）。
 *
 * 要证明五件事：
 *   1. 一列（不是早先的 auto-fit 多列），一页八张、翻页条在；
 *   2. 点票之后浮起一张（`.ticket-stage` 出现，`data-phase="idle"`），**不换台**；
 *   3. 按住票根往上拖但没拖够 → 弹回去（`--pull` 归零、还是 idle、仍在浮层里）；
 *   4. 拖够 → `burning`，出现灰烬粒子；接着 `flying`，最后浮层关掉并进了播放台；
 *   5. 拖拽只认票根那半边（在画面上按不会撕）。
 *
 * 为什么要自己造十八张图：harness 的 CABINET 只放一件媒体，一页八张的翻页
 * 永远不会出现——不补素材，这探针量到的东西全是常量。
 *
 * 拖拽必须用页面内 dispatchEvent 派 PointerEvent：Electron 的
 * sendInputEvent({type:'mouseDown'}) 产生不了 pointerdown（这条在交接文档里记过，
 * 两者结论相反，别混用）。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-tear.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

/** 网格与浮层的概况。 */
const READ = `(() => {
  const grid = document.querySelector('.ticket-grid');
  const stage = document.querySelector('.ticket-stage');
  const cards = grid ? [...grid.querySelectorAll('.ticket')] : [];
  const lift = document.querySelector('.ticket-lift');
  const liftRect = lift?.getBoundingClientRect();
  const shotRect = document.querySelector('.ticket-lift-shot')?.getBoundingClientRect();
  return {
    columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    count: cards.length,
    rows: new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size,
    ids: grid ? [...grid.querySelectorAll('li')].map(li => li.dataset.id) : [],
    ticketAspect: cards.length
      ? +(cards[0].getBoundingClientRect().width / cards[0].getBoundingClientRect().height).toFixed(3)
      : 0,
    stage: stage ? stage.dataset.phase : null,
    pull: lift ? getComputedStyle(lift).getPropertyValue('--pull').trim() : null,
    ash: document.querySelectorAll('.ticket-ash i').length,
    lift: liftRect ? { w: Math.round(liftRect.width), h: Math.round(liftRect.height) } : null,
    shotShare: liftRect && shotRect ? +(shotRect.width / liftRect.width).toFixed(3) : null,
    current: document.querySelector('.ticket.is-current')?.closest('li')?.dataset.id || null,
    barTitle: document.querySelector('.theater-copy b')?.textContent || null,
    pages: document.querySelectorAll('.ticket-pager .pager-numbers button').length,
  };
})()`;

const CLICK_TICKET = index => `(() => {
  const card = [...document.querySelectorAll('.ticket-grid .ticket')][${index}];
  if (!card) return { error: 'no-card' };
  card.click();
  return card.closest('li').dataset.id;
})()`;

/**
 * 在票根那半边上按下、往上拖 dy 像素、松手。
 *
 * 分帧派发：一次性 move 到底，浏览器没有中间帧，`--pull` 只会瞬移，
 * 量不出「跟着手上走」这件事。
 */
const DRAG = (dy, steps = 6) => `(async () => {
  const panel = document.querySelector('.ticket-lift-panel');
  if (!panel) return { error: 'no-panel' };
  const box = panel.getBoundingClientRect();
  const x = box.x + box.width / 2;
  const y0 = box.y + box.height * 0.7;
  const opts = { pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true, buttons: 1 };
  panel.setPointerCapture = () => {};
  panel.releasePointerCapture = () => {};
  panel.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x, clientY: y0 }));
  await new Promise(r => requestAnimationFrame(r));
  const midPulls = [];
  for (let i = 1; i <= ${steps}; i += 1) {
    panel.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: x, clientY: y0 - (${dy} * i) / ${steps} }));
    await new Promise(r => requestAnimationFrame(r));
    const lift = document.querySelector('.ticket-lift');
    midPulls.push(lift ? getComputedStyle(lift).getPropertyValue('--pull').trim() : null);
  }
  panel.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: x, clientY: y0 - ${dy} }));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { midPulls, panelHeight: Math.round(box.height), dy: ${dy} };
})()`;

/** 在画面上按同样距离拖一次——按理不该撕（拖拽只绑在票根上）。 */
const DRAG_ON_SHOT = (dy) => `(async () => {
  const shot = document.querySelector('.ticket-lift-shot');
  if (!shot) return { error: 'no-shot' };
  const box = shot.getBoundingClientRect();
  const x = box.x + box.width / 2;
  const y0 = box.y + box.height * 0.7;
  const opts = { pointerId: 2, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true, buttons: 1 };
  shot.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x, clientY: y0 }));
  shot.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: x, clientY: y0 - ${dy} }));
  shot.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: x, clientY: y0 - ${dy} }));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { stage: document.querySelector('.ticket-stage')?.dataset.phase || null };
})()`;

guard(async () => {
  const media = seedImages(18);
  // expand:false —— 全屏时网格 display:none，量到全是 0（上一版踩过）。
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;
  const out = {};

  out.list = await run(READ);

  // ---- 点第一张：浮起，不换台
  out.openedId = await run(CLICK_TICKET(0));
  await wait(420);
  out.lifted = await run(READ);

  // ---- 没拖够：弹回去，还在浮层里
  out.shortDrag = await run(DRAG(40));
  await wait(320);
  out.afterShort = await run(READ);

  // ---- 在画面上拖：不该撕
  out.dragOnShot = await run(DRAG_ON_SHOT(200));
  await wait(200);
  out.afterShotDrag = await run(READ);

  // ---- 拖够：烧 → 飞 → 换台
  out.longDrag = await run(DRAG(260));
  await wait(80);
  out.burning = await run(READ);
  const png = (await win.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(__dirname, 'ticket-burning.png'), png);
  out.burningShot = 'tools/probe/ticket-burning.png';

  await wait(700);
  out.flying = await run(READ);
  await wait(900);
  out.settled = await run(READ);
  out.expected = out.openedId;

  const png2 = (await win.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(__dirname, 'ticket-after.png'), png2);
  out.afterShot = 'tools/probe/ticket-after.png';

  report(out);
});
