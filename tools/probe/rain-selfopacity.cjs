/**
 * 最后一个前置确认：水滴**自己**带 opacity < 1 时，它的 backdrop-filter
 * 还能不能采到外面的画面。
 *
 * 为什么必须先确认："透明度" 滑块现在挂在 `.rain-layer` 上（opacity: 0.7），
 * 已经证明那会让层内所有水滴的 backdrop-filter 完全失效。修法是把 opacity
 * 下移到每颗水滴上——但如果水滴自身 opacity 也会废掉自己的滤镜，
 * 这个修法就不成立，"透明度" 只能换别的表达方式。
 *
 * 规范上讲：opacity < 1 的元素会成为**它的后代**的 backdrop root，不影响
 * 它自己的 backdrop-filter。这一条要用像素差验证，不能只靠读规范。
 *
 * 四组，同一位置同一颗水滴，只改 opacity 与 filter：
 *   a  opacity:1   backdrop-filter:url(#disp)
 *   b  opacity:0.6 backdrop-filter:url(#disp)
 *   c  opacity:0.6 filter:blur(1px) backdrop-filter:url(#disp)
 *   none 不放水滴
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-selfopacity.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-selfopacity');
const BOX = { left: 260, top: 260, width: 200, height: 220 };

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden';
    host.innerHTML = '<svg width="1" height="1">'
      + '<filter id="disp-so" x="-30%" y="-30%" width="160%" height="160%">'
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
    await sleep(300);
    return 1;
  })()`);
  await wait(500);
  await shot(path.join(OUT, 'none.png'));

  const cases = {
    a: 'opacity:1;',
    b: 'opacity:0.6;',
    c: 'opacity:0.6;filter:blur(1px);',
    d: 'opacity:0.6;filter:opacity(0.6);',
  };
  const results = {};
  for (const [name, extra] of Object.entries(cases)) {
    results[name] = await run(`(() => {
      document.getElementById('fx-drop')?.remove();
      const d = document.createElement('div');
      d.id = 'fx-drop';
      d.style.cssText = 'position:absolute;left:${BOX.left}px;top:${BOX.top}px;'
        + 'width:${BOX.width}px;height:${BOX.height}px;border-radius:50%;'
        + 'pointer-events:none;z-index:200;'
        + ${JSON.stringify(extra)}
        + 'backdrop-filter:url(#disp-so);-webkit-backdrop-filter:url(#disp-so);';
      document.querySelector('.media-room').appendChild(d);
      const cs = getComputedStyle(d);
      return { opacity: cs.opacity, filter: cs.filter, backdrop: cs.backdropFilter };
    })()`);
    await wait(500);
    await shot(path.join(OUT, name + '.png'));
  }

  console.log(JSON.stringify({ results, box: BOX }, null, 2));
  close();
});
