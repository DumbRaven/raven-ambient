/**
 * 审计：数一数水珠实际渲染成了什么样。
 *
 * 回答的是「浏览器最后把它画成了什么」，而不是「CSS 里写了什么」——
 * 材质这类东西上这两个经常不是一回事（backdrop-filter 被 backdrop root 废掉、
 * SVG 滤镜没加载、动画把 opacity 覆盖掉，全都能通过读源码看不出来）。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-audit.cjs --no-sandbox
 */
const { guard, launch } = require('./harness.cjs');

guard(async () => {
  const { run, close } = await launch({ width: 1280, height: 800, template: 'collage', expand: true });

  await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('.theater-rain-toggle').click();
    await sleep(220);
    const sw = document.querySelector('.theater-rain-menu .toggle');
    if (sw && !sw.classList.contains('on')) sw.click();
    await sleep(220);
    // 模式按钮没有 aria-label，只有 role=radio + 文本
    const pick = [...document.querySelectorAll('.rain-modes > button')]
      .find(b => b.textContent.trim() === '水珠');
    if (pick) pick.click();
    await sleep(160);
    const veil = document.querySelector('.theater-overlay-veil');
    if (veil) veil.click();
    return 1;
  })()`);
  await new Promise(r => setTimeout(r, 1600));

  const out = await run(`(() => {
    const drops = [...document.querySelectorAll('.rain-drops > i')];
    const layer = document.querySelector('.rain-layer');
    const lcs = layer ? getComputedStyle(layer) : null;
    // 随机抽位置均匀的几颗，避免只看前几颗（前几颗的坐标是伪随机序列头部，不具代表性）
    const picks = [0, 17, 34, 51, 68, 85, 102, 119].map(i => drops[i]).filter(Boolean);
    return {
      total: drops.length,
      big: drops.filter(d => d.dataset.size === 'big').length,
      hang: drops.filter(d => d.dataset.kind === 'hang').length,
      layerOpacity: lcs && lcs.opacity,
      layerFilter: lcs && lcs.filter,
      sample: picks.map(el => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          kind: el.dataset.kind,
          size: el.dataset.size,
          w: +r.width.toFixed(1),
          h: +r.height.toFixed(1),
          opacity: cs.opacity,
          backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
          anim: cs.animationName,
          dur: cs.animationDuration,
        };
      }),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  close();
});
