#!/usr/bin/env node
/**
 * 量面板那条弧：是不是正圆、圆心在哪、半径多大、和唱片是否同心、缝多宽。
 *
 * 跑法：
 *   node tools/measure/arc.cjs                          # 默认读参考图
 *   node tools/measure/arc.cjs tools/probe/geo.png      # 或读探针截图
 *
 * 为什么需要它：用户的原话是「唱片的圆心和面板的中心不在一条线」。
 * 光看截图会得出错误结论——必须把弧拟合出来再和唱片圆做差。
 *
 * 算法（每一步都吃过亏，注释里写了为什么这么做）：
 *   1. 面板种子从**面板内部**取（`[0.75W, 0.20H]`）。靠直方图猜同类色会抓到
 *      信息条 `#72777d`，然后整块填充跑到画布左上角去。
 *   2. 底边用**掩码**逐列取最低行，不是按颜色逐列扫。按颜色扫会被唱片照片
 *      里颜色恰好接近的像素骗到，采样掉进唱片里，拟出的半径差 30%。
 *   3. 弧顶 = 图像坐标里 y **最小**的点。别拿 y 最大——那是面板左下角。
 *   4. 拟合窗口要宽（0.75 倍面板宽）。弧段越短 Kasa 拟合越病态。
 *   5. 缝宽沿弧心放射测。**只用可信角度区间**：扫描线一旦穿出面板下边界
 *      就进了页底色，那一段量到的是「面板底到画布底」，不是缝。
 *
 * 已验结论（参考图 1917×1072）：
 *   面板弧是**正圆**（椭圆两半轴差 0.1px，拟合残差 rms 0.42px）
 *   圆心 ≈ (82.5%, 67.7%)，半径 ≈ 16.8% 画布宽
 *   唱片与弧同心，缝宽稳定 20~21px
 *   → 「不在一条线」不是数值错了，是面板色/缝宽/唱片颜色的视觉错觉。
 */
const { REF, load, flood, fitCircle, lum } = require('./pixels.cjs');

const file = process.argv[2] || REF;
const img = load(file);
const { W, H } = img;

const pctX = x => +((x / W) * 100).toFixed(2);
const pctY = y => +((y / H) * 100).toFixed(2);
const f2 = n => +n.toFixed(2);

// —— 1. 面板 ——
const panel = flood(img, Math.round(W * 0.75), Math.round(H * 0.20), 20);
if (!panel) {
  console.error('找不到面板：种子点颜色不匹配，确认这张图是放映页、版式是 collage');
  process.exit(1);
}
console.log(`FILE ${file} (${W}×${H})`);
console.log(
  `PANEL n=${panel.n} bbox=[${panel.x0},${panel.y0}]-[${panel.x1},${panel.y1}] ` +
  `pct=[${pctX(panel.x0)},${pctY(panel.y0)}]-[${pctX(panel.x1)},${pctY(panel.y1)}]`,
);

// —— 2. 底边（用掩码） ——
const bottom = new Map();
for (let x = panel.x0; x <= panel.x1; x++) {
  let low = -1;
  for (let y = panel.y1; y >= panel.y0; y--) {
    if (panel.mask[y * W + x]) { low = y; break; }
  }
  if (low > 0) bottom.set(x, low);
}
const pts = [...bottom.entries()].map(([x, y]) => [x, y]);
if (pts.length < 50) {
  console.error(`底边采样点太少（${pts.length}）`);
  process.exit(1);
}

// —— 3. 弧顶 = y 最小 ——
const apex = pts.reduce((a, b) => (b[1] < a[1] ? b : a));

// —— 4. 拟合（宽窗口） ——
const span = panel.w * 0.75;
const arcPts = pts.filter(([x]) => Math.abs(x - apex[0]) <= span / 2);
const circle = fitCircle(arcPts);
if (!circle) {
  console.error('圆拟合失败：点共线或太少');
  process.exit(1);
}

console.log(
  `ARC apex=(${apex[0]},${apex[1]}) pct=(${pctX(apex[0])},${pctY(apex[1])}) ` +
  `sampled=${arcPts.length} pts, x ${arcPts[0][0]}..${arcPts[arcPts.length - 1][0]}`,
);
console.log(
  `CIRCLE center=(${circle.cx.toFixed(1)},${circle.cy.toFixed(1)}) ` +
  `pct=(${pctX(circle.cx)},${pctY(circle.cy)}) ` +
  `R=${circle.r.toFixed(1)}px = ${f2((circle.r / W) * 100)}% W（直径 ${f2((circle.r * 2 / W) * 100)}% W）`,
);
console.log(
  `  residual rms=${circle.rms.toFixed(2)}px 范围 [${circle.min.toFixed(1)},${circle.max.toFixed(1)}] ` +
  `→ ${circle.rms < 1.5 ? '是正圆' : '不像正圆（采样可能被污染）'}`,
);

// —— 5. 缝宽：沿弧心放射，只用上半圈可信段 ——
// 角度以弧心为原点、0=右、90=下（图像坐标 y 向下）。弧在弧心上方，故可信段约 195°~345°。
const bg = [28, 36, 51]; // 页底色 #1c2433；换成别的主题时这里会失准，届时加自动取色
const isBg = (r, g, b) => Math.abs(r - bg[0]) < 30 && Math.abs(g - bg[1]) < 30 && Math.abs(b - bg[2]) < 30;

const samples = [];
for (let deg = 190; deg <= 350; deg += 5) {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  let start = -1, end = -1;
  for (let r = circle.r * 0.80; r < circle.r * 1.6; r += 0.5) {
    const x = Math.round(circle.cx + dx * r);
    const y = Math.round(circle.cy + dy * r);
    if (x < 0 || y < 0 || x >= W || y >= H) break;
    const [rr, gg, bb] = img.px(x, y);
    const inGap = isBg(rr, gg, bb);
    if (inGap && start < 0) start = r;
    if (start >= 0 && !inGap) { end = r; break; }
  }
  if (start >= 0 && end > start) samples.push({ deg, inner: start, width: end - start });
}

if (samples.length >= 6) {
  const widths = samples.map(s => s.width).sort((a, b) => a - b);
  const median = widths[widths.length >> 1];
  const stable = samples.filter(s => Math.abs(s.width - median) < 6);
  const inners = stable.map(s => s.inner);
  const iMin = Math.min(...inners), iMax = Math.max(...inners);
  console.log(
    `GAP median=${median.toFixed(1)}px (${f2((median / W) * 100)}% W) 稳定样本 ${stable.length}/${samples.length}`,
  );
  console.log(
    `  inner R 范围 [${iMin.toFixed(1)},${iMax.toFixed(1)}] → 洞与唱片偏移 ≤${((iMax - iMin) / 2).toFixed(1)}px` +
    ` → ${(iMax - iMin) < 12 ? '基本同心' : '不同心，仔细看'}`,
  );
} else {
  console.log(`GAP 可信样本不足（${samples.length}），这张图的页底色不是 #1c2433？`);
}

// —— 6. 和 CSS 里的值对一下 ——
console.log('');
console.log('对照 CSS（src/skin-bold.css 的 .tpl-disc / .tpl-block-panel clip-path）：');
console.log('  唱片 left/top 是圆心、width 是直径，都相对画布。');
console.log('  弧心应当与唱片圆心重合，半径 = 唱片半径 + 缝宽。');
