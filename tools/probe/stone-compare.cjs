/**
 * 两种石纹并排看一眼，并确认切换真的换了滤镜。
 *
 * 为什么要单独一个探针：石纹是很淡的一层，整页截图缩到 1920 宽之后基本看不清。
 * 而且换风格要换掉整只滤镜宿主——如果宿主没被替换，屏幕上会继续用旧管线，
 * 而 CSS 已经切到新的底色，结果是「一片平灰」，**不会报错**。所以这里两件事一起验：
 *   1. 点一下胶囊（切风格）之后，`document.querySelectorAll('[data-tpl-marble]')` 只能剩一只；
 *   2. 那只宿主里的 turbulence 参数得换成另一种石纹那一套。
 *
 * 与 `stone-final3.cjs` 的分工：那个是验收工具（含两帧稳定、与参考图拼条），
 * 这个只做「切换链路通不通」的快速回归，跑完不要它的截图。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/stone-compare.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

/** 读一枚胶囊的状态。截图由外面按 rect 裁。 */
const READ = `(() => {
  const tag = document.querySelector('.tpl-tag');
  if (!tag) return { error: 'no .tpl-tag' };
  const r = tag.getBoundingClientRect();
  const before = getComputedStyle(tag, '::before');
  const after = getComputedStyle(tag, '::after');
  const hosts = [...document.querySelectorAll('[data-tpl-marble]')];
  const svg = hosts[0] ? hosts[0].querySelector('svg') : null;
  const turb = svg ? [...svg.querySelectorAll('feTurbulence')] : [];
  return {
    stone: document.querySelector('.template')?.getAttribute('data-stone') ?? null,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    beforeFilter: before.filter,
    beforeBackground: before.backgroundImage.slice(0, 80),
    beforeColor: before.backgroundColor,
    beforeBlend: before.mixBlendMode,
    beforeOpacity: before.opacity,
    afterOpacity: after.opacity,
    hosts: hosts.length,
    hostStone: hosts[0]?.getAttribute('data-tpl-marble') ?? null,
    freqs: turb.map(node => node.getAttribute('baseFrequency')),
    turbTypes: turb.map(node => node.getAttribute('type')),
    filterExists: !!document.getElementById('tpl-marble'),
  };
})()`;

/** 点胶囊本身切风格——用户 m09905 之后切换入口就是它（`.tpl-tag` 是个 <button>）。 */
const pick = `(() => {
  const tag = document.querySelector('.tpl-tag');
  if (!tag) return { error: 'no .tpl-tag' };
  const before = document.querySelector('.template-collage')?.getAttribute('data-stone') ?? null;
  tag.click();
  return { clicked: true, from: before };
})()`;

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });

  const shots = [];
  async function shoot(label, detail) {
    if (!detail.rect) return;
    const [x, y, w, h] = detail.rect;
    const pad = 6;
    const image = await probe.win.webContents.capturePage({
      x: Math.max(0, x - pad),
      y: Math.max(0, y - pad),
      width: w + pad * 2,
      height: h + pad * 2,
    });
    const out = path.join(__dirname, `stone-${label}.png`);
    fs.writeFileSync(out, image.toPNG());
    shots.push({ label, saved: out, size: image.getSize() });
  }

  // 切换入口是胶囊本身，不需要先打开配色菜单。
  const sea = await probe.run(READ);
  await shoot('sea', sea);

  const clickJade = await probe.run(pick);
  // 换风格会重建滤镜宿主，等一拍让 React 与 DOM 都落定。
  await wait(600);
  const jade = await probe.run(READ);
  await shoot('jade', jade);

  const clickSea = await probe.run(pick);
  await wait(600);
  const backToSea = await probe.run(READ);

  report({ sea, clickJade, jade, clickSea, backToSea, shots });
});
