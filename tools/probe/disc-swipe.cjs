/**
 * 量唱片左右滑动切歌的接线：手势能不能进来、跟手位移走不走、松手回不回位。
 *
 * 跑法：node_modules/electron/dist/electron.exe tools/probe/disc-swipe.cjs --no-sandbox
 * （Electron 直跑前要清掉 ELECTRON_RUN_AS_NODE，见 harness 文件头。）
 *
 * 为什么在页面里 dispatchEvent 而不是 sendInputEvent：
 * `sendInputEvent({type:'mouseDown'})` 产生的是 mousedown，**不是** pointerdown，
 * React 那边的 onPointerDown 收不到，量到的永远是「没反应」。要造 pointer 事件
 * 只能在页面里 `new PointerEvent(...)` 再 dispatch。这条和长按拖拽那轮是同一条。
 *
 * 为什么两种状态只起一个窗口：`protocol.handle` 每个进程只能注册一次，
 * 第二次 launch() 会报 `Failed to register protocol: media`；
 * 而且 `close()` 直接 app.exit(0)，进程都没了。所以改写 localStorage
 * 再 reload —— 和 ambient.cjs 那轮同样的做法。
 *
 * 判据（三段）：
 *   1. 切不了的时候（队列只有一首或没有）：没有 `is-swipable`、
 *      computed `pointer-events: none`，拖它也不动。
 *   2. 能切的时候：`is-swipable` 在、`pointer-events: auto`、`touch-action: none`、
 *      `cursor: grab`；按住拖期间 `is-swiping` 在、`--disc-drag` 跟着走且钳在 ±16。
 *   3. 松手后 `is-swiping` 撤掉、`--disc-drag` 回 0。
 */
const path = require('node:path');
const { guard, launch, report, wait } = require('./harness.cjs');

const READ = `(() => {
  const el = document.querySelector('.tpl-disc');
  if (!el) return { error: 'no disc' };
  const cs = getComputedStyle(el);
  return {
    swipable: el.classList.contains('is-swipable'),
    swiping: el.classList.contains('is-swiping'),
    drag: el.style.getPropertyValue('--disc-drag') || '',
    translate: cs.translate,
    pointerEvents: cs.pointerEvents,
    touchAction: cs.touchAction,
    cursor: cs.cursor,
  };
})()`;

/** 在唱片上走一段手势。dx 是横向位移，dy 是纵向抖动。 */
const swipe = (dx, dy = 0) => `(() => {
  const el = document.querySelector('.tpl-disc');
  const r = el.getBoundingClientRect();
  const x0 = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  const base = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: x0, clientY: y0 }));
  /* 分几步走，更接近真手指；只发一发也能触发，但拿不到中间的跟手值。 */
  const steps = 6;
  for (let i = 1; i <= steps; i += 1) {
    el.dispatchEvent(new PointerEvent('pointermove', {
      ...base, clientX: x0 + (${dx} * i) / steps, clientY: y0 + (${dy} * i) / steps,
    }));
  }
  return 1;
})()`;

const lift = `(() => {
  const el = document.querySelector('.tpl-disc');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true,
    button: 0, buttons: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
  }));
  return 1;
})()`;

/** 改柜子里的队列长度然后重载，用来在「能切」和「不能切」之间来回。 */
const queue = length => `(() => {
  const raw = JSON.parse(localStorage.getItem('raven-cabinet-v2') || '{}');
  raw.queue = (raw.records || []).slice(0, ${length}).map(r => r.id);
  localStorage.setItem('raven-cabinet-v2', JSON.stringify(raw));
  return 1;
})()`;

/* 队列里放两条「音乐」唱片。canSkipDisc 只看 `queue.length > 1`，
   不需要真能播——这里量的是手势层接没接上，不是播放器。
   sanitizeCabinet 会按 records 过滤 queue，所以记录必须造出来，
   光写 queue 会被整条丢掉（探针写坏柜子的老坑）。 */
const MUSIC = [1, 2].map(i => ({
  id: `fake-${i}`,
  assetId: `asset-${i}`,
  name: `Swipe ${i}`,
  artist: 'Probe',
  description: '',
  category: 'music',
  duration: 120,
  format: 'MP3',
  size: 1,
  color: '#9a8b78',
  fingerprint: `fake-${i}`,
  volume: 60,
  pan: 0,
  warmth: 0,
  duckDepth: 9,
}));

guard(async () => {
  const out = {};

  /* 先起「能切」的状态：队列两条，canSkipDisc 为真。 */
  const probe = await launch({ expand: true, patch: { records: MUSIC, queue: ['fake-1', 'fake-2'] } });
  const { run, shot, win } = probe;
  const reload = async () => { await win.webContents.reload(); await wait(2600); };

  /* ---- 第二段：能切 ---- */
  out.live = await run(READ);
  await run(swipe(-220));
  out.liveMidDrag = await run(READ);
  await run(lift);
  await wait(260);
  out.liveAfterLift = await run(READ);

  /* 纵向占优的斜滑：跟手照样该走（手势层不该因为纵向分量卡住），
     但松手不切歌——那一条由单元测试判断，探针这里只看跟手与复位。 */
  await run(swipe(-60, 90));
  out.liveDiagonal = await run(READ);
  await run(lift);
  await wait(260);
  out.liveAfterDiagonal = await run(READ);

  await shot(path.join(__dirname, 'disc-swipe.png'));

  /* ---- 第一段：切不了 ---- */
  await run(queue(1));
  await reload();
  out.idle = await run(READ);
  await run(swipe(-140));
  out.idleAfterDrag = await run(READ);
  await run(lift);
  await wait(260);
  out.idleAfterLift = await run(READ);

  report(out);
});
