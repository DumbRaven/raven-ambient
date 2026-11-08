/**
 * 玉石 vs 云雾：两者差别到底落在哪个统计量上。
 *
 * 用户 m07154：「我觉得不是云雾，而是类似于玉石那样的质感，明暗比较分明」。
 *
 * 「明暗分明」不是对比度更大——云雾版的 sd 其实已经和参考图持平了。
 * 分明的是**分布形状**：雾是各向同性的高斯噪声，亮暗连续过渡；
 * 玉石有成块的亮区和暗区，中间过渡窄，直方图因此偏离高斯。
 *
 * 所以这里不量 sd，量四个能区分「糊」与「分明」的东西：
 *   range95    5%~95% 展宽——总跨度
 *   skew       偏度——一边亮得多还是一边暗得多
 *   kurtosis   峰度（高斯为 3）——越大说明越多像素挤在少数几个亮度上，
 *              也就是「成块」，而不是连续铺开
 *   edgeRatio  梯度幅值的高分位 / 中位数——边界是不是突然出现。
 *              雾的边缘缓慢，这个比值接近 1；玉石成块，比值大
 *
 * 跑法：node tools/measure/jade-stats.cjs [图1] [图2] ...
 * 不给参数就量参考图 + 当前两种石纹的截图。
 */
const path = require('node:path');
const { load, lum } = require('./pixels.cjs');

const DEFAULTS = [
  path.join(__dirname, 'tag-ref.png'),
  path.join(__dirname, '..', 'probe', 'stone-sea.png'),
  path.join(__dirname, '..', 'probe', 'stone-cloud.png'),
];

/**
 * 只取**左右两侧没有文字**的窄条。
 *
 * 为什么要这样：参考图的裁片里有金色 DUMBRAVEN 字母，字母边缘的梯度
 * 远大于石纹本身——直接量整块，`gradP50` 会报到 1.58、`gradP95` 12.45，
 * 看着像「参考图的边界陡得多」，实际量的是字母轮廓。我们的截图靠 CSS
 * 藏字母，两边口径根本不一样。
 *
 * 取宽度的 6%~17% 与 83%~94% 两竖条，高度 10%~90%（避开圆角端头）。
 */
const STRIPS = [[0.06, 0.17], [0.83, 0.94]];

/**
 * 两边口径都要先内缩多少。
 *
 * 探针截图是按 `.tpl-tag` 外扩 6px 拍的，最外圈是**面板底色**（深色）。
 * 不内缩的话，那两条窄带会压到面板上，`range95` 直接从 39 飙到 72——
 * 量到的是「胶囊边缘与面板的落差」，不是石纹本身。
 * 参考图裁片当时也内缩了 3px，按 4% 再收一次，两边都落在石纹内部。
 */
const TRIM = 0.04;

function sample(file) {
  const whole = load(file);
  const tx = Math.round(whole.W * TRIM);
  const ty = Math.round(whole.H * TRIM);
  const iw = whole.W - tx * 2;
  const ih = whole.H - ty * 2;

  const y0 = ty + Math.round(ih * 0.06);
  const h = Math.round(ih * 0.88);

  const vals = [];
  const strips = [];
  for (const [a, b] of STRIPS) {
    const x0 = tx + Math.round(iw * a);
    const w = Math.max(2, Math.round(iw * (b - a)));
    const img = load(file, { x: x0, y: y0, w, h });
    for (let y = 0; y < img.H; y++) {
      for (let x = 0; x < img.W; x++) {
        const [r, g, b2] = img.px(x, y);
        vals.push(lum(r, g, b2));
      }
    }
    strips.push(img);
  }
  return { strips, vals };
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function moments(vals) {
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const m2 = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(m2);
  if (!sd) return { mean, sd: 0, skew: 0, kurtosis: 0 };
  const m3 = vals.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  const m4 = vals.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
  return { mean, sd, skew: m3 / sd ** 3, kurtosis: m4 / sd ** 4 };
}

/** 相邻亮度差的绝对值；用 4 邻域，避免噪声把单像素差放大成「边缘」。 */
function gradients(img) {
  const out = [];
  for (let y = 1; y < img.H - 1; y++) {
    for (let x = 1; x < img.W - 1; x++) {
      const dx = Math.abs(lum(...img.px(x + 1, y)) - lum(...img.px(x - 1, y))) / 2;
      const dy = Math.abs(lum(...img.px(x, y + 1)) - lum(...img.px(x, y - 1))) / 2;
      out.push(Math.hypot(dx, dy));
    }
  }
  return out;
}

function measure(file) {
  const { strips, vals } = sample(file);
  const sorted = [...vals].sort((a, b) => a - b);
  const m = moments(vals);
  const p05 = quantile(sorted, 0.05);
  const p95 = quantile(sorted, 0.95);

  const g = strips.flatMap(gradients).sort((a, b) => a - b);
  const g50 = quantile(g, 0.5);
  const g95 = quantile(g, 0.95);
  const g99 = quantile(g, 0.99);

  return {
    file: path.basename(file),
    range95: +(p95 - p05).toFixed(1),
    sd: +m.sd.toFixed(2),
    skew: +m.skew.toFixed(2),
    kurtosis: +m.kurtosis.toFixed(2),
    edge995: +(g99 / Math.max(g50, 1e-6)).toFixed(2),
    edge955: +(g95 / Math.max(g50, 1e-6)).toFixed(2),
    gradP50: +g50.toFixed(2),
    gradP95: +g95.toFixed(2),
    gradP99: +g99.toFixed(2),
  };
}

const files = process.argv.length > 2 ? process.argv.slice(2) : DEFAULTS;
const rows = files.map(measure);
console.table(rows);
console.log(JSON.stringify({ rows }, null, 0));
