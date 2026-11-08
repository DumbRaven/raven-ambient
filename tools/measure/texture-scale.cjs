/**
 * 纹理尺度对拍：参考图 vs 我们渲染的截图，用**完全同一套**函数。
 *
 * 【为什么必须对拍】纹理粗细没法用眼睛比（两张图不同尺寸不同衬底），
 * 也没法用 sd / range95 比（那是幅度，不是尺度）。
 * 唯一与尺度直接相关的是**自相关随距离的衰减速度**：
 * 丝越细，走几步就几乎不相关；团块越大，要走很远才掉下来。
 *
 * 指标：`lagN` = 相隔 N 像素的两点亮度相关系数。
 * `half` = 相关系数掉到 0.5 时的距离（亚像素精度，线性插值），
 * 直接读作「纹理的特征尺度」。
 *
 * 【上一轮犯的错（写在这里免得再犯）】之前拿 700px 的放大片量出
 * `half x=29 y=41`，然后把它当成**原图**的像素数，得出「团块十几到几十像素」
 * 的结论——实际放大倍数是 5，换算回原图只有 `x=5.5 y=7.8`。
 * 结论从「大团块」直接翻成「细丝」，而我的管线一直在做 50~200px 的周期，
 * 差了二十倍。这就是用户连说三次「丝太粗」的根因。
 *
 * 跑法：node tools/measure/texture-scale.cjs <图> [<图> ...]
 */
const path = require('node:path');
const { load } = require('./pixels.cjs');

/** 只取胶囊内部（圆角掩膜），避免四角的深色面板底污染。 */
function pillMask(W, H, pad) {
  const r = W / 2;
  return (x, y) => {
    const cy = Math.min(Math.max(y + 0.5, r), H - r);
    const dx = x + 0.5 - r;
    const dy = y + 0.5 - cy;
    return Math.hypot(dx, dy) <= r - pad;
  };
}

function luminance(img, keep) {
  const { W, H } = img;
  const out = [];
  for (let y = 0; y < H; y += 1) {
    const row = [];
    for (let x = 0; x < W; x += 1) {
      row.push(keep(x, y) ? 0.2126 * img.px(x, y)[0] + 0.7152 * img.px(x, y)[1] + 0.0722 * img.px(x, y)[2] : NaN);
    }
    out.push(row);
  }
  return out;
}

/** 相隔 (dx,dy) 的相关系数，跳过任一端在掩膜外的点对。 */
function corrAt(lum, W, H, dx, dy) {
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = 0; y + Math.abs(dy) < H; y += 1) {
    for (let x = 0; x + Math.abs(dx) < W; x += 1) {
      const a = lum[y][x];
      const b = lum[y + dy][x + dx];
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      n += 1;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
  }
  if (n < 64) return NaN;
  const ma = sa / n;
  const mb = sb / n;
  const va = saa / n - ma * ma;
  const vb = sbb / n - mb * mb;
  const cov = sab / n - ma * mb;
  if (va <= 1e-9 || vb <= 1e-9) return NaN;
  return cov / Math.sqrt(va * vb);
}

/** 相关系数掉到 0.5 的距离；没掉到就返回 null（说明比窗口还大）。 */
function halfDistance(lum, W, H, axis) {
  const prev = { d: 0, c: 1 };
  for (let d = 1; d <= 48; d += 1) {
    const c = axis === 'x' ? corrAt(lum, W, H, d, 0) : corrAt(lum, W, H, 0, d);
    if (Number.isNaN(c)) break;
    if (c <= 0.5) {
      // 线性插值到 0.5 的位置，避免整数步长的量化误差。
      const t = (prev.c - 0.5) / (prev.c - c);
      return +(prev.d + t * (d - prev.d)).toFixed(2);
    }
    prev.d = d;
    prev.c = c;
  }
  return null;
}

for (const file of process.argv.slice(2)) {
  const img = load(path.resolve(file));
  const { W, H } = img;
  const keep = pillMask(W, H, Math.max(2, Math.round(W * 0.03)));
  const lum = luminance(img, keep);
  const lags = [1, 2, 3, 4, 6, 8, 12, 16].map(d => [d, corrAt(lum, W, H, d, 0), corrAt(lum, W, H, 0, d)]);
  console.log(path.basename(file), `${W}x${H}`);
  console.log('  lags', lags.map(([d, cx, cy]) => `d${d} x${cx.toFixed(2)} y${cy.toFixed(2)}`).join('  '));
  const hx = halfDistance(lum, W, H, 'x');
  const hy = halfDistance(lum, W, H, 'y');
  console.log(`  half x=${hx} y=${hy}${hx && hy ? `  纵向比 ${(hy / hx).toFixed(2)}` : ''}`);
}
