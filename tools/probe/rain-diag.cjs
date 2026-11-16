/**
 * 雨层诊断：水珠的 backdrop-filter 到底有没有采到背后的画面。
 *
 * 怀疑点：`.rain-layer` 上有 `opacity: var(--rain-opacity, 0.7)`。
 * 按规范，opacity < 1 会创建 **backdrop root**，于是子元素 `backdrop-filter`
 * 采样到的「背景」不再是画面，而是这个层的内部（除了水珠本身什么都没有）。
 * 结果就是水珠退化成几个淡白色的圆点。
 *
 * 这里做三件事：
 *   1. 读当前计算值，确认 opacity 与 backdrop-filter 都在；
 *   2. 把 opacity 临时改成 1，截图对比；
 *   3. 试一次 `backdrop-filter: url(#svgfilter)` 的位移折射，看 Chromium 认不认。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-diag.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-diag');

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  // 打开雨：水珠模式
  await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('.theater-rain-toggle').click();
    await sleep(260);
    const sw = document.querySelector('.theater-rain-menu .toggle');
    if (!sw.classList.contains('on')) sw.click();
    await sleep(200);
    const pick = [...document.querySelectorAll('.rain-modes > button')]
      .find(b => (b.getAttribute('aria-label') || '').includes('水珠'));
    if (pick) pick.click();
    await sleep(200);
    document.querySelector('.theater-overlay-veil')?.click();
    await sleep(200);
    return 1;
  })()`);
  await wait(1200);

  // 1. 读计算值
  const computed = await run(`(() => {
    const layer = document.querySelector('.rain-layer');
    const drops = [...document.querySelectorAll('.rain-drops > i')];
    if (!layer) return { error: 'no rain-layer' };
    const ls = getComputedStyle(layer);
    const d0 = drops[0];
    const ds = d0 ? getComputedStyle(d0) : null;
    const b = d0 ? d0.getBoundingClientRect() : null;
    return {
      layer: {
        opacity: ls.opacity,
        filter: ls.filter,
        backdropFilter: ls.backdropFilter,
        transform: ls.transform,
        willChange: ls.willChange,
        contain: ls.contain,
      },
      dropCount: drops.length,
      firstDrop: ds && {
        backdropFilter: ds.backdropFilter,
        width: Math.round(b.width * 10) / 10,
        height: Math.round(b.height * 10) / 10,
        x: Math.round(b.x), y: Math.round(b.y),
        background: ds.backgroundImage.slice(0, 90),
      },
      // 浏览器到底认不认 backdrop-filter 的 url() 形式
      supportsUrl: CSS.supports('backdrop-filter', 'url(#x)'),
      supportsBlur: CSS.supports('backdrop-filter', 'blur(2px)'),
    };
  })()`);

  // 2. 对照组：把 .rain-layer 的 opacity 摘掉，看水珠会不会变
  await run(`(() => {
    const layer = document.querySelector('.rain-layer');
    layer.style.setProperty('--rain-opacity', '1');
    return 1;
  })()`);
  await wait(700);
  await shot(path.join(OUT, 'opacity-1.png'));

  await run(`(() => {
    document.querySelector('.rain-layer').style.setProperty('--rain-opacity', '0.7');
    return 1;
  })()`);
  await wait(700);
  await shot(path.join(OUT, 'opacity-07.png'));

  // 3. 试 backdrop-filter: url(#...)：把一颗水珠换成 SVG 位移折射
  const urlTest = await run(`(async () => {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none';
    host.innerHTML = '<svg width="1" height="1"><filter id="refract-probe" x="0%" y="0%" width="100%" height="100%">'
      + '<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="1" seed="3" result="n"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="n" scale="24" xChannelSelector="R" yChannelSelector="G"/>'
      + '</filter></svg>';
    document.body.appendChild(host);
    const drops = [...document.querySelectorAll('.rain-drops > i')];
    const target = drops.slice(0, 6);
    target.forEach(d => { d.style.backdropFilter = 'url(#refract-probe)'; });
    await new Promise(r => setTimeout(r, 600));
    const after = target.map(d => getComputedStyle(d).backdropFilter);
    return { applied: after, rects: target.map(d => { const b = d.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width)]; }) };
  })()`);
  await wait(900);
  await shot(path.join(OUT, 'svg-url.png'));

  console.log(JSON.stringify({ computed, urlTest }, null, 2));
  close();
});
