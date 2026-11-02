/**
 * 参考图像素测量的公共底座。
 *
 * 为什么要有这个文件：`.tools/` 里那二十来个 ref-*.cjs 每个都重复同一段
 * 「ffprobe 取尺寸 → ffmpeg 转 rawvideo → 包一层 px()」。抽出来后，
 * 每个测量脚本只剩「量什么」。
 *
 * 两个反复踩过的坑，写进这套 API 里规避：
 *
 * 1. **坐标陷阱**。裁切之后拿到的是「裁切图内」坐标。想打印画布百分比，
 *    必须自己加裁切偏移再除画布尺寸。早先 `prod-cmp.cjs` 就把它当成了画布
 *    绝对坐标，结果「字号没变」的假象骗了一整轮。所以这里 `load()` 返回的
 *    对象**带 crop 信息**，`toCanvas()` 是唯一换算出口，别自己算。
 *
 * 2. **取色别靠直方图猜同类色**。面板 `#4a5363`、信息条 `#72777d` 像素数都很大，
 *    直方图第一名可能是信息条。`flood()` 要求显式给种子点。
 *
 * 所有函数都只读文件，不写任何东西（除了 ffmpeg 的中转临时文件，用完即删）。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** 参考图（AE 渲染成品）。版式还原的唯一权威源。 */
const REF = 'C:/Users/DumbRaven/Pictures/Screenshots/屏幕截图 2026-10-17 192657.png';

/** AE 导出数据。**位置不可信**（缺父级变换），只取字号/字距/文案。 */
const AE_JSON = 'C:/Users/DumbRaven/Videos/模板/raven-shapes.json';

function size(file) {
  const [W, H] = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]).toString().trim().split(',').map(Number);
  return { W, H };
}

/**
 * 读一张图，可选裁切。
 *
 * @param {string} file
 * @param {{x?:number,y?:number,w?:number,h?:number}} [crop] 裁切框（原图像素）
 * @returns {{W,H,px:(x,y)=>number[], crop, toCanvas:(x,y)=>[number,number]}}
 *   坐标一律是**裁切图内**相对坐标；要画布百分比用 `pct()`。
 */
function load(file, crop) {
  const whole = size(file);
  const c = crop
    ? { x: crop.x, y: crop.y, w: crop.w, h: crop.h }
    : { x: 0, y: 0, w: whole.W, h: whole.H };

  const args = ['-v', 'error', '-i', file];
  if (crop) args.push('-vf', `crop=${c.w}:${c.h}:${c.x}:${c.y}`);
  args.push('-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');

  const raw = execFileSync('ffmpeg', args, { maxBuffer: 1 << 28 });
  const stride = c.w * 3;

  return {
    W: c.w,
    H: c.h,
    fileW: whole.W,
    fileH: whole.H,
    crop: c,
    px(x, y) {
      const o = y * stride + x * 3;
      return [raw[o], raw[o + 1], raw[o + 2]];
    },
    /** 裁切图内坐标 → 原图画布百分比 [x%, y%]。 */
    pct(x, y) {
      return [
        +(((x + c.x) / whole.W) * 100).toFixed(2),
        +(((y + c.y) / whole.H) * 100).toFixed(2),
      ];
    },
  };
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 某个矩形区域的中位色（比平均值抗噪，比单点稳）。 */
function medianColor(img, x0, y0, x1, y1) {
  const hist = [[], [], []];
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const [r, g, b] = img.px(x, y);
      hist[0].push(r); hist[1].push(g); hist[2].push(b);
      n++;
    }
  }
  if (!n) return null;
  const mid = a => a.sort((p, q) => p - q)[a.length >> 1];
  return [mid(hist[0]), mid(hist[1]), mid(hist[2])];
}

/**
 * 从种子点四邻域洪水填充，返回连通块的 bbox + 掩码。
 *
 * 面板色必须从**面板内部**取种子（比如 `[W*0.75, H*0.20]`）。用直方图猜会
 * 抓到信息条，然后整块填充跑到画布外面去。
 *
 * **掩码是必需的，不是附赠**。想找面板的下边界（那条包住唱片的弧），
 * 靠「按颜色逐列扫最低点」会被唱片照片里颜色恰好接近的像素骗到——
 * 采样会掉进唱片里，拟出来的圆半径能差 30%。用 `mask` 只认连通块内部，
 * 边界就干净了。
 *
 * @param {number} tol 每通道容差
 * @returns {{n,x0,y0,x1,y1,w,h,seed:number[],mask:Uint8Array}|null}
 *   `mask[y*W+x]` 为 1 表示该像素属于这块连通域。
 */
