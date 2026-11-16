/**
 * 拿一张「有内容的照片」当背景，看水珠折射到底有没有把画面掰弯。
 *
 * 为什么需要它：harness 默认素材是一块纯色 #39557a。
 * 纯色背景上位移不产生任何视觉差，等于在一个测不出效果的背景上判断材质，
 * 前几轮就是那么白折腾的。这里把照片画进 .theater-screen（z-index 6，夹在
 * 模板 auto 与雨层 7 之间），再打开雨。
 *
 * 背景图由 make-photo.cjs 生成（.qa/probe-photo.png）。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-on-photo.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-photo');
const PHOTO = path.join(__dirname, '..', '..', '.qa', 'probe-photo.png');

const RAIN_ON = mode => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector('.theater-rain-toggle');
  if (!btn) return 'no-toggle';
  btn.click();
  await sleep(240);
  const sw = document.querySelector('.theater-rain-menu .toggle');
  if (!sw) return 'no-switch';
  if (!sw.classList.contains('on')) sw.click();
  await sleep(200);
  const pick = [...document.querySelectorAll('.rain-modes > button')]
    .find(b => (b.textContent || '').trim() === ${JSON.stringify(mode)});
  if (pick) pick.click();
  await sleep(200);
  const veil = document.querySelector('.theater-overlay-veil');
  if (veil) veil.click();
  await sleep(120);
  return 'ok';
})()`;

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  // 把照片塞进页面（file:// 在离屏窗口里取不到，走 data URL）
  const b64 = fs.readFileSync(PHOTO).toString('base64');
  const applied = await run(`(() => {
    const screen = document.querySelector('.theater-screen');
    if (!screen) return 'no-screen';
    document.getElementById('probe-photo-bg')?.remove();
    const bg = document.createElement('div');
    bg.id = 'probe-photo-bg';
    // z-index 6：夹在模板（auto）和雨层（7）之间。给 1 会被 .template 盖住。
    bg.style.cssText = 'position:absolute;inset:0;z-index:6;pointer-events:none;'
      + 'background:url(data:image/png;base64,${b64}) center/cover no-repeat';
    screen.appendChild(bg);
    return 'ok';
  })()`);

  for (const mode of ['水珠', '两样都要']) {
    await run(RAIN_ON(mode));
    await wait(1300);
    const active = await run(`(() => {
      const layer = document.querySelector('.rain-layer');
      return { layerMode: layer && layer.dataset.mode, drops: document.querySelectorAll('.rain-drops > i').length };
    })()`);
    for (let i = 0; i < 2; i++) {
      await shot(path.join(OUT, `${mode}-${i}.png`));
      await wait(780);
    }
    console.log(mode, applied, JSON.stringify(active));
  }

  await run(`(() => {
    document.querySelector('.theater-rain-toggle')?.click();
    const t = document.querySelector('.theater-rain-menu .toggle');
    if (t && t.classList.contains('on')) t.click();
    return 1;
  })()`);
  await wait(900);
  await shot(path.join(OUT, 'off.png'));
  close();
});
