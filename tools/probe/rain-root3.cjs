/**
 * 干净判据：水滴只挂 backdrop-filter，不给 background、不给 box-shadow。
 *
 * 这样区域内要么是**被扭曲的条纹**（滤镜生效），要么跟周围**一模一样**
 * （滤镜没生效）。判据变成像素差，不再靠肉眼。
 *
 * 分三种摆放，各自单独截一张：
 *   in   —— 放在 .rain-layer 里（该层 opacity: 0.7）
 *   out  —— 放在 .rain-layer 外（.media-room 直接子元素）
 *   none —— 不滴水珠，当对照
 *
 * 然后对每张图，在「水珠所在的矩形」里算与 none 的差异像素占比：
 *   接近 0  → backdrop-filter 被废了（backdrop root）
 *   明显 > 0 → 正常生效
 *
 * 位置固定、不用动画，三次截图只有水珠这一处不同。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-root3.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-root3');

// 水滴矩形（页面 CSS 像素），两种摆法都落在这块，便于用同一区域比对。
const BOX = { left: 260, top: 260, width: 200, height: 220 };

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  // 铺一张高频条纹当「屏幕后面的世界」，关掉雨层的自动水珠，只留我自己放的
  const base = await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden';
    host.innerHTML = '<svg width="1" height="1">'
      + '<filter id="disp-r3" x="-30%" y="-30%" width="160%" height="160%">'
      + '<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="5" result="n"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="n" scale="60" xChannelSelector="R" yChannelSelector="G"/>'
      + '</filter></svg>';
    document.body.appendChild(host);

    const world = document.createElement('div');
    world.id = 'fx-world';
    world.style.cssText = [
      'position:absolute', 'left:120px', 'top:140px', 'width:1000px', 'height:520px',
      'z-index:5', 'overflow:hidden',
      'background:repeating-linear-gradient(45deg,#101823 0 12px,#93a8c4 12px 24px)',
    ].join(';');
    world.innerHTML = '<div style="position:absolute;inset:0;'
      + 'background:repeating-linear-gradient(90deg,transparent 0 16px,rgba(255,255,255,.75) 16px 18px)"></div>';
    document.querySelector('.media-room').appendChild(world);

    // 雨层要存在（.rain-layer 只在下雨时渲染），但把它自己的珠子清空
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
    await sleep(500);
    document.querySelectorAll('.rain-drops > i').forEach(d => { d.style.display = 'none'; });

    const layer = document.querySelector('.rain-layer');
    return {
      layerOpacity: getComputedStyle(layer).opacity,
      layerRect: (() => { const b = layer.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })(),
      innerSize: [innerWidth, innerHeight, devicePixelRatio],
    };
  })()`);
  await wait(700);
  await shot(path.join(OUT, 'none.png'));

  // 往指定父级里放一颗「只有滤镜、没有外观」的水滴
  const put = where => run(`(() => {
    const layer = document.querySelector('.rain-layer');
    const parentNode = ${JSON.stringify(where)} === 'in' ? layer : document.querySelector('.media-room');
    const d = document.createElement('div');
    d.id = 'fx-drop';
    d.style.cssText = 'position:absolute;left:${BOX.left}px;top:${BOX.top}px;'
      + 'width:${BOX.width}px;height:${BOX.height}px;border-radius:50%;'
      + 'pointer-events:none;z-index:9;'
      + 'backdrop-filter:url(#disp-r3);-webkit-backdrop-filter:url(#disp-r3);';
    parentNode.appendChild(d);
    return getComputedStyle(d).backdropFilter;
  })()`);

  const inState = await put('in');
  await wait(600);
  await shot(path.join(OUT, 'in.png'));

  await run(`(() => { document.getElementById('fx-drop')?.remove(); return 1; })()`);
  await wait(300);

  const outState = await put('out');
  await wait(600);
  await shot(path.join(OUT, 'out.png'));

  console.log(JSON.stringify({ base, inState, outState, box: BOX }, null, 2));
  close();
});
