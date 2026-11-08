/**
 * 胶囊亮度与蓝红差——最省事的一把尺子。
 *
 * 只取**中段窄带**（横向 25%~75%、纵向 20%~80%），跳过金色像素。
 * 为什么不取整条：胶囊是圆角，四角落在深色面板底上，一取就多出一个峰
 * （`hist-round.cjs` 为此专门按圆角造掩膜）。日常只想看「纹理有没有起来、
 * 颜色跟不跟面板」，用这条窄带最快也最稳。
 *
 * 跑法：node tools/measure/tag-stats.cjs <图> [图...]
 * 输出：文件名 + mean / sd / p05 / p95 / blueMinusRed
 */
const path = require('node:path');
const { load } = require('./pixels.cjs');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法：node tools/measure/tag-stats.cjs <图> [图...]');
  process.exit(1);
}

for (const file of files) {
  const image = load(path.resolve(file));
  const x0 = Math.round(image.W * 0.25);
  const x1 = Math.round(image.W * 0.75);
  const y0 = Math.round(image.H * 0.2);
  const y1 = Math.round(image.H * 0.8);

  const lums = [];
  let red = 0, green = 0, blue = 0, kept = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const [r, g, b] = image.px(x, y);
      // 金色（字母与 ✦）一律剔除：它们的边缘梯度远大于石纹，
      // 会把 sd 与色偏一起带偏。
      if (r - b > 26 && r > 96) continue;
      lums.push(0.299 * r + 0.587 * g + 0.114 * b);
      red += r; green += g; blue += b; kept += 1;
    }
  }
  if (!kept) {
    console.log(path.basename(file), 'no usable pixels');
    continue;
  }

  const n = lums.length;
  const mean = lums.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(lums.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  lums.sort((a, b) => a - b);
  const p = q => lums[Math.min(n - 1, Math.floor(n * q))].toFixed(1);

  console.log(
    path.basename(file).padEnd(24),
    'mean', mean.toFixed(1).padStart(5),
    'sd', sd.toFixed(2).padStart(5),
    'p05', p(0.05).padStart(5),
    'p95', p(0.95).padStart(5),
    'blueMinusRed', ((blue - red) / kept).toFixed(1).padStart(6),
    'n', kept,
  );
}
