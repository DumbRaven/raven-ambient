/**
 * 读一颗中珠的实际计算样式。用来确认 CSS 到底有没有生效——
 * 截图看着「什么都没变」的时候，先看这里再改数。
 */
const { guard, launch } = require('./harness.cjs');

guard(async () => {
  const { run, close } = await launch({ width: 1280, height: 800 });
  const info = await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const btn = document.querySelector('.theater-rain-toggle'); if (btn) btn.click(); await sleep(300);
    const sw = document.querySelector('.theater-rain-menu .toggle'); if (sw && !sw.classList.contains('on')) sw.click(); await sleep(300);
    const all = [...document.querySelectorAll('.rain-drops > i')];
    const pick = all.find(e => e.dataset.size === 'small') || all[0];
    if (!pick) return 'none';
    const cs = getComputedStyle(pick);
    return {
      total: all.length,
      sizes: { tiny: all.filter(e => e.dataset.size === 'tiny').length, small: all.filter(e => e.dataset.size === 'small').length, big: all.filter(e => e.dataset.size === 'big').length },
      w: pick.getBoundingClientRect().width,
      h: pick.getBoundingClientRect().height,
      bg: cs.backgroundImage,
      bs: cs.boxShadow,
      op: cs.opacity,
      bd: cs.backdropFilter,
      radius: cs.borderRadius,
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
  close();
});