function flood(img, seedX, seedY, tol = 18) {
  const { W, H } = img;
  const [sr, sg, sb] = img.px(seedX, seedY);
  const match = (x, y) => {
    const [r, g, b] = img.px(x, y);
    return Math.abs(r - sr) <= tol && Math.abs(g - sg) <= tol && Math.abs(b - sb) <= tol;
  };
  if (!match(seedX, seedY)) return null;

  const mask = new Uint8Array(W * H);
  const stack = [seedY * W + seedX];
  mask[stack[0]] = 1;
  let n = 0, x0 = seedX, x1 = seedX, y0 = seedY, y1 = seedY;

  while (stack.length) {
    const c = stack.pop();
    const cx = c % W, cy = (c - cx) / W;
    n++;
    if (cx < x0) x0 = cx;
    if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy;
    if (cy > y1) y1 = cy;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (mask[ni]) continue;
      mask[ni] = 1;
      if (match(nx, ny)) stack.push(ni);
    }
  }
  return { n, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, seed: [sr, sg, sb], mask };
}

/**
 * 把连续非空行合并成「文字带」。测文字位置的标准手段。
 *
 * @param {(y:number)=>({n:number, lo:number, hi:number})} scanRow 由调用方给判据
 * @param {number} minPx 一行至少多少个命中像素才算有字
 * @param {number} maxGap 允许中间空几行不断带
 */
function bands(scanRow, y0, y1, minPx = 2, maxGap = 2) {
  const out = [];
  let cur = null, gap = 0;
  for (let y = y0; y < y1; y++) {
    const r = scanRow(y);
    if (r.n >= minPx) {
      if (!cur) cur = { y0: y, y1: y, lo: r.lo, hi: r.hi };
      else {
        cur.y1 = y;
        cur.lo = Math.min(cur.lo, r.lo);
        cur.hi = Math.max(cur.hi, r.hi);
      }
      gap = 0;
    } else if (cur && ++gap > maxGap) {
      out.push(cur);
      cur = null;
      gap = 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 金色判据。项目里的金是 `#c48f46` / `#d4a040` 一路，这个阈值两边都覆盖。 */
const isGold = (r, g, b) => r > 150 && g > 110 && b < 150 && r - b > 55 && g - b > 25;

/**
 * 金色连通块（4 邻域 BFS）。四颗 ✦ 和单个字母都能分开，所以这个函数
 * 在量徽标时特别好用——比按阈值扫列可靠。
 *
 * @param {number} minPx 小于这个像素数的块当噪点丢掉
 */
function goldBlocks(img, minPx = 60) {
  const { W, H } = img;
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (seen[idx]) continue;
      const [r, g, b] = img.px(x, y);
      if (!isGold(r, g, b)) { seen[idx] = 1; continue; }
      const stack = [idx];
      seen[idx] = 1;
      let n = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      while (stack.length) {
        const c = stack.pop();
        const cx = c % W, cy = (c - cx) / W;
        n++;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (seen[ni]) continue;
          seen[ni] = 1;
          const [rr, gg, bb] = img.px(nx, ny);
          if (isGold(rr, gg, bb)) stack.push(ni);
        }
      }
      if (n >= minPx) out.push({ n, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
  }
  return out.sort((a, b) => b.n - a.n);
}

/**
 * 最小二乘圆拟合（Kasa 法：x²+y² + Dx + Ey + F = 0）。
 * 用途：判定面板那条弧到底是不是正圆、圆心与半径多少。
 *
 * 配合 `arcShape()` 使用——它顺手再拟一个轴对齐椭圆作对照，
 * 两者差 0.1px 就说明是正圆。
 */
function fitCircle(pts) {
  const n = pts.length;
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y;
    Sxz += x * z; Syz += y * z; Sz += z;
  }
  // 解 3×3 正规方程。
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
  const B = [-Sxz, -Syz, -Sz];
  const det3 = m =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D0 = det3(A);
  if (Math.abs(D0) < 1e-9) return null;
  const rep = (col, v) => A.map((row, i) => row.map((c, j) => (j === col ? v[i] : c)));
  const D = det3(rep(0, B)) / D0;
  const E = det3(rep(1, B)) / D0;
  const F = det3(rep(2, B)) / D0;
  const cx = -D / 2, cy = -E / 2;
  const r = Math.sqrt(cx * cx + cy * cy - F);
  const res = pts.map(([x, y]) => Math.hypot(x - cx, y - cy) - r);
  const rms = Math.sqrt(res.reduce((s, v) => s + v * v, 0) / n);
  return { cx, cy, r, rms, min: Math.min(...res), max: Math.max(...res) };
}

module.exports = {
  REF, AE_JSON,
  size, load, lum, medianColor, flood, bands, isGold, goldBlocks, fitCircle,
};
