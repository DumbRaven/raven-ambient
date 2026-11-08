/**
 * 扫「底色里混多少白」——胶囊的色偏有多浓。
 *
 * 现状：`background: color-mix(in srgb, #ffffff 34%, var(--tpl-panel))`。
 * 34% 的白是当初为了让胶囊看起来是「半透明的白玻璃」拍的，但它同时把
 * 面板的色相稀释掉三分之二：蓝面板下胶囊 `blueMinusRed` 只有 +11.9，
 * 而参考图那块是 +24.3。
 *
 * 这个探针只改 `::before` 的 `background`，纹理与滤镜一个字不动，
 * 所以量到的差别只来自「白混了多少」。
 *
 * 跑法：node_modules/electron/dist/electron.exe tools/probe/stone-tint.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait } = require('./harness.cjs');

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
 * 底色候选。
 *
 * 混白（`color-mix(#fff N%, panel)`）的问题：它同时提亮**和**褪色。
 * 参考图要求「亮（mean 130）且蓝得明显（blueMinusRed 24.3）」，
 * 混到 34% 白时亮度够了但蓝只剩下 11.9——两个目标互相打架。
 *
 * 换成相对颜色语法 `hsl(from panel h s calc(l * k))`：只抬明度、
 * 色相与饱和度原样保留。Chromium 119+ 支持（本机 Electron 40 ≫ 119）。
 * 这仍然是「面板的颜色」，只是同一块面板提亮之后的样子。
 */
const CANDIDATES = [
  { label: 'white34', background: 'color-mix(in srgb, #ffffff 34%, var(--tpl-panel))' },
  { label: 'lift120', background: 'hsl(from var(--tpl-panel) h s calc(l * 1.20))' },
  { label: 'lift140', background: 'hsl(from var(--tpl-panel) h s calc(l * 1.40))' },
  { label: 'lift160', background: 'hsl(from var(--tpl-panel) h s calc(l * 1.60))' },
];

const setBackground = background => `(() => {
  let style = document.getElementById('tint-try');
  if (!style) {
    style = document.createElement('style');
    style.id = 'tint-try';
    document.head.appendChild(style);
  }
  style.textContent = '.template-collage[data-stone="jade"] .tpl-tag::before { background: ${background} !important; }';
  return { background: ${JSON.stringify(background)} };
})()`;

/** 面板色候选：蓝（参考图那种）与暖色各一份，看两端都还认得出来。 */
const PANELS = [
  ['auto', null],
  ['blue', '#4a5363'],
  ['sand', '#6b6350'],
];

const setPanel = color => (color
  ? `(() => {
    const root = document.querySelector('.template-collage');
    if (!root) return { error: 'no stage' };
    root.style.setProperty('--tpl-panel', ${JSON.stringify(color)});
    return { panel: getComputedStyle(root).getPropertyValue('--tpl-panel').trim() };
  })()`
  // auto：把之前设过的覆盖清掉，回到壁纸自动取色那一版。
  : `(() => {
    const root = document.querySelector('.template-collage');
    if (!root) return { error: 'no stage' };
    root.style.removeProperty('--tpl-panel');
    return { panel: getComputedStyle(root).getPropertyValue('--tpl-panel').trim() };
  })()`);

/** 量胶囊平均 RGB，跳过金色（字与 ✦），内缩 14% 避开圆角漏底。 */
function measure(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const x0 = Math.round(width * 0.14), x1 = Math.round(width * 0.86);
  const y0 = Math.round(height * 0.14), y1 = Math.round(height * 0.86);
  let r = 0, g = 0, b = 0, n = 0;
  const lums = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      const blue = bitmap[i], green = bitmap[i + 1], red = bitmap[i + 2];
      if (red - blue > 26 && red > 96) continue;
      r += red; g += green; b += blue; n += 1;
      lums.push(0.299 * red + 0.587 * green + 0.114 * blue);
    }
  }
  if (!n) return null;
  const mean = lums.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(lums.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  return {
    rgb: [r / n, g / n, b / n].map(v => +v.toFixed(1)),
    blueMinusRed: +((b - r) / n).toFixed(1),
    mean: +mean.toFixed(1),
    sd: +sd.toFixed(2),
  };
}

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });
  // `probe.run` 只吃一个参数（代码串）。不要照抄 stone-follow 里那个
  // `run(label, script)` 的本地包装——它的第一个参数是标签，会被当成 JS 执行，
  // 报出来的只有一句 `PROBE_FAIL Script failed to execute`，看不出是这里。
  const run = code => probe.run(code);

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

  const rows = [];
  for (const [panelLabel, color] of PANELS) {
    await run(setPanel(color));
    await wait(240);
    for (const candidate of CANDIDATES) {
      await run(setBackground(candidate.background));
      await wait(220);
      const image = await probe.win.webContents.capturePage({
        x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: w + pad * 2, height: h + pad * 2,
      });
      const file = path.join(__dirname, `tint-${panelLabel}-${candidate.label}.png`);
      fs.writeFileSync(file, image.toPNG());
      rows.push({ panel: panelLabel, label: candidate.label, file, ...measure(image) });
    }
  }

  // 只把蓝面板那一排拼起来看：形状是否还在、是不是越少白越像参考图。
  const blue = rows.filter(r => r.panel === 'blue');
  const row = path.join(__dirname, 'tint-row.png');
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...blue.flatMap(r => ['-i', r.file]),
    '-filter_complex',
    blue.map((_, i) => `[${i}:v]scale=-2:640:flags=lanczos[v${i}]`).join(';') +
      ';' + blue.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${blue.length}`,
    '-frames:v', '1', row,
  ]);

  report({ rows, row, rect });
});
