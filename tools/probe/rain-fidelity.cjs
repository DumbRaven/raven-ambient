/**
 * 折射可行性终判：`backdrop-filter: url(#feDisplacementMap)` 到底能不能
 * 把背后的画面**扭曲**。
 *
 * 之前几次测试用的背景是纯色（探针素材是 ffmpeg 生成的一块 #39557a），
 * 纯色被位移之后还是纯色，看不出任何变化——那是测法的问题，不是结论。
 *
 * 这次现造一张条纹 + 文字的高频图案当背景，三颗水滴并排：
 *   A 只有圆 + 渐变（现在的做法，对照组）
 *   B backdrop-filter: blur(2px) —— 只糊不折
 *   C backdrop-filter: url(#disp) —— 位移折射
 * D 再测一次「层内 vs 层外」，看 opacity 建的 backdrop root 有没有影响。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-fidelity.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-fidelity');

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  const built = await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // 折射滤镜：低频湍流当位移图，scale 大一点才看得见
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden';
    host.innerHTML =
      '<svg width="1" height="1">' +
      '<filter id="disp-test" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="5" result="n"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="n" scale="60" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter></svg>';
    document.body.appendChild(host);

    // 造一张高频图案当「背后的世界」：斜条纹 + 竖线 + 文字
    const world = document.createElement('div');
    world.id = 'fx-world';
    world.style.cssText = [
      'position:absolute', 'left:120px', 'top:120px', 'width:900px', 'height:420px',
      'z-index:200', 'border-radius:8px', 'overflow:hidden',
      'background:repeating-linear-gradient(45deg,#1a2230 0 10px,#8fa3bd 10px 20px)',
    ].join(';');
    world.innerHTML = '<div style="position:absolute;inset:0;'
      + 'background:repeating-linear-gradient(90deg,transparent 0 14px,rgba(255,255,255,.85) 14px 16px)"></div>'
      + '<div style="position:absolute;left:20px;top:150px;font:700 64px/1 Inter,sans-serif;color:#fff;'
      + 'letter-spacing:-2px;text-shadow:0 2px 0 #000">REFraction TEST 折射</div>';
    document.body.appendChild(world);
    await sleep(300);

    // 四颗水滴
    const mk = (left, css) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:' + left + 'px;top:200px;width:180px;height:200px;'
        + 'z-index:210;border-radius:50% 50% 50% 50%/46% 46% 54% 54%;pointer-events:none;'
        + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.55),inset 0 -8px 14px rgba(255,255,255,.28);'
        + css;
      world.appendChild(d);
      return d;
    };
    // A：只有渐变（现在的做法）
    const a = mk(30, 'background:radial-gradient(58% 52% at 36% 26%,#ffffffc4 0%,#ffffff3d 38%,#ffffff00 72%);');
    // B：只糊不折
    const b = mk(240, 'backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);'
      + 'background:radial-gradient(58% 52% at 36% 26%,#ffffff55 0%,#ffffff00 72%);');
    // C：位移折射
    const c = mk(450, 'backdrop-filter:url(#disp-test);-webkit-backdrop-filter:url(#disp-test);'
      + 'background:radial-gradient(58% 52% at 36% 26%,#ffffff55 0%,#ffffff00 72%);');
    // D：位移 + 轻微模糊
    const d = mk(660, 'backdrop-filter:blur(0.6px) url(#disp-test);-webkit-backdrop-filter:blur(0.6px) url(#disp-test);'
      + 'background:radial-gradient(58% 52% at 36% 26%,#ffffff66 0%,#ffffff00 72%);');

    await sleep(600);
    const cs = e => getComputedStyle(e).backdropFilter;
    return {
      a: cs(a), b: cs(b), c: cs(c), d: cs(d),
      // url() 形式的 backdrop-filter 在 Chromium 里到底认不认
      supports: {
        url: CSS.supports('backdrop-filter', 'url(#x)'),
        blurUrl: CSS.supports('backdrop-filter', 'blur(1px) url(#x)'),
      },
      rect: (() => { const r = world.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
    };
  })()`);
  await wait(900);
  await shot(path.join(OUT, 'compare.png'));

  console.log(JSON.stringify(built, null, 2));
  close();
});
