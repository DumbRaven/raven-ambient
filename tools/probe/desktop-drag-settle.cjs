/**
 * 桌面窗里拖组件，量「松手之后有没有先弹回原位」。
 *
 * 复现的是用户 m12322 报的现象：
 *   「我发现在桌面上调整小组件，就会先弹回原位再瞬移到我指定的位置」
 *
 * 成因：桌面窗是另一个渲染进程，松手以后位置要绕一圈才回来——
 *   发命令 → 主进程 200ms 轮询取走 → 主窗口落盘 → 再发快照 → 主进程再推回来。
 * 这一整圈里桌面窗手上的还是旧坐标，于是先弹回原位、等快照到了再瞬移过去。
 *
 * 判据：松手之后**逐帧采样**元素的 left/top，任何时候都不该落回原位。
 * 只量「松手后某一时刻」不够——瞬移是发生在中间某一两帧里的事。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\desktop-drag-settle.cjs --no-sandbox
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { launch, wait, guard, ROOT } = require('./harness.cjs');
// 桌面窗那个轮询器住在 desktop-stage.cjs 里，只有 attach 之后主进程才会去取快照、
// 推给桌面窗。不 attach 的话窗口会一直是 blank（第一版就是这么量到 no-clock 的）。
const { attachDesktopStage } = require('../../electron/desktop-stage.cjs');

const PICK_DESKTOP = `(() => {
  const buttons = [...document.querySelectorAll('.theater-templates > button')];
  const target = buttons.find(button => (button.textContent || '').includes('透明'));
  if (!target) return { clicked: false };
  target.click();
  return { clicked: true, labels: buttons.map(button => (button.textContent || '').trim()) };
})()`;

const OPEN_DESKTOP = `(() => {
  const button = document.querySelector('.theater-expand');
  if (!button) return { missing: true };
  const label = button.getAttribute('aria-label');
  button.click();
  return { label };
})()`;

/**
 * 在桌面窗里按住时钟、拖 160/90，然后**从松手那一刻起逐帧记录位置**。
 *
 * 关键点：记录必须发生在 pointerup **之后**的每一帧（rAF），而不是等一圈
 * 回来再看结果——那时候早就瞬移完了，什么都量不到。
 */
const DRAG_AND_WATCH = `(async () => {
  const el = document.querySelector('.dw-clock');
  if (!el) return { error: 'no-clock' };
  const start = el.getBoundingClientRect();
  const x = start.left + start.width / 2;
  const y = start.top + start.height / 2;
  const fire = (type, px, py) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: 21, pointerType: 'mouse', button: 0, buttons: 1,
    clientX: px, clientY: py, bubbles: true, cancelable: true,
  }));

  fire('pointerdown', x, y);
  // 必须隔一帧：React 还没重渲染、useEffect 还没把 window 上的监听挂上
  await new Promise(r => setTimeout(r, 260));
  fire('pointermove', x + 160, y + 90);
  await new Promise(r => setTimeout(r, 60));

  // 松手，同时开始逐帧采样
  const frames = [];
  let stop = false;
  const sample = () => {
    const box = el.getBoundingClientRect();
    frames.push({ t: Math.round(performance.now()), x: Math.round(box.left), y: Math.round(box.top) });
    if (!stop) requestAnimationFrame(sample);
  };
  fire('pointerup', x + 160, y + 90);
  requestAnimationFrame(sample);

  // 等一圈走完（主进程 200ms 轮询 + 主窗口渲染 + 再推回来）
  await new Promise(r => setTimeout(r, 1400));
  stop = true;

  const expect = { x: Math.round(start.left + 160), y: Math.round(start.top + 90) };
  const origin = { x: Math.round(start.left), y: Math.round(start.top) };
  // 「落回原位」的判据：某一帧离原位不到 8px，而且不是最开始那一帧
  const fellBack = frames
    .filter((frame, index) => index > 0)
    .filter(frame => Math.abs(frame.x - origin.x) < 8 && Math.abs(frame.y - origin.y) < 8)
    .map(frame => ({ t: frame.t, x: frame.x, y: frame.y }));
  const last = frames[frames.length - 1];
  return {
    origin,
    expect,
    frames: frames.length,
    fellBackFrames: fellBack.length,
    fellBackSample: fellBack.slice(0, 4),
    final: last,
    landed: Math.abs(last.x - expect.x) <= 2 && Math.abs(last.y - expect.y) <= 2,
    trail: frames.filter((frame, index) => index % 6 === 0).slice(0, 20),
  };
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'collage', expand: true, settle: 2600 });
  const { win, run } = probe;
  attachDesktopStage(win);
  const out = {};

  out.before = await run(`({ expandLabel: document.querySelector('.theater-expand')?.getAttribute('aria-label') })`);

  // 切到透明版式，那边才有组件皮肤
  out.switched = await run(PICK_DESKTOP);
  await wait(900);

  out.opened = await run(OPEN_DESKTOP);
  await wait(1600);

  const deskWin = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('desktop.html'));
  if (!deskWin) {
    out.error = 'desktop window missing';
  } else {
    // 先看桌面窗到底画到了什么：空台面 / 皮肤不对 / 快照还没到，都会让下面量不到 .dw-clock
    out.state = await deskWin.webContents.executeJavaScript(`({
      loading: document.readyState,
      stage: !!document.querySelector('.desktop-stage:not(.desktop-stage-blank)'),
      blank: !!document.querySelector('.desktop-stage-blank'),
      template: document.querySelector('.media-theater')?.getAttribute('data-template') || '',
      dw: document.querySelectorAll('.dw').length,
      overlay: document.querySelectorAll('.overlay').length,
      empty: !!document.querySelector('.desktop-widgets-empty'),
      body: [innerWidth, innerHeight],
    })`, true);
    out.drag = await deskWin.webContents.executeJavaScript(DRAG_AND_WATCH, true);
    const png = (await deskWin.webContents.capturePage()).toPNG();
    const shot = path.join(ROOT, 'tools', 'probe', 'desktop-drag-settle.png');
    fs.writeFileSync(shot, png);
    out.shot = shot;
  }

  console.log(JSON.stringify(out));
  app.exit(0);
});
