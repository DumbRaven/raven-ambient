#!/usr/bin/env node
/**
 * FOCUS 那条横线到底在不在动，以及它为什么看起来不动。
 *
 * 用户 m05853 问：「目前信息栏中 forcus 的这个横线是有什么作用，
 * 是一个进度条的作用吗，我怎么感觉没有在动」。
 *
 * 这条线画的是**本阶段剩余比例**（满格=刚开始，缩到底=本阶段结束）。
 * 实测它确实在走，只是 25 分钟 / 387px 宽 = 每分钟 15.49px，
 * 每 800ms 一拍 0.207px，走满一像素要 3.9 秒。
 *
 * 改法（§9.16）：线加粗到 0.22cqw + 已走部分末端加一个 0.34cqw 的端点圆点。
 * 这个探针同时验三件事：
 *   1. 绑定通不通：拨到 100% / 50% / 4%，看 span 的宽度比例对不对；
 *   2. 圆点有没有被裁掉：量圆点相对整条线的左右边界，探出去的那半个不能溢出格子；
 *   3. 真动起来是什么样：连采若干帧，看像素是不是平滑爬过去的。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/focus-bar-motion.cjs --no-sandbox
 *
 * 前置：`npm.cmd run build`。
 */
const { launch, report, guard, wait } = require('./harness.cjs');

const TOTAL = 25 * 60 * 1000;

const snapshot = remainingMs => ({
  phase: 'focus',
  running: true,
  remaining: remainingMs,
  total: TOTAL,
  rounds: 1,
  roundsBeforeLong: 4,
  visible: true,
  canSkip: true,
  disc: null,
});

/**
 * 读当前宽度与圆点位置。
 *
 * 圆点是 `span::after`，伪元素没有自己的 DOM 节点，所以量不到
 * getBoundingClientRect。这里换个办法：量 `span` 本身的右边界，
 * 再看它加上 `width/2` 的探出量之后有没有超出轨道右边界和 `.tpl-focus` 格子。
 */
const WIDTH = `(() => {
  const bar = document.querySelector('.tpl-focus-bar');
  const fill = bar && bar.firstElementChild;
  const area = document.querySelector('.tpl-focus');
  if (!bar || !fill) return { error: '找不到进度条' };
  const b = bar.getBoundingClientRect();
  const f = fill.getBoundingClientRect();
  const a = area.getBoundingClientRect();
  const cs = getComputedStyle(fill);
  const after = getComputedStyle(fill, '::after');
  // 圆点直径与它相对 fill 右端的位置（transform: translate(50%,-50%)，所以探出半径）
  const dotPx = parseFloat(after.width) || 0;
  return {
    styleWidth: fill.style.width,
    barPx: +b.width.toFixed(1),
    barHeightPx: +b.height.toFixed(2),
    fillPx: +f.width.toFixed(2),
    ratio: +((f.width / b.width) * 100).toFixed(2),
    dotPx: +dotPx.toFixed(2),
    dotContent: after.content,
    dotBg: after.backgroundColor,
    // 圆点右缘（fill 右端 + 半径）相对轨道的溢出量。>0 就是探出格子了
    dotOverflowBarPx: +(f.right + dotPx / 2 - b.right).toFixed(2),
    dotOverflowAreaPx: +(f.right + dotPx / 2 - a.right).toFixed(2),
    transition: cs.transitionProperty + ' ' + cs.transitionDuration,
  };
})()`;

