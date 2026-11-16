/**
 * 票根撕开动画的取证：打开浮层，模拟往下拖，分四档拍 + 松手后连拍。
 *
 * 用途是回答「现在到底长什么样」。改动画之前必须先看清现在每一档在做什么，
 * 否则「改成直着往下撕」会变成又一次盲改——这个动画已经改过五版。
 *
 * 拖拽必须用页面内的 PointerEvent：离屏窗口里 sendInputEvent 产生不了
 * pointerdown（AGENTS.md「验证交互效果必须用真实输入事件」记着这条）。
 * 反过来，页面内 dispatchEvent(new MouseEvent('mouseover')) 触发不了 :hover。
 * 两条结论方向相反，不能混用。
 *
 * 2026-11-16 版：方向从「往上」翻成「往下」，phase 从 burning 改成 cutting。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/ticket-now.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'ticket-now');

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  // 进相集页 → 点第一张票 → 浮层出现
  const opened = await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '相集')?.click();
    await sleep(900);
    const ticket = document.querySelector('.ticket');
    if (!ticket) return { error: 'no ticket', tabs: [...document.querySelectorAll('.view-tabs > button')].map(b => b.getAttribute('aria-label')) };
    const btn = ticket.querySelector('button') || ticket;
    btn.click();
    await sleep(900);
    const panel = document.querySelector('.ticket-lift-panel');
    const face = document.querySelector('.ticket-face');
    return {
      hasPanel: !!panel,
      hasFace: !!face,
      tip: document.querySelector('.ticket-tip')?.textContent || null,
      panelRect: panel ? (() => { const b = panel.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })() : null,
    };
  })()`);
  await wait(600);
  await shot(path.join(OUT, '0-idle.png'));

  // 往下拖四档：把 pointerdown → pointermove 打在面板上。
  // dy 取正值 = 手往下走。每档重新 pointerdown，因为上一档的 up 已经结束了。
  const drag = frac => run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const panel = document.querySelector('.ticket-lift-panel');
    if (!panel) return 'no-panel';
    const b = panel.getBoundingClientRect();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height * 0.12;
    const mk = (type, y, extra) => new PointerEvent(type, Object.assign({
      pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1,
      clientX: cx, clientY: y, bubbles: true, cancelable: true,
    }, extra || {}));
    panel.dispatchEvent(mk('pointerdown', cy));
    await sleep(60);
    const travel = b.height * ${JSON.stringify(frac)};
    for (let i = 1; i <= 8; i++) {
      panel.dispatchEvent(mk('pointermove', cy + travel * i / 8));
      await sleep(45);
    }
    await sleep(200);
    const lift = document.querySelector('.ticket-lift');
    const cs = getComputedStyle(panel);
    return {
      drop: lift && lift.style.getPropertyValue('--drop'),
      shape: lift && lift.getAttribute('data-shape'),
      tearable: lift && lift.getAttribute('data-tearable'),
      holding: lift && lift.getAttribute('data-holding'),
      phase: document.querySelector('.ticket-stage')?.getAttribute('data-phase'),
      translate: cs.translate,
    };
  })()`);

  const seen = {};
  for (const [i, frac] of [[1, 0.15], [2, 0.3], [3, 0.44]]) {
    const state = await drag(frac);
    await wait(400);
    await shot(path.join(OUT, `${i}-pull-${Math.round(frac * 100)}.png`));
    seen[`pull${Math.round(frac * 100)}`] = state;
  }

  // 松手（这次拖过了阈值）→ cutting 滑落 → flying 飞走，各拍一帧
  const released = await run(`(() => {
    const panel = document.querySelector('.ticket-lift-panel');
    const b = panel.getBoundingClientRect();
    panel.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0,
      clientX: b.x + b.width / 2, clientY: b.y + b.height * 0.56,
      bubbles: true, cancelable: true,
    }));
    return document.querySelector('.ticket-stage')?.getAttribute('data-phase');
  })()`);
  await wait(90);
  await shot(path.join(OUT, '4-cutting.png'));
  await wait(180);
  await shot(path.join(OUT, '5-cutting-late.png'));
  await wait(360);
  await shot(path.join(OUT, '6-flying.png'));
  await wait(500);
  await shot(path.join(OUT, '7-done.png'));

  console.log(JSON.stringify({ opened, seen, released }, null, 2));
  close();
});
