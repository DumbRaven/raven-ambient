#!/usr/bin/env node
/**
 * 量右下角署名 `Produced By / DumbRaven` 的两行金字，以及它底下那条磨砂胶囊。
 *
 * 跑法：
 *   node tools/measure/produced.cjs             # 参考图
 *   node tools/measure/produced.cjs <png>       # 任意渲染图
 *
 * 输出：
 *   BAND 每行金字的 y / 高 / x / 宽（画布百分比）
 *   CAPSULE 半透明胶囊的包围盒
 *   GOLD 金字核心色、胶囊中位色
 *
 * 参考图实测（1917×1072）：
 *   第一行 y 84.51..86.57  x 88.78..99.43   h=23px
 *   中间那条 h=4px 的是 `Produced By` 里 y 的下降部，**不是字号差异**
 *   第二行 y 87.78..89.83  x 89.15..99.06   h=23px
 *   胶囊 x=[1676,1905] y=[884,983] → 画布 87.43/82.46，w 11.94%，h 9.33%
 *   金字核心色 rgb(212,160,64) = #d4a040（直方图 1712/2907 像素）
 *
 * 两个坑：
 *   - **必须按裁切偏移换算**。这个脚本内部做了裁切来省内存，返回的是裁切图内
 *     坐标，下面统一用 `img.pct()` 换算。早先另一个脚本把它当画布绝对坐标，
 *     「字号没变」的假象骗了一整轮。
 *   - **别把两行当成字号不同**。中间那条 4px 是 descender。曾经据此把字号
 *     压到 1.34cqw，错了。
 */
const { REF, load, bands, medianColor } = require('./pixels.cjs');

const file = process.argv[2] || REF;
const full = load(file);
const { W, H } = full;

// 只在右下角这一块干活，省内存也少干扰。
const CROP = {
  x: Math.round(W * 0.85),
  y: Math.round(H * 0.80),
  w: Math.round(W * 0.15),
  h: Math.round(H * 0.12),
};
const img = load(file, CROP);

console.log(`FILE ${file} (${W}×${H})  裁切 x=${CROP.x} y=${CROP.y} w=${CROP.w} h=${CROP.h}`);

// 金色字：这个区域里只有署名的字是金色。
const goldRows = bands(y => {
  let n = 0, lo = -1, hi = -1;
  for (let x = 0; x < img.W; x++) {
    const [r, g, b] = img.px(x, y);
    if (r > 140 && r - b > 55 && g - b > 25) {
      n++;
      if (lo < 0) lo = x;
      if (x > hi) hi = x;
    }
  }
  return { n, lo, hi };
}, 0, img.H, 3, 1);

console.log('');
console.log('BAND（画布百分比）');
for (const b of goldRows) {
  const [x0, y0] = img.pct(b.lo, b.y0);
  const [x1, y1] = img.pct(b.hi, b.y1);
  console.log(
    `  y ${y0}..${y1}  x ${x0}..${x1}  ` +
    `h=${b.y1 - b.y0 + 1}px@${W}  (${(((b.y1 - b.y0 + 1) / H) * 100).toFixed(2)}% H)`,
  );
}

// 胶囊：半透明灰白，低饱和但不是金色。
const capsuleRows = bands(y => {
  let n = 0, lo = -1, hi = -1;
  for (let x = 0; x < img.W; x++) {
    const [r, g, b] = img.px(x, y);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 30 && r > 110 && r < 215) {
      n++;
      if (lo < 0) lo = x;
      if (x > hi) hi = x;
    }
  }
  return { n, lo, hi };
}, 0, img.H, 20, 3);

if (capsuleRows.length) {
  const cap = capsuleRows.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
  const [cx0, cy0] = img.pct(cap.lo, cap.y0);
  const [cx1, cy1] = img.pct(cap.hi, cap.y1);
  console.log('');
  console.log(
    `CAPSULE x=[${cap.lo + CROP.x},${cap.hi + CROP.x}] y=[${cap.y0 + CROP.y},${cap.y1 + CROP.y}] ` +
    `→ 画布 ${cx0}/${cy0}  w ${(cx1 - cx0).toFixed(2)}%  h ${(cy1 - cy0).toFixed(2)}%`,
  );
  const mid = medianColor(img, cap.lo + 8, cap.y0 + 8, cap.hi - 8, cap.y1 - 8);
  if (mid) console.log(`CAPSULE 底色中位 rgb(${mid.join(',')})`);
}

// 金色核心色：取金色像素的中位，比单点稳。
const goldPix = [[], [], []];
for (let y = 0; y < img.H; y++) {
  for (let x = 0; x < img.W; x++) {
    const [r, g, b] = img.px(x, y);
    if (r > 170 && r - b > 70 && g - b > 40) {
      goldPix[0].push(r); goldPix[1].push(g); goldPix[2].push(b);
    }
  }
}
if (goldPix[0].length > 50) {
  const mid = a => a.sort((p, q) => p - q)[a.length >> 1];
  const [r, g, b] = [mid(goldPix[0]), mid(goldPix[1]), mid(goldPix[2])];
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  console.log(`GOLD 核心 rgb(${r},${g},${b}) = ${hex} （${goldPix[0].length} 像素）`);
}
