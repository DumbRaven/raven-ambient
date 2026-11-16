/**
 * 雨的现状取证：打开雨层，按时间连拍几帧。
 *
 * 用来回答「现在到底长什么样」而不是「代码写了什么」。
 * 截图存到 .qa/rain-now/，再用 PIL 放大局部看水珠边缘。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-look.cjs --no-sandbox
 *
 * 三种模式各拍一组：水珠 / 雨丝 / 两样都要。
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, report, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-now');

/** 点开雨按钮 → 打开开关 → 选模式 → 收起菜单。 */
const RAIN_ON = mode => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector('.theater-rain-toggle');
  if (!btn) return 'no-toggle';
  btn.click();
  await sleep(260);
  const sw = document.querySelector('.theater-rain-menu .toggle');
  if (!sw) return 'no-switch';
  if (!sw.classList.contains('on')) sw.click();
  await sleep(200);
  // 模式按钮上没有 aria-label，只有 role=radio + 纯文本，按文本匹配。
  // （第一版按 aria-label 找，结果 pick 恒为 undefined，三组图拍的全是默认态。）
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

  const sizes = await run(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`);
  const modes = ['水珠', '雨丝', '两样都要'];
  const shots = [];

  for (const mode of modes) {
    const state = await run(RAIN_ON(mode));
    await wait(1400);
    // 记下真的切过去没有：菜单里的 aria-checked 是唯一诚实的证据
    const active = await run(`(() => {
      const on = [...document.querySelectorAll('.rain-modes > button')]
        .find(b => b.getAttribute('aria-checked') === 'true');
      const layer = document.querySelector('.rain-layer');
      return { mode: on && on.textContent.trim(), layerMode: layer && layer.dataset.mode };
    })()`);
    for (let i = 0; i < 2; i++) {
      const file = path.join(OUT, `${mode}-${i}.png`);
      const png = await shot(file);
      shots.push({ mode, i, active, bytes: png.length });
      await wait(700);
    }
    if (state !== 'ok') shots.push({ mode, error: state });
  }

  // 关掉雨，拍一张没有雨的当对照
  await run(`(() => {
    document.querySelector('.theater-rain-toggle')?.click();
    const t = document.querySelector('.theater-rain-menu .toggle');
    if (t && t.classList.contains('on')) t.click();
    return 1;
  })()`);
  await wait(900);
  await shot(path.join(OUT, 'off.png'));

  console.log(JSON.stringify({ sizes, shots }, null, 2));
  close();
});
