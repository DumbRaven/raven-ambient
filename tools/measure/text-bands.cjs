#!/usr/bin/env node
/**
 * 量面板内文字的位置：一行一行扫，合成「文字带」。
 *
 * 跑法：
 *   node tools/measure/text-bands.cjs                              # 参考图
 *   node tools/measure/text-bands.cjs tools/probe/geo.png          # 探针截图
 *   node tools/measure/text-bands.cjs <png> <底块>                # 指定底块名
 *
 * 底块决定扫描窗口与底色，可选：
 *   panel  面板（默认）—— 介绍四行 / 倒影四行 / 标题三行
 *   bar    信息条      —— TITLE / PHOTOGRAPHY / PLAYLIST / 曲目串
 *   words  只管标题三行（窗口避开右上竖排胶囊）
 *
 * **为什么要有「words」这个模式**：标题区扫描窗一旦放宽到画布 90%，
 * 右上竖排胶囊的金色字母会被亮度阈值当成文字，把三行合并成一个 8.4% 高的
 * 假文字带。这个假值骗过我一轮。窗口必须收窄到 85%。
 *
 * 判据：亮度 > 底色亮度 + threshold（默认 25）。面板底色约 83、信息条约 119，
 * 所以阈值是**相对**的，不写死。
 */
const { REF, load, flood, bands, lum, medianColor } = require('./pixels.cjs');

const file = process.argv[2] || REF;
const which = process.argv[3] || 'panel';

const img = load(file);
const { W, H } = img;

// 底块定义：种子点 + 扫描窗（画布百分比）。种子必须落在块内部。
const BLOCKS = {
  panel: {
    seed: [0.75, 0.20],
    win: { x0: 0.665, x1: 0.885, y0: 0.04, y1: 0.62 },
    // 面板里的文字是浅色（在深面板上），阈值往上加。
    scan: 'light',
  },
  bar: {
    seed: [0.20, 0.78],
    win: { x0: 0.03, x1: 0.62, y0: 0.71, y1: 0.96 },
    // 信息条上也是浅色字，但底色更亮，阈值同样往上加。
    scan: 'light',
  },
  words: {
    // 种子放在面板里、倒影与标题之间的空白处。[0.75, 0.50] 会落到唱片上，
    // 底色亮度量成 185，阈值随之虚高到 210，只剩最亮的字能过。踩过。
    seed: [0.72, 0.28],
    // 右边界 0.85：再往右就是竖排胶囊的金色字母，会被当成文字。踩过。
    win: { x0: 0.665, x1: 0.85, y0: 0.29, y1: 0.40 },
    scan: 'light',
  },
};

const cfg = BLOCKS[which];
if (!cfg) {
  console.error(`未知底块「${which}」，可选：${Object.keys(BLOCKS).join(' / ')}`);
  process.exit(1);
}

const seedX = Math.round(W * cfg.seed[0]);
const seedY = Math.round(H * cfg.seed[1]);
const block = flood(img, seedX, seedY, 22);
const base = block ? lum(...block.seed) : lum(...medianColor(img, seedX - 10, seedY - 10, seedX + 10, seedY + 10));
const threshold = base + 25;

const X0 = Math.round(W * cfg.win.x0), X1 = Math.round(W * cfg.win.x1);
const Y0 = Math.round(H * cfg.win.y0), Y1 = Math.round(H * cfg.win.y1);

console.log(`FILE ${file} (${W}×${H})`);
console.log(
  `BLOCK ${which} seed=(${seedX},${seedY}) baseLum=${base.toFixed(1)} thr=${threshold.toFixed(1)} ` +
  `窗口 x[${X0},${X1}] y[${Y0},${Y1}]`,
);
if (block) {
  console.log(
    `  连通块 bbox=[${block.x0},${block.y0}]-[${block.x1},${block.y1}] ` +
    `pct=[${((block.x0 / W) * 100).toFixed(2)},${((block.y0 / H) * 100).toFixed(2)}]` +
    `-[${((block.x1 / W) * 100).toFixed(2)},${((block.y1 / H) * 100).toFixed(2)}]`,
  );
}

const found = bands(y => {
  let n = 0, lo = -1, hi = -1;
  for (let x = X0; x < X1; x++) {
    const [r, g, b] = img.px(x, y);
    if (lum(r, g, b) > threshold) {
      n++;
      if (lo < 0) lo = x;
      if (x > hi) hi = x;
    }
  }
  return { n, lo, hi };
}, Y0, Y1, 2, 2);

console.log('');
console.log('BANDS（y/高/x 全是画布百分比）');
for (const b of found) {
  const y0 = ((b.y0 / H) * 100).toFixed(2);
  const h = (((b.y1 - b.y0 + 1) / H) * 100).toFixed(2);
  const x0 = ((b.lo / W) * 100).toFixed(2);
  const w = (((b.hi - b.lo + 1) / W) * 100).toFixed(2);
  const wrap = b.hi >= X1 - 1 ? '  ← 贴到窗口右边界，可能被截，考虑放宽' : '';
  console.log(`  y ${y0}%  h ${h}%   x ${x0}%  w ${w}%${wrap}`);
}

if (block) {
  console.log('');
  console.log('相对底块（左/上，相对块自身宽高）');
  for (const b of found) {
    const lx = ((b.lo - block.x0) / block.w) * 100;
    const ly = ((b.y0 - block.y0) / block.h) * 100;
    console.log(`  y ${ly.toFixed(2)}%  左 ${lx.toFixed(2)}%`);
  }
}
