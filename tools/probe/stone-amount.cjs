/**
 * 扫 `amount`：玉石纹理的起伏幅度。
 *
 * 背景：用户 m09087 指出胶囊本身不该有颜色。改成「中性灰纹理 × 面板底色」之后，
 * 颜色确实跟着面板走了（`stone-follow.cjs` 六档实测 tagSpread 31.3），
 * 但纹理被压平了——`sd` 从 9.5 掉到 0.7，肉眼是一块均匀的板。
 *
 * 原因：乘法的幅度是 `SourceGraphic × (1 ± amount/2)`，
 * 底色只有 ~0.55，于是同样 amount 在屏幕上只有原来加法版的一半不到；
 * 而 0.34 这个值是照着加法版（`gain 0.5`）拍的，没有换算。
 *
 * 这个探针只改源码生成的那串里的 `slope`/`intercept`（`amount` 的两个去处），
 * 其余一个字不动，所以量到的差别只来自幅度。
 *
 * 跑法：node_modules/electron/dist/electron.exe tools/probe/stone-amount.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { launch, report, guard, wait } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..', '..');

const OPEN = `(() => {
  const button = document.querySelector('button[aria-label="配色"]');
  if (button && !document.querySelector('.tone-stones')) button.click();
  return { menu: !!document.querySelector('.tone-stones') };
})()`;

const PICK_JADE = `(() => {
  const button = [...document.querySelectorAll('.tone-stones button')].find(n => n.textContent.includes('玉石'));
  if (!button) return { error: 'no jade button' };
  button.click();
  return { ok: true };
})()`;

/**
 * 把源码那串里的 amount 换成指定值。三处 `slope` 共用同一个值，
 * `intercept` 是 `1 − amount/2`（保留三位，源码里就是 `0.830` 这种写法）。
 *
 * **必须回报替换了几处**：第一版正则写成 `intercept="0.83"`，而源码是
 * `intercept="0.830"`，五档静默地全都换不动——量出来 sd 一模一样（0.7），
 * 看着像「amount 不起作用」，其实是探针没改到东西。
 */
function withAmount(markup, amount) {
  let hits = 0;
  const intercept = (1 - amount * 0.73).toFixed(3);
  const out = markup.replace(
    /slope="0\.34" intercept="-?0\.\d+"/g,
    () => {
      hits += 1;
      return `slope="${amount.toFixed(2)}" intercept="${intercept}"`;
    },
  );
  return { markup: out, hits };
}

const AMOUNTS = [1.2, 1.4, 1.6, 1.8, 2.0];

guard(async () => {
  const { marbleFilterMarkup } = await import(pathToFileURL(path.join(ROOT, 'src', 'marble.ts')).href);
  const base = marbleFilterMarkup('jade');

  const probe = await launch({ expand: true, settle: 900 });
  const run = async script => probe.run(script);

  await run(OPEN);
  await wait(240);
  await run(PICK_JADE);
  await wait(520);

  const rect = await run(`(() => {
    const r = document.querySelector('.tpl-tag').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);
  const [x, y, w, h] = rect ?? [0, 0, 0, 0];
  const pad = 4;

  /** 把一份 markup 装进宿主，等一帧再截。宿主归所有 probe 共用，必须整只替换。 */
  const apply = async markup => {
    const flat = markup.replace(/\s+/g, ' ').trim();
    await run(`(() => {
      document.querySelectorAll('[data-tpl-marble]').forEach(n => n.remove());
      const host = document.createElement('div');
      host.setAttribute('data-tpl-marble', 'try');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0';
      host.innerHTML = ${JSON.stringify(flat)};
      document.body.appendChild(host);
    })()`);
    await wait(180);
  };

  const shots = [];
  for (const amount of AMOUNTS) {
    const swapped = withAmount(base, amount);
    await apply(swapped.markup);
    const image = await probe.win.webContents.capturePage({
      x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: w + pad * 2, height: h + pad * 2,
    });
    const file = path.join(__dirname, `amount-${amount}.png`);
    fs.writeFileSync(file, image.toPNG());
    shots.push({ amount, file, hits: swapped.hits });
  }

  const row = path.join(__dirname, 'amount-row.png');
  const H = 640;
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...shots.flatMap(s => ['-i', s.file]),
    '-filter_complex',
    shots.map((_, i) => `[${i}:v]scale=-2:${H}:flags=lanczos[v${i}]`).join(';') +
      ';' + shots.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${shots.length}`,
    '-frames:v', '1', row,
  ]);

  report({ amounts: AMOUNTS, shots, row, rect });
});
