/**
 * 量参考图「暗色晕块」的走向与宽度。
 *
 * 为什么需要：8 倍放大看（`ref-a.png`）才看清参考图不是条纹也不是纯雾——
 * 是**边缘柔和的暗色晕块**，宽十几到三十像素、有明确走向。
 * 之前两轮分别做成「各向同性雾」和「笔直竖条」，都不对。
 * 要找的是「晕块有多宽、朝哪个方向倒」。
 *
 * 做法：Sobel 梯度 → 结构张量（局部 7×7 窗口）→ 主方向直方图。
 * 梯度方向垂直于纹理走向，所以纹理走向 = 梯度方向 + 90°。
 * 同时用梯度的水平/垂直分量比估各向异性。
 *
 * 用法：node tools/measure/vein-orient.cjs
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const REF = path.join(ROOT, 'tools', 'measure', 'tag-raw.png');

const probe = execFileSync(
  'ffprobe',
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', REF],
  { encoding: 'utf8' },
).trim();
const [W, H] = probe.split(',').map(Number);
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', REF, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
  maxBuffer: 1 << 28,
});

const lum = new Float32Array(W * H);
const gold = new Uint8Array(W * H);
for (let i = 0, p = 0; i < W * H; i += 1, p += 3) {
  const r = raw[p];
  const g = raw[p + 1];
  const b = raw[p + 2];
  lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  if (r - b > 26 && r > 96) gold[i] = 1;
}
// 字母方框膨胀 4px
const bad = new Uint8Array(W * H);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    if (!gold[y * W + x]) continue;
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) bad[yy * W + xx] = 1;
      }
    }
  }
}

// Sobel
const gx = new Float32Array(W * H);
const gy = new Float32Array(W * H);
for (let y = 1; y < H - 1; y += 1) {
  for (let x = 1; x < W - 1; x += 1) {
    const i = y * W + x;
    gx[i] =
      -lum[i - W - 1] + lum[i - W + 1] - 2 * lum[i - 1] + 2 * lum[i + 1] - lum[i + W - 1] + lum[i + W + 1];
    gy[i] =
      -lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1] + lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1];
  }
}

// 结构张量：7×7 窗口累加
const RAD = 3;
const hist = new Array(12).fill(0); // 每 15°
let weightSum = 0;
let sumGx2 = 0;
let sumGy2 = 0;
let sumGxGy = 0;
const edges = [];
const inset = 0.14;

for (let y = RAD + 1; y < H - RAD - 1; y += 1) {
  for (let x = RAD + 1; x < W - RAD - 1; x += 1) {
    if (x < W * inset || x > W * (1 - inset) || y < H * inset || y > H * (1 - inset)) continue;
    if (bad[y * W + x]) continue;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let dirty = false;
    for (let dy = -RAD; dy <= RAD; dy += 1) {
      for (let dx = -RAD; dx <= RAD; dx += 1) {
        const j = (y + dy) * W + x + dx;
        if (bad[j]) dirty = true;
        sxx += gx[j] * gx[j];
        syy += gy[j] * gy[j];
        sxy += gx[j] * gy[j];
      }
    }
    if (dirty) continue;
    // 主方向
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const mag = Math.hypot(sxx - syy, 2 * sxy);
    if (mag < 1e-6) continue;
    // 梯度方向 → 纹理走向（+90°）
    let dir = (theta + Math.PI / 2) * (180 / Math.PI);
    dir = ((dir % 180) + 180) % 180;
    hist[Math.min(11, Math.floor(dir / 15))] += mag;
    weightSum += mag;
    sumGx2 += sxx;
    sumGy2 += syy;
    sumGxGy += sxy;
    edges.push({ x, y, dir, mag });
  }
}

// 各向异性：梯度能量在 x/y 的比。纹理若是纵向拉长，梯度的 y 分量更大。
const anisotropy = Math.sqrt(sumGy2 / sumGx2);

// 晕块宽度：沿梯度主方向做二阶差分，找「亮-暗-亮」的跨度
// 简化：用水平与垂直方向的一维自相关半衰（与 texture-scale 同法，但这里分方向看能量）
function halfDecay(axis) {
  const maxLag = axis === 'x' ? Math.floor(W * 0.4) : Math.floor(H * 0.4);
  const res = [];
  for (let c = 0; c < 12; c += 1) {
    const frac = (c + 0.5) / 12;
    const line = [];
    if (axis === 'x') {
      const y = Math.round(H * (0.15 + 0.7 * frac));
      for (let x = Math.round(W * inset); x < W * (1 - inset); x += 1) line.push(lum[y * W + x]);
    } else {
      const x = Math.round(W * (0.15 + 0.7 * frac));
      for (let y = Math.round(H * inset); y < H * (1 - inset); y += 1) line.push(lum[y * W + x]);
    }
    if (line.length < 30) continue;
    const mean = line.reduce((a, b) => a + b, 0) / line.length;
    let v0 = 0;
    for (const v of line) v0 += (v - mean) ** 2;
    v0 /= line.length;
    if (v0 < 1e-6) continue;
    for (let lag = 1; lag < Math.min(maxLag, line.length - 1); lag += 1) {
      let acc = 0;
      for (let i = 0; i + lag < line.length; i += 1) acc += (line[i] - mean) * (line[i + lag] - mean);
      acc /= line.length - lag;
      if (acc / v0 <= 0.5) {
        res.push(lag);
        break;
      }
    }
  }
  res.sort((a, b) => a - b);
  return res.length ? res[Math.floor(res.length / 2)] : null;
}

const out = {
  size: [W, H],
  samples: edges.length,
  // 纹理走向直方图（度，0=水平向右，90=竖直向下）
  dirHistogram: hist.map((v, i) => ({ from: i * 15, to: i * 15 + 15, weight: Math.round((v / weightSum) * 1000) / 10 })),
  dominantDir: hist.indexOf(Math.max(...hist)) * 15 + 7.5,
  anisotropy: Math.round(anisotropy * 100) / 100,
  halfDecayX: halfDecay('x'),
  halfDecayY: halfDecay('y'),
};

console.log(JSON.stringify(out, null, 2));
