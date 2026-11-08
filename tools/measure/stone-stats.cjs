/**
 * 量任意一张胶囊截图的石纹分布，口径与 `.tools/ref-full-stats.cjs` 一致。
 *
 * 为什么要通用版本：判「像不像」必须两边用同一把尺子。之前吃过三次亏——
 * 参考图是放大片（低通）、我们的截图是原生尺寸，绝对 sd 根本不可比；
 * 后来又只量参考图边缘窄带，量出来的靶子本身就是错的。
 *
 * 现在两个口径完全对齐：
 * - 都内缩 6% / 3.5% 避开圆角和面板底；
 * - 都把金色字母（含抗锯齿边，膨胀 3px）挖掉；
 * - 都按 1/2/4/8/16/24 px 块算均值 sd，用 `shape = sd(块) / sd(1px)` 比衰减形状。
 *
 * 形状比绝对值可靠：形状只说「大团块占多少」，不受放大倍数影响。
 *
 * 跑法：
 *   node tools/measure/stone-stats.cjs <a.png> [b.png ...]
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

function blockSd(values, w, h, block) {
  const sums = new Map();
  const counts = new Map();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = values[y * w + x];
      if (v === null) continue;
      const key = `${Math.floor(y / block)}:${Math.floor(x / block)}`;
      sums.set(key, (sums.get(key) || 0) + v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const means = [];
  for (const [key, sum] of sums) {
    const count = counts.get(key);
    if (count < block * block * 0.5) continue;
    means.push(sum / count);
  }
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  const sd = Math.sqrt(means.reduce((a, b) => a + (b - mean) ** 2, 0) / means.length);
  return { mean, sd, blocks: means.length };
}

function percentiles(values, ps) {
  const sorted = values.slice().sort((a, b) => a - b);
  const out = {};
  for (const p of ps) {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    out[`p${p}`] = +sorted[idx].toFixed(1);
  }
  return out;
}

/**
 * 块尺寸用**原图像素**还是**按图高等比缩放**？
 *
 * 必须按图高等比：我们的截图 311 高，参考图裁片 303 高，两者接近，但截图
 * 会随窗口尺寸漂（见过 311 和 292 两种）。用固定像素块会让同一份纹理
 * 在不同窗口下算出不同形状，正是「不同轮次截图不可直接比」那条坑的来源。
 * 这里先按 303 高归一再取整。
 */
const REF_H = 303;

function measure(file) {
  const img = load(file);
  const w = img.W;
  const h = img.H;
  const scale = h / REF_H;

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

  const lums = new Array(w * h).fill(null);
  const keep = [];
  for (let y = insetY; y < h - insetY; y += 1) {
    for (let x = insetX; x < w - insetX; x += 1) {
      const i = y * w + x;
      if (skip[i]) continue;
      const [r, g, b] = img.px(x, y);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lums[i] = lum;
      keep.push(lum);
    }
  }

  const mean = keep.reduce((a, b) => a + b, 0) / keep.length;
  const sd = Math.sqrt(keep.reduce((a, b) => a + (b - mean) ** 2, 0) / keep.length);
  const ps = percentiles(keep, [5, 25, 50, 75, 95]);

  const scales = {};
  for (const block of [1, 2, 4, 8, 16, 24]) {
    scales[`b${block}`] = blockSd(lums, w, h, Math.max(1, Math.round(block * scale)));
  }
  const base = scales.b1.sd;
  const shape = Object.fromEntries(
    Object.entries(scales).map(([k, v]) => [k, +(v.sd / base).toFixed(3)]),
  );

  const grads = [];
  for (let y = insetY; y < h - insetY; y += 1) {
    for (let x = insetX; x < w - insetX - 1; x += 1) {
      const a = lums[y * w + x];
      const b = lums[y * w + x + 1];
      if (a === null || b === null) continue;
      grads.push(Math.abs(a - b));
    }
  }

  return {
    name: path.basename(file),
    size: [w, h],
    pixels: keep.length,
    mean: +mean.toFixed(1),
    sd: +sd.toFixed(1),
    range95: +(ps.p95 - ps.p5).toFixed(0),
    percentiles: ps,
    gradientP95: percentiles(grads, [95]).p95,
    // 形状比对：`b24` 越接近 1，说明大团块越占主导（参考图 0.806 已经是最高的一档）
    shape,
    shape24: shape.b24,
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/measure/stone-stats.cjs <a.png> [b.png ...]');
  process.exit(1);
}
console.log(JSON.stringify(files.map(measure), null, 2));
