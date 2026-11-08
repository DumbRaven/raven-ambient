/**
 * 圆角掩膜下重算直方图：把「面板底色漏进来」的像素排掉。
 *
 * 为什么需要：`hist.cjs` 量到我们这边有两个峰——72（62‰）和 120（334‰），
 * 而参考图只有单峰 136 + 左侧长尾。72 这个峰就是面板底色 `#4a5363`
 * （亮度 82），它从胶囊的**圆角弧线外侧**漏进矩形裁片。
 * 内缩 6%/3.5% 只缩掉 8px，圆角半径是宽的一半，弧线在内缩区里依然存在。
 *
 * 这个脚本按**胶囊自身的圆角形状**造 mask：左右各一个半圆 + 中间竖条，
 * 再各边内缩若干像素。参考图和我们的截图走同一个 mask，
 * 这样 sd 才有可比性。
 *
 * 跑法：
 *   node tools/measure/hist-round.cjs <a.png> [b.png ...]
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

function measure(file, padRatio = 0.10) {
  const img = load(file);
  const w = img.W;
  const h = img.H;

  // 胶囊是「圆角矩形，圆角半径 = 宽的一半」：左右各一个半圆。
  const radius = w / 2;
  const pad = Math.round(radius * padRatio);

  const gold = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = img.px(x, y);
      if (isGold(r, g, b)) gold[y * w + x] = 1;
    }
  }
  const skip = dilate(gold, w, h, 3);

  const bins = new Array(32).fill(0);
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  let sum3 = 0;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // 到竖条中心的横向距离：中间段为 0，两端进半圆
      const dx = Math.max(0, Math.abs(x + 0.5 - w / 2) - (w / 2 - radius));
      const dy = y + 0.5 - h / 2;
      const dist = Math.hypot(dx, dy);
      if (dist > radius - pad) continue;
      const i = y * w + x;
      if (skip[i]) continue;
      const [r, g, b] = img.px(x, y);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      bins[Math.min(31, Math.floor(lum / BIN))] += 1;
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

  return {
    name: path.basename(file),
    n,
    mean: +mean.toFixed(1),
    sd: +sd.toFixed(1),
    skew: +skew.toFixed(2),
    bins: bins.map(v => Math.round((v / n) * 1000)),
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/measure/hist-round.cjs <a.png> [b.png ...]');
  process.exit(1);
}

for (const r of files.map(f => measure(f))) {
  console.log(`\n${r.name}  n ${r.n}  mean ${r.mean}  sd ${r.sd}  skew ${r.skew}`);
  const peak = Math.max(...r.bins);
  r.bins.forEach((v, i) => {
    const bar = '#'.repeat(Math.round((v / peak) * 60));
    console.log(`${String(i * BIN).padStart(3)} ${String(v).padStart(4)} ${bar}`);
  });
}
