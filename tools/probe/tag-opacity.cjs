/**
 * 扫纹理的「透明度」，不是扫对比度。
 *
 * 为什么换方向：上一轮 tag-tune 扫 feComponentTransfer 的 slope（1.15→0.40，
 * 理论上该把对比压掉一半以上），实测 sd 只从 25.9 掉到 24.3。
 * 原因是纹理要过 `mix-blend-mode: overlay` 再乘 `opacity: 0.46`，
 * 前半段调多大幅度都会被后半段吃掉。
 *
 * 方差是可加的，所以能算：var_total ≈ var_base + var_texture。
 *   base（关掉两层纹理）  sd 11.1 → var 123
 *   target（参考图）      sd 12.9 → var 166
 *   现状（全开）          sd 23.4 → var 547 → 纹理贡献 424 (sd 20.6)
 * 要落到 166，纹理只能贡献 43，幅度得压到现在的 32% 左右 → opacity ≈ 0.15。
 *
 * 这个探针扫 opacity 与 ::after 高光强度的组合，其余固定。
 * 参考靶子（tools/measure/tag-ref.png，已剔金色字母）：
 *   mean 127.8  sd 12.9  p05 104  p50 130  p95 145  range95 41
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-opacity.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');
const { load, lum } = require('../measure/pixels.cjs');

const TARGET = { mean: 127.8, sd: 12.9, range95: 41, p50: 130 };

/** [beforeOpacity, afterOpacity] */
const CASES = [
  { name: 'now', before: 0.46, after: 1 },
  { name: 'b30', before: 0.30, after: 1 },
  { name: 'b20', before: 0.20, after: 1 },
  { name: 'b15', before: 0.15, after: 1 },
  { name: 'b15a50', before: 0.15, after: 0.5 },
  { name: 'b10a50', before: 0.10, after: 0.5 },
];

const AREA = `(() => {
  const r = document.querySelector('.tpl-tag').getBoundingClientRect();
  return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6,
           width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
})()`;

function apply(index) {
  const c = CASES[index];
  const css = `.template-collage .tpl-tag::before { opacity: ${c.before} !important; }
    .template-collage .tpl-tag::after { opacity: ${c.after} !important; }`;
  return `(() => { try {
    let style = document.getElementById('op-style');
    if (!style) { style = document.createElement('style'); style.id = 'op-style'; document.head.appendChild(style); }
    style.textContent = ${JSON.stringify(css.replace(/\s+/g, ' ').trim())};
    const tag = document.querySelector('.tpl-tag');
    return { before: getComputedStyle(tag, '::before').opacity, after: getComputedStyle(tag, '::after').opacity };
  } catch (e) { return { error: e.message }; } })()`;
}

function statsOf(file, size) {
  const img = load(file, { x: 10, y: 10, w: size.width - 20, h: size.height - 20 });
  const vals = [];
  for (let y = 0; y < img.H; y++) {
    for (let x = 0; x < img.W; x++) {
      const [r, g, b] = img.px(x, y);
      if (r > 110 && g > 85 && b < r - 45) continue;
      vals.push(lum(r, g, b));
    }
  }
  vals.sort((a, b) => a - b);
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const q = (p) => vals[Math.round(p * (n - 1))];
  return {
    mean: +mean.toFixed(1),
    sd: +sd.toFixed(1),
    range95: +(q(0.95) - q(0.05)).toFixed(0),
    p50: +q(0.5).toFixed(0),
  };
}

function concat(images, gap = 8) {
  const { nativeImage } = require('electron');
  const width = images.reduce((a, i) => a + i.getSize().width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map(i => i.getSize().height));
  const out = Buffer.alloc(width * height * 4, 255);
  let x = 0;
  for (const img of images) {
    const { width: w, height: h } = img.getSize();
    const src = img.toBitmap();
    for (let row = 0; row < h; row++) {
      src.copy(out, ((row * width) + x) * 4, row * w * 4, (row + 1) * w * 4);
    }
    x += w + gap;
  }
  return nativeImage.createFromBitmap(out, { width, height });
}

guard(async () => {
  const probe = await launch({ expand: true });
  await wait(500);
  const area = await probe.run(AREA);

  const shots = [];
  const rows = [];
  for (let i = 0; i < CASES.length; i++) {
    const state = await probe.run(apply(i));
    await wait(280);
    const img = await probe.win.webContents.capturePage(area);
    const file = path.join(__dirname, `op-${i}-${CASES[i].name}.png`);
    fs.writeFileSync(file, img.toPNG());
    shots.push(img);
    const s = statsOf(file, img.getSize());
    const d = Math.hypot(
      (s.mean - TARGET.mean) / 20,
      (s.sd - TARGET.sd) / 6,
      (s.range95 - TARGET.range95) / 20,
    );
    rows.push({ case: CASES[i].name, ...state, ...s, distance: +d.toFixed(3) });
  }

  const strip = concat(shots);
  const file = path.join(__dirname, 'op-sweep.png');
  fs.writeFileSync(file, strip.toPNG());

  report({ target: TARGET, rows: rows.sort((a, b) => a.distance - b.distance), strip: file });
});
