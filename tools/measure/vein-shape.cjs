/**
 * 暗区形状：是「细长的枝」还是「圆斑」？分布得均不均匀？
 *
 * 为什么需要：`blobs.cjs` 只量「连成片没有」（`largeShare`、直径分位数），
 * 但「一大片圆斑」和「一大片枝杈」在它那里可以一样。用户 m09596 要的是
 * 后者——「细长的样子而不是点，就好像树根，有各种枝杈」。
 *
 * 两个判据：
 *   1. **elongation**：每个连通块的协方差矩阵特征值之比 √(λ1/λ2)。
 *      一个圆斑 ≈ 1.0；一条 3:1 的短线 ≈ 3；树根那种主干 ≈ 5 以上。
 *      报按面积加权的 p50 / p75。
 *   2. **coverage**：把胶囊切成 3 列 × 6 行的格子，数「暗像素占比超过
 *      全场中位数」的格子比例。暗区挤在角落 → 0.3 左右；均匀铺开 → 0.9 以上。
 *
 * 另报 `branch`：暗区骨架长度 ÷ 暗区面积开方。细长的枝条这个值大
 * （同样的面积，周长更长、骨架更长），圆斑小。用 4 邻接边数近似周长，
 * 骨架长度取「面积 ÷ 平均宽度」，平均宽度由面积与周长关系反推，够做相对比较。
 *
 * 跑法：node tools/measure/vein-shape.cjs <a.png> [b.png ...]
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

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

function measure(file, padRatio = 0.10) {
  const img = load(file);
  const w = img.W;
  const h = img.H;
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

  const inside = new Uint8Array(w * h);
  const lums = new Float32Array(w * h);
  const count = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = Math.max(0, Math.abs(x + 0.5 - w / 2) - (w / 2 - radius));
      const dy = y + 0.5 - h / 2;
      if (Math.hypot(dx, dy) > radius - pad) continue;
      const i = y * w + x;
      if (skip[i]) continue;
      const [r, g, b] = img.px(x, y);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lums[i] = lum;
      inside[i] = 1;
      count.push(lum);
    }
  }
  if (!count.length) return { name: path.basename(file), error: 'no pixels' };

  count.sort((a, b) => a - b);
  const median = quantile(count, 0.5);

  // --- 连通域 + 每块的二阶矩 ---
  const seen = new Uint8Array(w * h);
  const blobs = [];
  const darkMask = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start += 1) {
    if (!inside[start] || seen[start] || lums[start] >= median) continue;
    const points = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      points.push(i);
      darkMask[i] = 1;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h) continue;
        if (!inside[j] || seen[j] || lums[j] >= median) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (points.length < 8) continue;

    let sx = 0, sy = 0;
    for (const i of points) { sx += i % w; sy += Math.floor(i / w); }
    const cx = sx / points.length;
    const cy = sy / points.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const i of points) {
      const dx = (i % w) - cx;
      const dy = Math.floor(i / w) - cy;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    sxx /= points.length;
    syy /= points.length;
    sxy /= points.length;
    const trace = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const disc = Math.max(0, trace * trace / 4 - det);
    const l1 = trace / 2 + Math.sqrt(disc);
    const l2 = Math.max(1e-6, trace / 2 - Math.sqrt(disc));
    blobs.push({
      area: points.length,
      elongation: Math.sqrt(Math.max(1, l1 / l2)),
    });
  }

  // --- 周长（4 邻接边界边）用来估平均宽度 ---
  let perimeter = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!darkMask[i]) continue;
      if (x === 0 || !darkMask[i - 1]) perimeter += 1;
      if (x === w - 1 || !darkMask[i + 1]) perimeter += 1;
      if (y === 0 || !darkMask[i - w]) perimeter += 1;
      if (y === h - 1 || !darkMask[i + w]) perimeter += 1;
    }
  }
  const darkArea = blobs.reduce((sum, b) => sum + b.area, 0);
  // 带状物体的面积 ≈ 骨架长度 × 宽度，周长 ≈ 2 × 骨架长度（宽度可忽略）
  const skeleton = perimeter / 2;
  const meanWidth = skeleton > 0 ? darkArea / skeleton : 0;

  // --- 3×6 网格的覆盖均匀度 ---
  const COLS = 3;
  const ROWS = 6;
  const x0 = Math.round(w * 0.08);
  const x1 = Math.round(w * 0.92);
  const y0 = Math.round(h * 0.04);
  const y1 = Math.round(h * 0.96);
  const cellDark = [];
  const cellAll = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      let dark = 0, all = 0;
      const left = Math.round(x0 + (x1 - x0) * c / COLS);
      const right = Math.round(x0 + (x1 - x0) * (c + 1) / COLS);
      const top = Math.round(y0 + (y1 - y0) * r / ROWS);
      const bottom = Math.round(y0 + (y1 - y0) * (r + 1) / ROWS);
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const i = y * w + x;
          if (!inside[i]) continue;
          all += 1;
          if (darkMask[i]) dark += 1;
        }
      }
      if (all < 40) continue;
      cellDark.push(dark / all);
      cellAll.push(all);
    }
  }
  const cellMean = cellDark.reduce((a, v) => a + v, 0) / Math.max(1, cellDark.length);
  // 覆盖：格子里的暗占比不低于整体一半的格子比例。
  const coverage = cellDark.filter(v => v >= cellMean * 0.5).length / Math.max(1, cellDark.length);
  const spreadSd = Math.sqrt(cellDark.reduce((a, v) => a + (v - cellMean) ** 2, 0) / Math.max(1, cellDark.length));

  // 加权到面积：小块不计入细长判断（它们本来就是碎渣）。
  const weighted = [];
  for (const b of blobs) {
    const weight = Math.round(b.area / 20);
    for (let k = 0; k < weight; k += 1) weighted.push(b.elongation);
  }
  weighted.sort((a, b) => a - b);

  return {
    name: path.basename(file),
    median: +median.toFixed(1),
    darkRatio: +(darkArea / count.length).toFixed(3),
    elongation: {
      p50: +quantile(weighted, 0.5).toFixed(2),
      p75: +quantile(weighted, 0.75).toFixed(2),
      p90: +quantile(weighted, 0.9).toFixed(2),
    },
    meanWidth: +meanWidth.toFixed(1),
    coverage: +coverage.toFixed(2),
    spreadSd: +spreadSd.toFixed(3),
    cells: cellDark.length,
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/measure/vein-shape.cjs <a.png> [b.png ...]');
  process.exit(1);
}

for (const r of files.map(f => measure(f))) {
  if (r.error) {
    console.log(`${r.name.padEnd(22)} ${r.error}`);
    continue;
  }
  console.log(
    `${r.name.padEnd(22)} dark ${String(r.darkRatio).padStart(5)}  ` +
      `elong p50 ${String(r.elongation.p50).padStart(5)} p75 ${String(r.elongation.p75).padStart(5)} p90 ${String(r.elongation.p90).padStart(5)}  ` +
      `width ${String(r.meanWidth).padStart(5)}  coverage ${r.coverage}  spreadSd ${r.spreadSd}`,
  );
}
