/**
 * 把「纹理」从「底色 + 字母」里分离出来量。
 *
 * 【为什么需要它】`stone-stats.cjs` 报的 sd 里混了三样东西：
 *   ① 胶囊本身从上到下的亮度梯度（半透明白玻璃压在深色面板上）；
 *   ② 圆角附近漏进来的面板底；
 *   ③ 金色 DUMBRAVEN 字母的边缘 —— **这一项最大**，实测 `bare`
 *      （完全关掉纹理）也有 textureSd 24.9，和参考图几乎一样，
 *      说明那个数字量的是字母不是石纹。
 *
 * 【三步分离】
 *   1. **挖掉字母**：金色像素（`r > g > b` 且饱和度够、亮度够）判为字母，
 *      再做一次半径 4px 的膨胀（抗锯齿边缘也算进去）；
 *   2. **高通**：亮度图减去半径 24px 的方框模糊，只剩下「比 24px 更细」的起伏；
 *   3. 只在**内缩 14%** 且**不在字母掩膜里**的像素上统计。
 *
 * `R` 取 24px：比参考图特征尺度（相关半衰 ~7~10px）大几倍，
 * 又远小于胶囊宽（134px），滤掉的正是「整块明暗」，留下的正是「石纹」。
 *
 * 用法：
 *   node tools/measure/texture-only.cjs tools/measure/tag-raw.png tools/probe/j27-03-u2.png
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const RADIUS = 24;
const INSET = 0.14;
const DILATE = 4;

/** 用 ffmpeg 解成 RGB24 裸数据（PPM 头比 PGM 好解析，且带三通道）。 */
function rgb(file) {
  const tmp = path.join(os.tmpdir(), `tex-${process.pid}-${path.basename(file)}.ppm`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-pix_fmt', 'rgb24', tmp]);
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);

  // P6 <w> <h> <max>\n<binary>
  let head = 0;
  let seen = 0;
  let w = 0;
  let h = 0;
  while (seen < 4 && head < buf.length) {
    while (head < buf.length && /\s/.test(String.fromCharCode(buf[head]))) head++;
    let start = head;
    while (head < buf.length && !/\s/.test(String.fromCharCode(buf[head]))) head++;
    const token = buf.toString('ascii', start, head);
    if (seen === 1) w = Number(token);
    if (seen === 2) h = Number(token);
    seen++;
  }
  while (head < buf.length && /\s/.test(String.fromCharCode(buf[head]))) head++;

  return { w, h, data: buf.subarray(head, head + w * h * 3) };
}

/** 可分离方框模糊（端点收缩，不循环）。 */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let count = 0;
    for (let x = 0; x < w; x++) {
      sum += src[y * w + Math.min(w - 1, x + r)];
      count++;
      if (x - r - 1 >= 0) {
        sum -= src[y * w + x - r - 1];
        count--;
      }
      tmp[y * w + x] = sum / count;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < h; y++) {
      sum += tmp[Math.min(h - 1, y + r) * w + x];
      count++;
      if (y - r - 1 >= 0) {
        sum -= tmp[(y - r - 1) * w + x];
        count--;
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

/** 方框膨胀：把「是字母」的判定向外扩 r 像素。 */
function dilate(mask, w, h, r) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) out[yy * w + xx] = 1;
      }
    }
  }
  return out;
}

function analyse(file) {
  const { w, h, data } = rgb(file);

  const lum = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    // 金色：红明显高于蓝，且整体不暗。石纹本身是中性灰（r≈g≈b），不会被误判。
    const sat = r - b;
    if (sat > 26 && r > 96) mask[i] = 1;
  }
  const alphabet = dilate(mask, w, h, DILATE);

  const blur = boxBlur(lum, w, h, RADIUS);

  const x0 = Math.round(w * INSET);
  const x1 = Math.round(w * (1 - INSET));
  const y0 = Math.round(h * INSET);
  const y1 = Math.round(h * (1 - INSET));

  const hp = [];
  let rawSum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (alphabet[i]) continue;
      hp.push(lum[i] - blur[i]);
      rawSum += lum[i];
    }
  }
  if (hp.length < 200) return { file: path.basename(file), error: 'not enough clean pixels', clean: hp.length };

  const mean = hp.reduce((a, b) => a + b, 0) / hp.length;
  const sd = Math.sqrt(hp.reduce((a, b) => a + (b - mean) ** 2, 0) / hp.length);
  const sorted = [...hp].sort((a, b) => a - b);
  const p = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

  return {
    file: path.basename(file),
    size: `${w}x${h}`,
    clean: hp.length,
    meanRaw: +(rawSum / hp.length).toFixed(2),
    textureSd: +sd.toFixed(2),
    textureRange95: +(p(0.95) - p(0.05)).toFixed(2),
    textureP05: +p(0.05).toFixed(2),
    textureP95: +p(0.95).toFixed(2),
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node tools/measure/texture-only.cjs <image>...');
  process.exit(1);
}
console.log(JSON.stringify(files.map(analyse), null, 2));
