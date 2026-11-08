/**
 * 参考图裁片的统计，到底有多少是「胶囊自己的圆角」贡献的？
 *
 * 【为什么怀疑】`tag-raw.png` 是按 `.tpl-tag` 的矩形裁的（134×303），
 * 而胶囊是圆角的（半径 = 宽的一半）。矩形四角落在**胶囊外**，
 * 那里是深色面板底（#4a5363 一带，亮度约 82）。
 *
 * 后果有两个，方向都是「把靶子做得更极端」：
 *   1. 均值被拉低（127.8），显得参考图比实际更暗。
 *   2. `range95`、`shape24` 被撑高——四角是**大尺度**的极值，
 *      而 shape24 量的正是大尺度起伏。参考图 0.806 里有多少是角？
 *
 * 如果去掉四角后 shape24 掉到我做的那一档（0.65~0.72），
 * 那么「参考图是大块缓慢起伏占主导」这个结论就是假的，
 * 这十几轮按它调参全都白调。
 *
 * 跑法：node tools/measure/ref-mask.cjs
 */
const path = require('node:path');
const { load } = require('./pixels.cjs');

const FILE = path.join(__dirname, 'tag-raw.png');

/** 与 stone-stats.cjs 同一个口径，只是能传掩膜。 */
function stats(px, W, H, keep) {
  const lum = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!keep(x, y)) continue;
      const p = px(x, y);
      lum.push(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]);
    }
  }
  lum.sort((a, b) => a - b);
  const at = q => lum[Math.min(lum.length - 1, Math.max(0, Math.round(q * (lum.length - 1))))];
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);

  // 块均值再算一次 sd：shape24 就是「粗化到 24px 后还剩多少起伏」。
  const shape = size => {
    const blocks = [];
    for (let by = 0; by + size <= H; by += size) {
      for (let bx = 0; bx + size <= W; bx += size) {
        let sum = 0;
        let n = 0;
        for (let y = by; y < by + size; y += 1) {
          for (let x = bx; x < bx + size; x += 1) {
            if (!keep(x, y)) continue;
            const p = px(x, y);
            sum += 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
            n += 1;
          }
        }
        if (n > size * size * 0.5) blocks.push(sum / n);
      }
    }
    const m = blocks.reduce((a, b) => a + b, 0) / blocks.length;
    return Math.sqrt(blocks.reduce((a, b) => a + (b - m) ** 2, 0) / blocks.length);
  };

  const s1 = sd;
  return {
    n: lum.length,
    mean: +mean.toFixed(1),
    sd: +sd.toFixed(2),
    range95: +(at(0.975) - at(0.025)).toFixed(1),
    p5: +at(0.05).toFixed(1),
    p50: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    shape8: +(shape(8) / s1).toFixed(3),
    shape16: +(shape(16) / s1).toFixed(3),
    shape24: +(shape(24) / s1).toFixed(3),
  };
}

const img = load(FILE);
const { W, H } = img;
const px = img.px;
console.log(`size ${W}x${H}`);

// 三种掩膜：
//   full    —— 整个矩形（一直用到现在的口径）
//   round   —— 只保留胶囊内部（圆角按 pill 处理）
//   inner   —— 胶囊再内缩 6px，彻底避开抗锯齿边
const radius = W / 2;
const inPill = (x, y, pad) => {
  const cx = radius;
  const cy = Math.min(Math.max(y, radius), H - radius);
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  return Math.hypot(dx, dy) <= radius - pad;
};

const cases = {
  full: () => true,
  round: (x, y) => inPill(x, y, 0),
  inner: (x, y) => inPill(x, y, 6),
  // 再排除上下两端（DUMBRAVEN 两列字母的上下端最容易顶到边）
  center: (x, y) => inPill(x, y, 10) && y > H * 0.08 && y < H * 0.92,
};

for (const [name, keep] of Object.entries(cases)) {
  console.log(name.padEnd(8), JSON.stringify(stats(px, W, H, keep)));
}
