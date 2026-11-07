/**
 * 量「点全屏 → 画面跳几下」。
 *
 * 用户报的现象：点全屏按钮，会先看到页面在窗口内铺满，然后窗口才进真全屏，
 * 像跳了两下。这个探针把两次尺寸变化各自的时间点与时值打出来，判断：
 *   1. 两跳之间隔了多久（如果 < 一帧，用户看不见；如果是几百毫秒，就看得见）
 *   2. 中间那帧的尺寸是多少（是不是正好等于窗口内容区）
 *   3. 主进程 setFullScreen 什么时候真正生效
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/fullscreen-jump.cjs --no-sandbox
 */
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

// 页面侧：点按钮的同时开始按帧记录尺寸，直到 1.4 秒。
// 记三样：window.innerWidth/Height（视口）、.media-room 的 rect、以及
// 有没有 .is-expanded 类（CSS 铺满是不是已经挂上）。
//
// 同样的记录跑两次：先量进入，再量退出。进出是两条独立的路径
// （进入时窗口变大、退出时窗口变小），顺序错了哪一边都会跳，所以两边都得看。
const record = (label, before) => `(async () => {
  const room = document.querySelector('.media-room');
  const btn = document.querySelector('.theater-expand');
  if (!btn) return { error: 'no expand button' };
  ${before}

  const samples = [];
  const t0 = performance.now();
  const tick = () => {
    const r = room.getBoundingClientRect();
    samples.push({
      t: Math.round(performance.now() - t0),
      iw: window.innerWidth,
      ih: window.innerHeight,
      rw: Math.round(r.width),
      rh: Math.round(r.height),
      on: room.classList.contains('is-expanded'),
    });
  };

  tick();
  btn.click();
  // 头 200ms 每帧采一次（抖动都在这儿），之后每 40ms 采到 1400ms。
  await new Promise(done => {
    const loop = () => {
      tick();
      const t = performance.now() - t0;
      if (t > 1400) return done();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  // 把连续相同的采样压掉，只看「尺寸变了」的那些点。
  const edits = [];
  let last = null;
  for (const s of samples) {
    const key = s.iw + 'x' + s.ih + '|' + s.rw + 'x' + s.rh + '|' + s.on;
    if (key === last) continue;
    last = key;
    edits.push(s);
  }
  return { label: '${label}', total: samples.length, edits };
})()`;

guard(async () => {
  const probe = await launch({ expand: false });
  const win = probe.win;

  // 主进程侧也记一笔：窗口真的进/出全屏是哪个时刻。
  const marks = [];
  const t0 = Date.now();
  win.on('enter-full-screen', () => marks.push({ ev: 'enter', t: Date.now() - t0 }));
  win.on('leave-full-screen', () => marks.push({ ev: 'leave', t: Date.now() - t0 }));

  const enter = await probe.run(record('enter', ''));
  // 退出前先确认真的进去了，否则第二次量到的是「从没进去过」的假数据。
  const entered = win.isFullScreen();
  const leave = await probe.run(record('leave', ''));
  const full = win.isFullScreen();
  const size = win.getContentSize();

  report({
    enter,
    leave,
    main: { marks, entered, full, contentSize: size, windowSize: win.getSize() },
  });
});