/** 连采一段时间，看它是不是真的在移动。 */
const SAMPLE = ms => `(async () => {
  const bar = document.querySelector('.tpl-focus-bar');
  const fill = bar && bar.firstElementChild;
  if (!bar || !fill) return { error: '找不到进度条' };
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ${ms}) {
    out.push(+fill.getBoundingClientRect().width.toFixed(2));
    await new Promise(r => requestAnimationFrame(r));
  }
  return {
    frames: out.length,
    first: out[0],
    last: out[out.length - 1],
    min: Math.min(...out),
    max: Math.max(...out),
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: true });
  const { run } = probe;

  /**
   * 设快照后等到「目标值与实测值一致」再读。
   *
   * 为什么要等：span 上有 `transition: width 800ms linear`，而 MediaRoom 每
   * 800ms 才轮询一次快照。两个 800ms 叠在一起，固定 wait(2000) 有时能等到、
   * 有时正好卡在过渡里——第一次跑就在这里读到 `styleWidth 100% / ratio 76.13%`。
   * 那个数是过渡中间态，当成「100% 只有 76%」会得出完全错误的结论。
   */
  /**
   * 设快照后等到「目标值与实测值一致」再读。
   *
   * 为什么要等：span 上有 `transition: width 800ms linear`，而 MediaRoom 每
   * 800ms 才轮询一次快照。两个 800ms 叠在一起，固定 wait(2000) 有时能等到、
   * 有时正好卡在过渡里——第一次跑就在这里读到 `styleWidth 100% / ratio 76.13%`。
   *
   * 注意 ratio 对不上有两种完全不同的原因，别混：
   *   ① 还在过渡（再等一会儿就对了）；
   *   ② 有 CSS 把它钳住了（等多久都一样）——`max-width: 30ch` 就干过这事。
   * 所以这里不是「等到对上」，而是「连读若干次都不变」才返回，
   * 顺便把 `min/max` 一起报出来，让人一眼看出是「还没到」还是「到不了」。
   */
  const settle = async (value, label) => {
    await run(`(() => { window.__ravenFocusSnapshot.remaining = ${value}; return 1; })()`);
    // **先等足再判断**：MediaRoom 800ms 轮询一拍，span 上还有 800ms 过渡，
    // 两者叠起来最坏要 1600ms 才走完。不等就直接读，读到的还是上一档的值——
    // 而上一档自己也是自洽的（styleWidth 与 ratio 相等），会立刻被判成「已稳定」。
    await wait(1800);
    let last = null;
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      last = await run(WIDTH);
      if (last.error) {
        // 刚设完快照时 MediaRoom 还没轮到那一拍，进度条**整个不存在**。
        // 这不是失败，继续等下一轮即可。
        await wait(250);
        continue;
      }
      seen.push(+last.ratio.toFixed(2));
      const target = parseFloat(last.styleWidth) || 0;
      // 连读两拍都对得上才算稳定
      if (Math.abs(last.ratio - target) < 0.3) return { label, settled: true, ...last };
      await wait(300);
    }
    return {
      label,
      settled: false,
      // 一直对不上时，把这些读数带出来：完全不变 = 被 CSS 钳死了，不是还在走
      ratios: [...new Set(seen)],
      ...(last ?? { error: '等不到进度条' }),
    };
  };

  // 先让页面拿到初始快照，否则第一次读到的还是「未开始」
  await run(`(() => { window.__ravenFocusSnapshot = ${JSON.stringify(snapshot(TOTAL))}; return 1; })()`);

  const atFull = await settle(TOTAL, 'full');
  const atHalf = await settle(TOTAL / 2, 'half');
  // 尾声：圆点最贴近左端，这时最容易被格子左边界切掉
  const atTail = await settle(Math.round(TOTAL * 0.04), 'tail');

  // 真的让它走一格：改值之后立刻连采 1.5 秒
  await run(`(() => { window.__ravenFocusSnapshot.remaining = ${Math.round(TOTAL * 0.6)}; return 1; })()`);
  const motion = await run(SAMPLE(1500));

  await probe.shot(require('node:path').join(__dirname, 'focus-bar.png'));

  const barPx = atFull.barPx || 0;
  report({
    atFull,
    atHalf,
    atTail,
    motion,
    // 真实速率：25 分钟走满一整条
    pxPerMinute: barPx ? +(barPx / 25).toFixed(2) : null,
    // 每 800ms 一拍走多少像素——这是「看不出来」的量化答案
    pxPerPoll: barPx ? +((barPx / 25) * (0.8 / 60)).toFixed(3) : null,
    // 同上，换成「要多久才看得出动了 1px」
    secondsPerPixel: barPx ? +((25 * 60) / barPx).toFixed(1) : null,
  });
});
