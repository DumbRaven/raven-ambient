/**
 * 判定 `.rain-layer` 的 `opacity` 是否创建了 backdrop root，把层内水珠的
 * backdrop-filter 废掉。
 *
 * 上一次（rain-ab）用纯色背景测，纯色被位移之后还是纯色，看不出任何区别，
 * 那次是**测法无效**，不是「折射不起作用」。这次背景换成高频条纹，
 * 层内层外各放一颗 `backdrop-filter: url(#disp)` 的水珠，直接看图。
 *
 * 判据：
 *   两颗都扭曲 → opacity 没建 backdrop root，层结构可以不动
 *   只有层外扭曲 → 确认 backdrop root 生效，opacity 必须下移
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-root2.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-root2');

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  const built = await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden';
    host.innerHTML = '<svg width="1" height="1">'
      + '<filter id="disp-r2" x="-30%" y="-30%" width="160%" height="160%">'
      + '<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="5" result="n"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="n" scale="60" xChannelSelector="R" yChannelSelector="G"/>'
      + '</filter></svg>';
    document.body.appendChild(host);

    // 高频图案当背景，压在水珠下面（z-index 比雨层低，雨层在 z-index:7）
    const world = document.createElement('div');
    world.style.cssText = [
      'position:absolute', 'left:100px', 'top:150px', 'width:1000px', 'height:400px',
      'z-index:5', 'overflow:hidden',
      'background:repeating-linear-gradient(45deg,#1a2230 0 10px,#8fa3bd 10px 20px)',
    ].join(';');
    world.innerHTML = '<div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 14px,rgba(255,255,255,.8) 14px 16px)"></div>';
    document.querySelector('.media-room').appendChild(world);

    // 打开雨（只要水珠模式，但把自动珠子全藏掉）
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
    const mk = (parent, left, top) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:' + left + 'px;top:' + top + 'px;'
        + 'width:200px;height:220px;border-radius:50% 50% 50% 50%/46% 46% 54% 54%;'
        + 'pointer-events:none;z-index:9;'
        + 'backdrop-filter:url(#disp-r2);-webkit-backdrop-filter:url(#disp-r2);'
        + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.6);';
      parent.appendChild(d);
      return d;
    };

    // 层内：在 .rain-layer 里（该层 opacity 此时是默认 0.7）
    const inside = mk(layer, 180, 220);
    // 层外：直接挂 .media-room
    const outside = mk(document.querySelector('.media-room'), 620, 220);

    await sleep(700);
    const layerOpacity = getComputedStyle(layer).opacity;
    return {
      layerOpacity,
      inside: getComputedStyle(inside).backdropFilter,
      outside: getComputedStyle(outside).backdropFilter,
    };
  })()`);
  await wait(900);
  await shot(path.join(OUT, '01-layer-opacity-07.png'));

  // 把层 opacity 抬到 1，再拍一次
  await run(`(() => { document.querySelector('.rain-layer').style.setProperty('--rain-opacity','1'); return 1; })()`);
  await wait(800);
  await shot(path.join(OUT, '02-layer-opacity-1.png'));

  console.log(JSON.stringify(built, null, 2));
  close();
});
