/**
 * 两种石纹并排看一眼，并确认切换真的换了滤镜。
 *
 * 为什么要单独一个探针：石纹是很淡的一层，整页截图缩到 1920 宽之后基本看不清。
 * 而且这一版新增了「换风格要换掉整只滤镜宿主」的逻辑——如果宿主没被替换，
 * 屏幕上会继续用旧管线，但 CSS 已经切到 `soft-light + #808080`，
 * 结果是「一片平灰」，**不会报错**。所以这里两件事一起验：
 *   1. 切到 cloud 之后，`document.querySelectorAll('[data-tpl-marble]')` 只能剩一只；
 *   2. 那只宿主里的 turbulence 参数得是云雾那条（0.025 0.0177）。
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
    hosts: hosts.length,
    hostStone: hosts[0]?.getAttribute('data-tpl-marble') ?? null,
    freqs: turb.map(node => node.getAttribute('baseFrequency')),
    filterExists: !!document.getElementById('tpl-marble'),
  };
})()`;

/** 通过真实点击面板里的那颗按钮来切换——顺便验证按钮接得上。 */
const pick = stone => `(() => {
  const button = [...document.querySelectorAll('.tone-stones button')]
    .find(node => node.textContent.includes(${JSON.stringify(stone === 'sea' ? '浪脊' : '云雾')}));
  if (!button) return { error: 'no stone button' };
  button.click();
  return { clicked: true, pressed: button.getAttribute('aria-checked') };
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

  // 面板默认是收起的：先点开配色菜单，不然找不到那两颗按钮。
  const opened = await probe.run(`(() => {
    const button = document.querySelector('button[aria-label="配色"]');
    if (!button) return { error: 'no tone button' };
    button.click();
    return { opened: true };
  })()`);
  await wait(260);

  const sea = await probe.run(READ);
  await shoot('sea', sea);

  const clickCloud = await probe.run(pick('cloud'));
  // 换风格会重建滤镜宿主，等一拍让 React 与 DOM 都落定。
  await wait(600);
  const cloud = await probe.run(READ);
  await shoot('cloud', cloud);

  const clickSea = await probe.run(pick('sea'));
  await wait(600);
  const backToSea = await probe.run(READ);

  report({ opened, sea, clickCloud, cloud, clickSea, backToSea, shots });
});
