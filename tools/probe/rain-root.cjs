/**
 * 决定性实验：`.rain-layer` 的 opacity 是否把水珠的 backdrop-filter 废掉了。
 *
 * 规范：opacity < 1 的元素会创建 **backdrop root**，其子孙的 backdrop-filter
 * 只能采到该元素「内部」已经画好的东西，采不到外面的页面。而 .rain-layer 里
 * 除了水珠什么都没有，于是水珠的 backdrop-filter 等于是采了一块空背景。
 *
 * 判据：把一颗水珠的 backdrop-filter 设成极端值 blur(20px)，
 *   - 如果背后的画面变糊了 → 没废，问题只在视觉参数
 *   - 如果毫无变化 → 废了，这才是「像贴纸」的根因
 *
 * 再测两件事：
 *   - 真折射：backdrop-filter 能不能引用 feDisplacementMap
 *   - 换一个不透明的兄弟层做 backdrop root 之外的水珠，看能不能采到画面
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-root.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-root');

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
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
    await sleep(200);
    return 1;
  })()`);
  await wait(1200);
  await shot(path.join(OUT, '00-now.png'));

  // ── 实验 A：在 opacity 0.7 的 .rain-layer 里，把一颗水珠设成极端模糊 ──
  const expA = await run(`(async () => {
    const drops = [...document.querySelectorAll('.rain-drops > i')];
    // 挑一颗在画面中央的
    const mid = drops.find(d => {
      const b = d.getBoundingClientRect();
      return b.x > 400 && b.x < 900 && b.y > 300 && b.y < 600;
    }) || drops[0];
    const b = mid.getBoundingClientRect();
    // 放大 10 倍，好让「糊没糊」用肉眼一看就分得出来
    mid.style.width = '200px';
    mid.style.height = '200px';
    mid.style.opacity = '1';
    mid.style.backdropFilter = 'blur(20px)';
    mid.style.webkitBackdropFilter = 'blur(20px)';
    mid.style.animation = 'none';
    mid.style.transform = 'none';
    await new Promise(r => setTimeout(r, 500));
    return { rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width)], computed: getComputedStyle(mid).backdropFilter };
  })()`);
  await wait(800);
  await shot(path.join(OUT, '01-blur20-in-opacity07.png'));

  // ── 实验 B：同样的水珠，但把 .rain-layer 的 opacity 抬到 1 ──
  const expB = await run(`(async () => {
    document.querySelector('.rain-layer').style.setProperty('--rain-opacity', '1');
    await new Promise(r => setTimeout(r, 400));
    return getComputedStyle(document.querySelector('.rain-layer')).opacity;
  })()`);
  await wait(700);
  await shot(path.join(OUT, '02-blur20-opacity1.png'));

  // ── 实验 C：水珠搬出 .rain-layer，直接挂在 .media-room 里 ──
  // 这一层没有 opacity，理论上 backdrop-filter 能采到后面的画面。
  const expC = await run(`(async () => {
    const host = document.querySelector('.media-room');
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:50%;top:50%;width:220px;height:220px;'
      + 'transform:translate(-50%,-50%);border-radius:50%;z-index:99;pointer-events:none;'
      + 'backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);'
      + 'background:radial-gradient(circle at 36% 30%, rgba(255,255,255,.55), rgba(255,255,255,0) 62%);'
      + 'box-shadow:inset 0 0 22px rgba(0,0,0,.35);';
    host.appendChild(box);
    await new Promise(r => setTimeout(r, 500));
    const b = box.getBoundingClientRect();
    return { at: [Math.round(b.x), Math.round(b.y)], computed: getComputedStyle(box).backdropFilter };
  })()`);
  await wait(700);
  await shot(path.join(OUT, '03-outside-layer-blur20.png'));

  // ── 实验 D：真折射能不能用 url(#filter) 做位移 ──
  const expD = await run(`(async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden';
    host.innerHTML = '<svg width="1" height="1"><filter id="disp-strong" x="0%" y="0%" width="100%" height="100%">'
      + '<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="1" seed="3" result="n"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="n" scale="60" xChannelSelector="R" yChannelSelector="G"/>'
      + '</filter></svg>';
    document.body.appendChild(host);
    const boxes = [...document.querySelectorAll('.media-room > div')].filter(d => {
      const s = getComputedStyle(d); return s.borderRadius === '50%' && s.zIndex === '99';
    });
    const box = boxes[0];
    if (box) {
      box.style.backdropFilter = 'url(#disp-strong)';
      box.style.webkitBackdropFilter = 'url(#disp-strong)';
      box.style.width = '320px';
      box.style.height = '320px';
    }
    await new Promise(r => setTimeout(r, 600));
    return { found: !!box, computed: box && getComputedStyle(box).backdropFilter };
  })()`);
  await wait(800);
  await shot(path.join(OUT, '04-displacement.png'));

  console.log(JSON.stringify({ expA, expB, expC, expD }, null, 2));
  close();
});
