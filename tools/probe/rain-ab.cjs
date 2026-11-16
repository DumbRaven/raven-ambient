/**
 * A/B：同一颗水珠，在 `.rain-layer`（opacity: 0.7）里面 vs 外面。
 *
 * 规范说 opacity < 1 会创建 backdrop root，子孙的 backdrop-filter 就采不到
 * 页面背景了。如果这个项目里真的这样，那现在的水珠根本没在「透过水珠看」，
 * 只剩一层白色渐变——这正好解释「像贴纸」。
 *
 * 判据：两颗都用 backdrop-filter: url(#disp)，如果里面那颗不扭曲、外面那颗扭曲，
 * 就证明 backdrop root 生效，opacity 必须从层上移到每颗珠子上。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-ab.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-ab');

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  const setup = await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // 先挂折射滤镜
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden';
    host.innerHTML = '<svg width="1" height="1"><filter id="disp-ab" x="-20%" y="-20%" width="140%" height="140%">'
      + '<feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves="2" seed="11" result="n"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="n" scale="42" xChannelSelector="R" yChannelSelector="G"/>'
      + '</filter></svg>';
    document.body.appendChild(host);

    // 把雨打开（但要清掉所有水珠，只留我自己放的两个）
    document.querySelector('.theater-rain-toggle').click();
    await sleep(260);
    const sw = document.querySelector('.theater-rain-menu .toggle');
    if (!sw.classList.contains('on')) sw.click();
    await sleep(200);
    const pick = [...document.querySelectorAll('.rain-modes > button')]
      .find(b => b.textContent.trim() === '水珠');
    if (pick) pick.click();
    await sleep(200);
    document.querySelector('.theater-overlay-veil')?.click();
    await sleep(400);

    const layer = document.querySelector('.rain-layer');
    layer.style.setProperty('--rain-opacity', '1');
    // 干掉所有自动水珠，免得动来动去干扰判读
    document.querySelectorAll('.rain-drops > i').forEach(d => { d.style.display = 'none'; });

    const mk = (parent, left) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:' + left + 'px;top:300px;width:260px;height:260px;'
        + 'border-radius:50%;pointer-events:none;'
        + 'backdrop-filter:url(#disp-ab);-webkit-backdrop-filter:url(#disp-ab);'
        // 只给一点点轮廓，不给白渐变，这样看得清「画面本身有没有被扭曲」
        + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.5);';
      parent.appendChild(d);
      return d;
    };
    const inside = mk(layer, 300);   // 在 .rain-layer 里（opacity 1，先看基础态）
    const outside = mk(document.querySelector('.media-room'), 760);  // 在层外

    await sleep(700);
    const cs = e => getComputedStyle(e).backdropFilter;
    return {
      layerOpacity: getComputedStyle(layer).opacity,
      inside: cs(inside),
      outside: cs(outside),
      insideRect: [Math.round(inside.getBoundingClientRect().x), Math.round(inside.getBoundingClientRect().y)],
      outsideRect: [Math.round(outside.getBoundingClientRect().x), Math.round(outside.getBoundingClientRect().y)],
    };
  })()`);
  await wait(900);
  await shot(path.join(OUT, '01-opacity-1.png'));

  // 把层不透明度降回 0.7（默认值），看里面那颗会不会失效
  const lowered = await run(`(async () => {
    const layer = document.querySelector('.rain-layer');
    layer.style.setProperty('--rain-opacity', '0.7');
    await new Promise(r => setTimeout(r, 500));
    return getComputedStyle(layer).opacity;
  })()`);
  await wait(800);
  await shot(path.join(OUT, '02-opacity-07.png'));

  console.log(JSON.stringify({ setup, lowered }, null, 2));
  close();
});
