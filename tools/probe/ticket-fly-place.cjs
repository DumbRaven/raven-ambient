/**
 * 探针：非全屏时，票面画面「飞进放映台」的落点对不对（用户 m14515 第 2 条）。
 *
 * 报的 bug 是「这个视频放到放映机的动画位置是错的，而且每个模式它位置也不一样」。
 * 根因是三种版式的画面块根本不是同一个矩形：
 *   拼贴 → `.tpl-block-media`（只占屏幕左上 63%×65%）
 *   相集 → `.tpl-photo-media`（铺满）
 *   透明 → 没有画面块，只能退回幕布
 * 所以这个探针要证明：算出来的落点 ≡ 该版式画面块的矩形。
 *
 * **必须拿「起跳前」的矩形算落点**。飞行用的是 CSS transition（520ms），
 * 飞行途中 `getBoundingClientRect()` 返回的是已经平移缩放过的位置——
 * 第一版就是这么量的，回头再 `+ dx` 等于加了两遍，量出一堆假的 -96px。
 * 所以 idle 阶段先记一份 `from`，之后只读 `--fly-*` 三个数，落点自己算：
 * `transform-origin: 0 0` + 先 translate 再 scale ⇒ 左上 = from.左上 + (dx, dy)，
 * 宽高 = from.宽高 × scale。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-fly-place.cjs --no-sandbox
 */
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const PICK = name => `
  (() => {
    const button = [...document.querySelectorAll('.theater-templates > button')]
      .find(node => node.textContent.trim() === ${JSON.stringify(name)});
    if (!button) return 'missing';
    button.click();
    return 'clicked';
  })()
`;

const OPEN = `(async () => {
  const card = document.querySelector('.ticket-grid .ticket');
  if (!card) return { error: 'no-card' };
  card.click();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return 'opened';
})()`;

/** 起跳前那一块的位置。浮层入场动画 320ms，等它落定再量。 */
const READ_FROM = `(() => {
  const lift = document.querySelector('.ticket-lift');
  const shot = document.querySelector('.ticket-lift-shot');
  if (!shot) return { error: 'no-shot' };
  const r = shot.getBoundingClientRect();
  return {
    phase: document.querySelector('.ticket-stage')?.dataset.phase ?? null,
    lift: lift ? { w: +lift.getBoundingClientRect().width.toFixed(1) } : null,
    from: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
  };
})()`;

/** 按住票根往上拖够，触发烧 → 飞。 */
const TEAR = `(async () => {
  const panel = document.querySelector('.ticket-lift-panel');
  if (!panel) return { error: 'no-panel' };
  const box = panel.getBoundingClientRect();
  const x = box.x + box.width / 2;
  const y0 = box.y + box.height * 0.7;
  const opts = { pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true, buttons: 1 };
  panel.setPointerCapture = () => {};
  panel.releasePointerCapture = () => {};
  panel.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x, clientY: y0 }));
  for (let i = 1; i <= 6; i += 1) {
    await new Promise(r => requestAnimationFrame(r));
    panel.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: x, clientY: y0 - (260 * i) / 6 }));
  }
  panel.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: x, clientY: y0 - 260 }));
  return 'torn';
})()`;

/**
 * 只读飞行参数与三种候选块。**飞行途中不读画面矩形的绝对值**（会读到中间态），
 * 但 `--fly-*` 是写死的变量，什么时候读都一样。
 */
const READ_FLY = `(() => {
  const box = node => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const lift = document.querySelector('.ticket-lift');
  if (!lift) return { error: 'no-lift' };
  const style = getComputedStyle(lift);
  const num = name => parseFloat(style.getPropertyValue(name)) || 0;
  return {
    phase: document.querySelector('.ticket-stage')?.dataset.phase ?? null,
    fly: {
      dx: +num('--fly-x').toFixed(1),
      dy: +num('--fly-y').toFixed(1),
      scale: +(parseFloat(style.getPropertyValue('--fly-scale')) || 1).toFixed(3),
    },
    screen: box(document.querySelector('.theater-screen')),
    block: box(document.querySelector('.tpl-block-media')),
    photo: box(document.querySelector('.tpl-photo-media')),
  };
})()`;

/** 落点与目标块的四边差，越小越好。探针算，不靠眼睛。 */
function diff(landed, target) {
  if (!landed || !target) return null;
  return {
    left: +(landed.x - target.x).toFixed(1),
    top: +(landed.y - target.y).toFixed(1),
    w: +(landed.w - target.w).toFixed(1),
    h: +(landed.h - target.h).toFixed(1),
  };
}

guard(async () => {
  const media = seedImages(6);
  // expand:false —— 用户 m14515 报的就是「软件不全屏」时落点错。
  const probe = await launch({
    width: 1280, height: 900, template: 'collage', expand: false, settle: 1600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run } = probe;
  const out = {};

  for (const [label, name] of [['collage', '拼贴'], ['photo', '相集'], ['desktop', '透明']]) {
    await run(PICK(name));
    await wait(420);

    await run(OPEN);
    await wait(520); // 浮层入场 320ms + 余量
    const start = await run(READ_FROM);
    if (start.error) { out[label] = start; continue; }

    await run(TEAR);
    await wait(1050); // ASH_MS = 900，之后才进 flying
    const fly = await run(READ_FLY);
    if (fly.error) { out[label] = fly; continue; }

    const landed = {
      x: +(start.from.x + fly.fly.dx).toFixed(1),
      y: +(start.from.y + fly.fly.dy).toFixed(1),
      w: +(start.from.w * fly.fly.scale).toFixed(1),
      h: +(start.from.h * fly.fly.scale).toFixed(1),
    };
    const target = fly.block || fly.photo || fly.screen;
    out[label] = {
      phase: fly.phase,
      liftWidth: start.lift?.w,
      from: start.from,
      fly: fly.fly,
      landed,
      target,
      diff: diff(landed, target),
    };

    // 等飞完、浮层关掉，再做下一种版式。
    await wait(1400);
  }

  report(out);
});
