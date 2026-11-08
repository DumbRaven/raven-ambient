/**
 * 暗区连通块：量「暗的地方是连成片的，还是碎成点的」。
 *
 * 为什么需要：`hist-round.cjs` 量出的 mean / sd / skew 全都对上参考图之后，
 * 并排看仍不像——参考图的暗部是**几大片**，边缘晕开、彼此连贯；
 * 我做的是**几百个小点**，像发霉。这两者的直方图可以完全一致，
 * 因为直方图只统计「多少个像素有多亮」，不统计「它们挨不挨着」。
 *
 * 做法：
 *   1. 阈值取图中位数（自适应，两边同口径）；
 *   2. 低于阈值的像素标成暗，做 4 邻接的连通域标记；
 *   3. 报暗区占比，以及每个连通块的**等面积直径** = 2·√(面积/π)；
 *   4. 汇总成「块直径的分位数」——参考图应该是二三十像素，碎点是三到五像素。
 *
 * 另外报一个 `skeletonRatio`：连通块面积 ÷ 它的包围盒长边平方。
 * 一条细长的丝这个值很小（<0.05），一个圆斑接近 0.785——用来看「是条还是块」。
 *
 * 跑法：
 *   node tools/measure/blobs.cjs <a.png> [b.png ...]
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

  // 圆角胶囊掩膜
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

  count.sort((a, b) => a - b);
  const median = quantile(count, 0.5);

  // 连通域标记（迭代式，避免深递归爆栈）
  const seen = new Uint8Array(w * h);
  const blobs = [];
  let darkPixels = 0;
  for (let start = 0; start < w * h; start += 1) {
    if (!inside[start] || seen[start] || lums[start] >= median) continue;
    let area = 0;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      area += 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h) continue;
        if (!inside[j] || seen[j] || lums[j] >= median) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    darkPixels += area;
    const long = Math.max(maxX - minX + 1, maxY - minY + 1);
    blobs.push({
      area,
      diameter: 2 * Math.sqrt(area / Math.PI),
      fill: area / (long * long),
      long,
    });
  }

  blobs.sort((a, b) => a.area - b.area);
  const diameters = blobs.map(b => b.diameter).sort((a, b) => a - b);
  const fills = blobs.map(b => b.fill).sort((a, b) => a - b);

  // 「暗的部分有多少集中在大块里」——碎点会接近 0，连续晕块会到 0.6 以上。
  // 阈值 12px 来自参考图：它 p95 直径 33.8，而碎点版 p95 只有 15.9。
  const largeArea = blobs.filter(b => b.diameter >= 12).reduce((sum, b) => sum + b.area, 0);

  return {
    name: path.basename(file),
    median: +median.toFixed(1),
    darkRatio: +(darkPixels / count.length).toFixed(3),
    largeShare: +(largeArea / darkPixels).toFixed(3),
    blobs: blobs.length,
    diam: {
      p50: +quantile(diameters, 0.5).toFixed(1),
      p75: +quantile(diameters, 0.75).toFixed(1),
      p95: +quantile(diameters, 0.95).toFixed(1),
      max: +(diameters[diameters.length - 1] ?? 0).toFixed(1),
    },
    fillP50: +quantile(fills, 0.5).toFixed(3),
    fillP95: +quantile(fills, 0.95).toFixed(3),
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/measure/blobs.cjs <a.png> [b.png ...]');
  process.exit(1);
}

for (const r of files.map(f => measure(f))) {
  console.log(
    `${r.name.padEnd(22)} median ${String(r.median).padStart(5)}  dark ${r.darkRatio}  large ${r.largeShare}  blobs ${String(r.blobs).padStart(4)}  ` +
      `diam p50 ${String(r.diam.p50).padStart(5)} p75 ${String(r.diam.p75).padStart(5)} p95 ${String(r.diam.p95).padStart(6)} max ${String(r.diam.max).padStart(6)}  ` +
      `fill p50 ${r.fillP50} p95 ${r.fillP95}`,
  );
}
