/**
 * 分解测量：胶囊的明暗到底是谁在出。
 *
 * 为什么要做这个：上一轮扫 `feComponentTransfer` 的 slope（1.15 → 0.40，
 * 理论上该把对比度压掉一半以上），实测 sd 只从 25.9 掉到 24.3，几乎没动。
 * 说明**对比度的主要来源不是 ::before 的噪声纹理**，我一直在调一个次要因素。
 *
 * 这个探针逐个关掉参与叠色的层，看每一层对 mean / sd / range95 贡献多少：
 *   all        全开（现状）
 *   no-after   关掉 ::after（方向性高光渐变）
 *   no-before  关掉 ::before（噪声纹理）
 *   no-texture 两个伪元素都关掉，只剩胶囊底色 + 字母
 *   flat       底色换成不透明中灰，用来量"底色本身有多亮"
 *
 * 参考靶子（tools/measure/tag-ref.png，已剔金色字母）：
 *   mean 127.8  sd 12.9  p05 104  p50 130  p95 145  range95 41
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-layers.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');
const { load, lum } = require('../measure/pixels.cjs');

const TARGET = { mean: 127.8, sd: 12.9, range95: 41, p50: 130 };

const CASES = [
  { name: 'all', css: '' },
  { name: 'no-after', css: '.template-collage .tpl-tag::after { display: none !important; }' },
  { name: 'no-before', css: '.template-collage .tpl-tag::before { display: none !important; }' },
  { name: 'no-texture', css: '.template-collage .tpl-tag::before, .template-collage .tpl-tag::after { display: none !important; }' },
  { name: 'flat', css: '.template-collage .tpl-tag { background: #8a8f96 !important; } .template-collage .tpl-tag::before, .template-collage .tpl-tag::after { display: none !important; }' },
];

const AREA = `(() => {
  const r = document.querySelector('.tpl-tag').getBoundingClientRect();
  return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6,
           width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
})()`;

function apply(index) {
  const css = CASES[index].css.replace(/\s+/g, ' ').trim();
  return `(() => { try {
    let style = document.getElementById('layer-style');
    if (!style) { style = document.createElement('style'); style.id = 'layer-style'; document.head.appendChild(style); }
    style.textContent = ${JSON.stringify(css)};
    const tag = document.querySelector('.tpl-tag');
    return {
      tagBg: getComputedStyle(tag).backgroundColor,
      beforeDisplay: getComputedStyle(tag, '::before').display,
      afterDisplay: getComputedStyle(tag, '::after').display,
    };
  } catch (e) { return { error: e.message }; } })()`;
}

function statsOf(file, size) {
  const img = load(file, { x: 10, y: 10, w: size.width - 20, h: size.height - 20 });
  const vals = [];
  for (let y = 0; y < img.H; y++) {
    for (let x = 0; x < img.W; x++) {
      const [r, g, b] = img.px(x, y);
      if (r > 110 && g > 85 && b < r - 45) continue; // 金色字母
      vals.push(lum(r, g, b));
    }
  }
  vals.sort((a, b) => a - b);
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const q = (p) => vals[Math.round(p * (n - 1))];
  return {
    n,
    mean: +mean.toFixed(1),
    sd: +sd.toFixed(1),
    range95: +(q(0.95) - q(0.05)).toFixed(0),
    p05: +q(0.05).toFixed(0),
    p50: +q(0.5).toFixed(0),
    p95: +q(0.95).toFixed(0),
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
    const file = path.join(__dirname, `layer-${i}-${CASES[i].name}.png`);
    fs.writeFileSync(file, img.toPNG());
    shots.push(img);
    rows.push({ case: CASES[i].name, ...state, ...statsOf(file, img.getSize()) });
  }

  const strip = concat(shots);
  const file = path.join(__dirname, 'layer-sweep.png');
  fs.writeFileSync(file, strip.toPNG());

  report({ target: TARGET, rows, strip: file });
});
