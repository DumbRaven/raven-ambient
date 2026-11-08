/**
 * 亮度直方图对比：看「干净底 + 少数暗区」与「到处中等起伏」的区别。
 *
 * 为什么需要：`sd` 只说明起伏多大，不说明起伏长什么样。参考图 sd 12.1、
 * 我做的 16.6——我的数值更大，看上去却更平。差别在**分布形状**：
 * 参考图大部分像素挤在亮端、少数拖到暗端（负偏 + 尖峰），
 * 我做的是对称的钟形。这个脚本把两边画成同一套分箱，一眼能看出来。
 *
 * 跑法：
 *   node tools/measure/hist.cjs <a.png> [b.png ...]
 */
const path = require('node:path');

const { load } = require(path.join(__dirname, 'pixels.cjs'));

function isGold(r, g, b) {
  return r > 90 && r - b > 28 && r - g > 8 && g - b > 10;
}

function dilate(mask, w, h, radius) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

const BIN = 8;

function measure(file) {
  const img = load(file);
  const w = img.W;
  const h = img.H;
  const insetX = Math.round(w * 0.06);
  const insetY = Math.round(h * 0.035);

  const gold = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = img.px(x, y);
      if (isGold(r, g, b)) gold[y * w + x] = 1;
    }
  }
  const skip = dilate(gold, w, h, 3);

  const bins = new Array(Math.ceil(256 / BIN)).fill(0);
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  let sum3 = 0;
  for (let y = insetY; y < h - insetY; y += 1) {
    for (let x = insetX; x < w - insetX; x += 1) {
      const i = y * w + x;
      if (skip[i]) continue;
      const [r, g, b] = img.px(x, y);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      bins[Math.min(bins.length - 1, Math.floor(lum / BIN))] += 1;
      n += 1;
      sum += lum;
      sum2 += lum * lum;
      sum3 += lum * lum * lum;
    }
  }

  const mean = sum / n;
  const variance = sum2 / n - mean * mean;
  const sd = Math.sqrt(variance);
  const skew = (sum3 / n - 3 * mean * variance - mean ** 3) / sd ** 3;
  const kurtosis = (sum3 / n - 4 * mean * (sum2 / n) + 6 * mean * mean * mean * (sum / n) - 3 * mean ** 4) / variance ** 2;

  // 归一化成千分比，方便两边直接读
  return {
    name: path.basename(file),
    n,
    mean: +mean.toFixed(1),
    sd: +sd.toFixed(1),
    skew: +skew.toFixed(2),
    kurtosis: +kurtosis.toFixed(2),
    bins: bins.map(v => Math.round((v / n) * 1000)),
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/measure/hist.cjs <a.png> [b.png ...]');
  process.exit(1);
}

const results = files.map(measure);
for (const r of results) {
  console.log(`\n${r.name}  mean ${r.mean}  sd ${r.sd}  skew ${r.skew}  kurt ${r.kurtosis}`);
  const peak = Math.max(...r.bins);
  r.bins.forEach((v, i) => {
    const lo = i * BIN;
    const bar = '#'.repeat(Math.round((v / peak) * 60));
    console.log(`${String(lo).padStart(3)} ${String(v).padStart(4)} ${bar}`);
  });
}
