/**
 * 石纹参数扫描：目标是拍中参考图的明暗分布，不是"看着像"。
 *
 * 参考图那块（tools/measure/tag-ref.png）的实测统计，已经把金色字母剔掉了：
 *   mean 127.8  sd 12.9  p05 104  p50 130  p95 145  range95 41
 * 也就是说它是**一片低对比的浅灰雾**，而不是高对比的黑白纹。
 *
 * 第一轮六个候选全是 sd 27~31 / range95 106~111——对比度是参考的两倍半以上，
 * 所以看着"脏"、"像磨砂塑料"。眼睛能感觉出不对，说不清差多少；量一下就知道了。
 *
 * 这一轮只扫「把噪声压成多低的对比」，别的固定：
 * fractalNoise 0.010 / numOctaves 3 / 模糊 3 / 去饱和 / alpha 钉死。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-tune.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');
const { load, lum } = require('../measure/pixels.cjs');

/** 参考图的靶子。改这里之前先重跑一次测量。 */
const TARGET = { mean: 127.8, sd: 12.9, range95: 41, p50: 130 };

const VARIANTS = [
  { slope: 0.55, intercept: 0.24 },
  { slope: 0.75, intercept: 0.18 },
  { slope: 0.95, intercept: 0.14 },
  { slope: 1.15, intercept: 0.10 },
  { slope: 0.65, intercept: 0.32 },
  { slope: 0.40, intercept: 0.36 },
];

function markupOf({ slope, intercept }) {
  const f = (t) => `<feFunc${t} type="linear" slope="${slope}" intercept="${intercept}"/>`;
  return `<feTurbulence type="fractalNoise" baseFrequency="0.010" numOctaves="3" seed="23" result="cloud"/>` +
    '<feColorMatrix in="cloud" type="saturate" values="0" result="cloud"/>' +
    '<feGaussianBlur in="cloud" stdDeviation="3" result="soft"/>' +
    `<feComponentTransfer in="soft">${f('R')}${f('G')}${f('B')}` +
    '<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>';
}

const AREA = `(() => {
  const r = document.querySelector('.tpl-tag').getBoundingClientRect();
  return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6,
           width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
})()`;

function apply(index) {
  const markup = markupOf(VARIANTS[index]).replace(/\s+/g, ' ').trim();
  return `(() => { try {
    const old = document.getElementById('try-filter');
    if (old) old.remove();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'try-filter';
    svg.setAttribute('width', '300');
    svg.setAttribute('height', '300');
    svg.innerHTML = '<filter id="tpl-marble-try" x="-40%" y="-40%" width="180%" height="180%">${markup}</filter>';
    document.body.appendChild(svg);
    let style = document.getElementById('try-style');
    if (!style) { style = document.createElement('style'); style.id = 'try-style'; document.head.appendChild(style); }
    style.textContent = '.template-collage .tpl-tag::before { background: #ffffff; filter: url(#tpl-marble-try); }';
    return getComputedStyle(document.querySelector('.tpl-tag'), '::before').filter;
  } catch (e) { return 'ERR ' + e.message; } })()`;
}

/** 量一张胶囊截图里的明暗分布，剔掉金色字母。与量参考图用的是同一套口径。 */
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
  for (let i = 0; i < VARIANTS.length; i++) {
    await probe.run(apply(i));
    await wait(300);
    const img = await probe.win.webContents.capturePage(area);
    const file = path.join(__dirname, `tune-${i}.png`);
    fs.writeFileSync(file, img.toPNG());
    shots.push(img);
    const s = statsOf(file, img.getSize());
    // 距离：三项归一化后取欧氏长度，越小越接近参考
    const d = Math.hypot(
      (s.mean - TARGET.mean) / 30,
      (s.sd - TARGET.sd) / 10,
      (s.range95 - TARGET.range95) / 30,
    );
    rows.push({ ...VARIANTS[i], ...s, distance: +d.toFixed(3) });
  }

  const strip = concat(shots);
  const file = path.join(__dirname, 'tune-sweep.png');
  fs.writeFileSync(file, strip.toPNG());

  report({ target: TARGET, rows: rows.sort((a, b) => a.distance - b.distance), strip: file });
});
