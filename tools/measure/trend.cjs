/**
 * 量亮度里有多少是**方向性渐变**（线性趋势），有多少是噪声起伏。
 *
 * 为什么需要：`stone-stats.cjs` 只给 sd / shape，分不清「一块块随机亮暗」和
 * 「整条从上到下慢慢变亮」。参考图看过去像后者——大片连续过渡、看不到团的轮廓。
 * 如果趋势项占比很高，那就不能用噪声去凑，得单独加一层渐变。
 *
 * 做法：最小二乘拟合 lum = a*x + b*y + c（x、y 归一化到 0..1），
 * 报 a、b（每 100% 宽度/高度变化多少亮度）与决定系数 R²，
 * 再把趋势减掉、量剩下的噪声 sd。
 *
 * 跑法：
 *   node tools/measure/trend.cjs <a.png> [b.png ...]
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

  const rows = [];
  for (let y = insetY; y < h - insetY; y += 1) {
    for (let x = insetX; x < w - insetX; x += 1) {
      const i = y * w + x;
      if (skip[i]) continue;
      const [r, g, b] = img.px(x, y);
      rows.push([(x - insetX) / (w - 2 * insetX), (y - insetY) / (h - 2 * insetY), 0.2126 * r + 0.7152 * g + 0.0722 * b]);
    }
  }

  const n = rows.length;
  let sx = 0;
  let sy = 0;
  let su = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxu = 0;
  let syu = 0;
  for (const [x, y, v] of rows) {
    sx += x;
    sy += y;
    su += v;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxu += x * v;
    syu += y * v;
  }

  // 3x3 正规方程（未知数 a, b, c）
  const m = [
    [sxx, sxy, sx, sxu],
    [sxy, syy, sy, syu],
    [sx, sy, n, su],
  ];
  for (let i = 0; i < 3; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < 3; r += 1) if (Math.abs(m[r][i]) > Math.abs(m[pivot][i])) pivot = r;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    for (let r = 0; r < 3; r += 1) {
      if (r === i) continue;
      const f = m[r][i] / m[i][i];
      for (let c = i; c < 4; c += 1) m[r][c] -= f * m[i][c];
    }
  }
  const [a, b, c] = [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];

  const mean = su / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const [x, y, v] of rows) {
    ssTot += (v - mean) ** 2;
    ssRes += (v - (a * x + b * y + c)) ** 2;
  }

  // 逐行均值：看上下两端的实际差，比线性拟合更直观
  const bands = [];
  const bandCount = 6;
  for (let i = 0; i < bandCount; i += 1) {
    const lo = i / bandCount;
    const hi = (i + 1) / bandCount;
    const vals = rows.filter(([, y]) => y >= lo && y < hi).map(([, , v]) => v);
    bands.push(+(vals.reduce((p, q) => p + q, 0) / vals.length).toFixed(1));
  }

  return {
    name: path.basename(file),
    pixels: n,
    mean: +mean.toFixed(1),
    slopeX: +a.toFixed(1),
    slopeY: +b.toFixed(1),
    r2: +(1 - ssRes / ssTot).toFixed(3),
    noiseSd: +Math.sqrt(ssRes / n).toFixed(1),
    totalSd: +Math.sqrt(ssTot / n).toFixed(1),
    bands,
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/measure/trend.cjs <a.png> [b.png ...]');
  process.exit(1);
}
console.log(JSON.stringify(files.map(measure), null, 2));
