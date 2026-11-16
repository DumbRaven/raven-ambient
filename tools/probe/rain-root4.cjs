/**
 * 补最后一个对照：把 `.rain-layer` 的 opacity 抬到 1，同一颗水珠是否恢复。
 *
 * 上一轮（rain-root3）已经量到：opacity 0.7 时层内水滴的 backdrop-filter
 * **完全不生效**（水滴矩形内像素差 0/44000），层外同一颗是 43.56%。
 * 这一轮只改 opacity 一个变量，看它是不是唯一原因。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-root4.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-root4');
const BOX = { left: 260, top: 260, width: 200, height: 220 };

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  const base = await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden';
    host.innerHTML = '<svg width="1" height="1">'
      + '<filter id="disp-r4" x="-30%" y="-30%" width="160%" height="160%">'
      + '<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="5" result="n"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="n" scale="60" xChannelSelector="R" yChannelSelector="G"/>'
      + '</filter></svg>';
    document.body.appendChild(host);

    const world = document.createElement('div');
    world.style.cssText = ['position:absolute','left:120px','top:140px','width:1000px','height:520px',
      'z-index:5','overflow:hidden',
      'background:repeating-linear-gradient(45deg,#101823 0 12px,#93a8c4 12px 24px)'].join(';');
    world.innerHTML = '<div style="position:absolute;inset:0;'
      + 'background:repeating-linear-gradient(90deg,transparent 0 16px,rgba(255,255,255,.75) 16px 18px)"></div>';
    document.querySelector('.media-room').appendChild(world);

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

    // 层 opacity 抬到 1
    const layer = document.querySelector('.rain-layer');
    layer.style.setProperty('--rain-opacity', '1');
    await sleep(300);
    return { layerOpacity: getComputedStyle(layer).opacity };
  })()`);
  await wait(600);
  await shot(path.join(OUT, 'none.png'));

  const put = await run(`(() => {
    const layer = document.querySelector('.rain-layer');
    const d = document.createElement('div');
    d.id = 'fx-drop';
    d.style.cssText = 'position:absolute;left:${BOX.left}px;top:${BOX.top}px;'
      + 'width:${BOX.width}px;height:${BOX.height}px;border-radius:50%;'
      + 'pointer-events:none;z-index:9;'
      + 'backdrop-filter:url(#disp-r4);-webkit-backdrop-filter:url(#disp-r4);';
    layer.appendChild(d);
    return getComputedStyle(d).backdropFilter;
  })()`);
  await wait(600);
  await shot(path.join(OUT, 'in-opacity-1.png'));

  console.log(JSON.stringify({ base, put, box: BOX }, null, 2));
  close();
});
