#!/usr/bin/env node
/**
 * 量金色元素：竖排徽标的每颗字母、四颗 ✦、以及任何金色连通块。
 *
 * 跑法：
 *   node tools/measure/gold.cjs              # 参考图
 *   node tools/measure/gold.cjs <png>        # 任意渲染图
 *
 * 用**连通块**而不是「按列扫」：竖排徽标两列字母加上四颗星探在角外，
 * 按列扫完全分不开，连通块能一块一块列出来（字母和星的大小差 2 倍以上，
 * 一眼能分类）。这是量徽标最可靠的手段。
 *
 * 参考图实测（1917×1072）：
 *   左列 D U M B（x 中心 ≈ 90.87%），右列 R A V E N（x 中心 ≈ 93.48%）
 *   右列顶比左列高 37px（左列顶距胶囊顶 85px、右列 48px）
 *   单字母约 35×43px
 *   四颗 ✦ 22~24px，位置见下
 *   金色中位 rgb(196,143,70) = #c48f46
 *
 * 坑：**别把小图上肉眼判断当成结论**。曾经在小尺寸整幅图上判读「左右列反了」，
 * 打 DOM 才发现顺序一直是对的。列序用 DOM 量，别用眼睛。
 */
const { REF, load, goldBlocks, medianColor } = require('./pixels.cjs');

const file = process.argv[2] || REF;
const full = load(file);
const { W, H } = full;

// 徽标 + 星 + 署名都在画的右半边，裁出来跑得快。
const CROP = {
  x: Math.round(W * 0.62),
  y: 0,
  w: W - Math.round(W * 0.62),
  h: Math.round(H * 0.42),
};
const img = load(file, CROP);

console.log(`FILE ${file} (${W}×${H})  裁切 x=${CROP.x} w=${CROP.w} h=${CROP.h}`);

const blocks = goldBlocks(img, 60);
console.log(`GOLD_BLOCKS 共 ${blocks.length} 块（>=60px）`);
console.log('');
console.log('idx  像素     bbox（画布像素）        画布百分比            尺寸');
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  const ax = b.x0 + CROP.x, ay = b.y0;
  const bx = b.x1 + CROP.x, by = b.y1;
  const [px0, py0] = img.pct(b.x0, b.y0);
  const [px1, py1] = img.pct(b.x1, b.y1);
  console.log(
    `${String(i).padStart(3)}  ${String(b.n).padStart(6)}  ` +
    `[${ax},${ay}]-[${bx},${by}]`.padEnd(28) +
    `[${px0},${py0}]-[${px1},${py1}]`.padEnd(30) +
    `${b.w}×${b.h}px`,
  );
}

// 分类提示：星和字母尺寸差得多，按宽度粗分一下，省得人工数。
const widths = blocks.map(b => b.w).sort((a, b) => a - b);
if (widths.length > 4) {
  const median = widths[widths.length >> 1];
  const small = blocks.filter(b => b.w < median * 0.8);
  const large = blocks.filter(b => b.w >= median * 0.8);
  console.log('');
  console.log(`按宽度分类（中位 ${median}px）：窄块 ${small.length} 个、宽块 ${large.length} 个`);
  console.log('  窄的通常是 ✦ 或 I/N 这种细字母；宽的是 D/M/B/A 这类。');
  console.log('  四颗 ✦ 的确切身份要看像素数——星比同宽字母更瘦。');
}

// 胶囊：**不再按颜色找**。
//
// 试过三次都不可靠：面板 `rgb(74,83,99)` 本身低饱和，整块面板会被算进来；
// 收紧到「连续 ≥70px」又把倒影层的低对比渐变算进来；窗口收到面板右上角后
// 仍然量出 10.07%（准值 7.30%），因为面板外那片 JPEG 噪点也是低饱和亮色。
//
// 改用**四颗 ✦ 的包围盒**间接定位：星探在胶囊四角外侧，比胶囊大一圈，
// 所以星包围盒是胶囊的上界。要准值直接读 DOM：
//   node tools/probe/geo.cjs → 输出里的 `tag` 项就是 getBoundingClientRect
// 参考图实测胶囊 x=[1701,1841]（宽 140px）y=[91,400]（高 309px）。
const stars = blocks.filter(b => b.n >= 100 && b.n <= 400 && b.w >= 18 && b.w <= 30 && b.h >= 18 && b.h <= 30);
if (stars.length >= 3) {
  const sx0 = Math.min(...stars.map(s => s.x0));
  const sx1 = Math.max(...stars.map(s => s.x1));
  const sy0 = Math.min(...stars.map(s => s.y0));
  const sy1 = Math.max(...stars.map(s => s.y1));
  const [px0, py0] = img.pct(sx0, sy0);
  const [px1, py1] = img.pct(sx1, sy1);
  console.log('');
  console.log(
    `STAR_BBOX（${stars.length} 颗星的外接框）画布 [${px0},${py0}]-[${px1},${py1}] ` +
    `w ${(px1 - px0).toFixed(2)}%  h ${(py1 - py0).toFixed(2)}%`,
  );
  console.log('  星比胶囊大一圈，这是胶囊的上界。胶囊准值读 DOM：tools/probe/geo.cjs 的 tag 项。');
}

// 胶囊底色：在星包围盒内缩一点取中位，避开星本身。
if (stars.length >= 3) {
  const sx0 = Math.min(...stars.map(s => s.x0));
  const sx1 = Math.max(...stars.map(s => s.x1));
  const sy0 = Math.min(...stars.map(s => s.y0));
  const sy1 = Math.max(...stars.map(s => s.y1));
  const cx = (sx0 + sx1) >> 1;
  const mid = medianColor(img, cx - 6, sy0 + 60, cx + 6, sy1 - 60);
  if (mid) {
    const hex = '#' + mid.map(v => v.toString(16).padStart(2, '0')).join('');
    console.log(`CAPSULE 底色中位（星框内缩采样）rgb(${mid.join(',')}) = ${hex}`);
  }
}

// 金色中位色
const goldPix = [[], [], []];
for (let y = 0; y < img.H; y += 2) {
  for (let x = 0; x < img.W; x += 2) {
    const [r, g, b] = img.px(x, y);
    if (r > 150 && r - b > 55 && g - b > 25) {
      goldPix[0].push(r); goldPix[1].push(g); goldPix[2].push(b);
    }
  }
}
if (goldPix[0].length > 20) {
  const mid = a => a.sort((p, q) => p - q)[a.length >> 1];
  const [r, g, b] = [mid(goldPix[0]), mid(goldPix[1]), mid(goldPix[2])];
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  console.log(`GOLD 中位 rgb(${r},${g},${b}) = ${hex}`);
}
