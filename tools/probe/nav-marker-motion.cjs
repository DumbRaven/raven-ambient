/**
 * 量页面导航栏（.view-tabs）那颗黑色滑块在切页时到底动没动。
 *
 * 为什么单独量：用户 m13292 说「那个切换栏位加个切换动画」，但 CSS 里
 * `.view-tabs > .nav-marker` 早就写了 430ms 的 transition。要么它没生效，
 * 要么它动了但看不出来。这两种情况的修法完全不同，所以先量。
 *
 * 判据：
 *   samples  切换后连拍到的帧数
 *   moved    滑块位移是否大于 8px（小于 8px 就是没动或只抖了一下）
 *   mids     落在起点与终点之间（含 4px 容差）的帧数 —— 真正「动画在跑」的证据
 *   duration 从第一次动到停住的毫秒数
 */
const { launch, report, guard, wait } = require('./harness.cjs');

guard(async () => {
  const { run, shot, close } = await launch({ expand: false, settle: 1800 });

  // 先量起点：当前 active 是「唱片柜」
  const read = `(() => {
    const marker = document.querySelector('.view-tabs > .nav-marker');
    const nav = document.querySelector('.view-tabs');
    if (!marker || !nav) return { error: 'no-marker' };
    const m = marker.getBoundingClientRect(), n = nav.getBoundingClientRect();
    const cs = getComputedStyle(marker);
    const active = nav.querySelector('button.active');
    return {
      x: +(m.left - n.left).toFixed(2),
      w: +m.width.toFixed(2),
      active: active ? active.getAttribute('aria-label') : null,
      transition: cs.transitionProperty + ' ' + cs.transitionDuration,
      ready: nav.getAttribute('data-marker-ready'),
      varX: nav.style.getPropertyValue('--nav-marker-x'),
    };
  })()`;

  const before = await run(read);

  // 点「正在听」，然后用 rAF 连拍记录滑块位置
  const trace = await run(`(async () => {
    const nav = document.querySelector('.view-tabs');
    const marker = nav.querySelector('.nav-marker');
    const navBox = nav.getBoundingClientRect();
    const at = () => +((marker.getBoundingClientRect().left - navBox.left)).toFixed(2);
    const samples = [];
    const t0 = performance.now();
    const button = [...nav.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '正在听');
    button.click();
    await new Promise(done => {
      const tick = () => {
        samples.push({ t: Math.round(performance.now() - t0), x: at() });
        if (performance.now() - t0 < 900) requestAnimationFrame(tick);
        else done(1);
      };
      requestAnimationFrame(tick);
    });
    return samples;
  })()`);

  const after = await run(read);
  await shot('tools/probe/nav-marker-motion.png');

  // 位移与中间帧
  const start = trace[0].x;
  const end = trace[trace.length - 1].x;
  const span = end - start;
  const moved = Math.abs(span) > 8;
  const lo = Math.min(start, end) - 4, hi = Math.max(start, end) + 4;
  const mids = trace.filter(s => s.x > lo && s.x < hi).length;
  const firstMove = trace.find(s => Math.abs(s.x - start) > 0.5);
  const settled = [...trace].reverse().find(s => Math.abs(s.x - end) > 0.5);
  const duration = firstMove && settled ? settled.t - firstMove.t : 0;

  // 顺带量：切页时整个内容区有没有 wipe 动画（data-motion）
  const wipe = await run(`(() => {
    const stage = document.querySelector('.view-stage');
    return stage ? { motion: stage.getAttribute('data-motion'), view: stage.getAttribute('data-view') } : null;
  })()`);

  report({ before, after, width: { start: +start.toFixed(2), end: +end.toFixed(2), span: +span.toFixed(2) }, moved, mids, duration, frames: trace.length, wipe });
  close();
});
