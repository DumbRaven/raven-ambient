/**
 * 用「有纹理的画面」看雨，而不是纯色块。
 *
 * 这条是踩出来的：之前所有雨的截图都是纯色背景（harness 的素材是一块
 * #39557a），而水珠最核心的观感——背后画面被掰弯——在纯色上**原理上就看不见**。
 * 纯色被位移之后还是纯色。所以前面几轮一直在拿一个测不出效果的背景判断材质，
 * 结论只能靠猜。
 *
 * 这里在页面里把放映画面换成高频图案（斜条纹 + 竖线 + 网格 + 大字），
 * 再拍同一套雨。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-on-pattern.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-pattern');

/** 在 .theater-screen 上面铺一层高频图案。插在雨层下面，所以雨会折射它。 */
const PATTERN = `(() => {
  const screen = document.querySelector('.theater-screen');
  if (!screen) return 'no-screen';
  const old = document.getElementById('probe-pattern');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'probe-pattern';
  box.style.cssText = [
    'position:absolute', 'inset:0',
    // z-index 必须夹在模板（auto）和雨层（7）之间：给 1 会被 .template 盖住，
    // 给 7 又会盖住雨珠。这是拿一块纯红试出来的——红块盖住了模板才看见。
    'z-index:6', 'pointer-events:none',
    // 45 度斜条纹 + 竖细线 + 横细线，三种周期的频率都不同：
    // 单一周期的图案被位移后可能刚好又对齐，看起来像没动。
    'background-image:' + [
      'repeating-linear-gradient(45deg,#0b1b2e 0,#0b1b2e 14px,#e8eef5 14px,#e8eef5 28px)',
      'repeating-linear-gradient(90deg,rgba(255,216,102,0.55) 0,rgba(255,216,102,0.55) 3px,transparent 3px,transparent 23px)',
      'repeating-linear-gradient(0deg,rgba(120,220,180,0.45) 0,rgba(120,220,180,0.45) 2px,transparent 2px,transparent 31px)'
    ].join(',') + ';',
    'background-blend-mode:normal,normal,normal',
  ].join(';');
  screen.appendChild(box);
  return 'ok';
})()`;

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
  // 模式按钮没有 aria-label，只有 role=radio + 纯文本
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

  for (const mode of ['水珠', '两样都要']) {
    await run(RAIN_ON(mode));
    await wait(1200);
    const patched = await run(PATTERN);
    const active = await run(`(() => {
      const layer = document.querySelector('.rain-layer');
      return { layerMode: layer && layer.dataset.mode, drops: document.querySelectorAll('.rain-drops > i').length };
    })()`);
    for (let i = 0; i < 2; i++) {
      await shot(path.join(OUT, `${mode}-${i}.png`));
      await wait(760);
    }
    console.log(mode, patched, JSON.stringify(active));
  }

  // 关雨对照：同样带图案
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
