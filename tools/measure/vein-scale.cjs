/**
 * 量参考图里「丝」的真实尺度，按原图像素。
 *
 * 为什么要单独写：之前量的是「相关半衰距离」，那个数混了丝与丝之间的间距、
 * 也混了整块的明暗渐变，所以读出来只有一个平均值。要看丝本身，得先
 * 沿几个方向做一维剖线，数一数「亮度局部极值」之间的距离。
 *
 * 用法：node tools/measure/vein-scale.cjs
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const REF = path.join(ROOT, 'tools', 'measure', 'tag-raw.png');

/** 读成 { W, H, px(x,y) }，与 tools/measure/pixels.cjs 同一种访问器接口。 */
function loadRaw(file) {
  const probe = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  ).trim();
  const [W, H] = probe.split(',').map(Number);
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    maxBuffer: 1 << 28,
  });
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < W * H; i += 1, p += 3) {
    // Rec.601 亮度，与 texture-only.cjs 一致
    lum[i] = 0.299 * buf[p] + 0.587 * buf[p + 1] + 0.114 * buf[p + 2];
  }
  return { W, H, at: (x, y) => lum[y * W + x] };
}

/** 金色字母：sat = r - b 大。这里只需要「别采到字母」的粗掩膜。 */
function letterMask(file, W, H) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    maxBuffer: 1 << 28,
  });
  const mask = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i += 1, p += 3) {
    if (buf[p] - buf[p + 2] > 26 && buf[p] > 96) mask[i] = 1;
  }
  // 方框膨胀 3px：字母抗锯齿边缘也是金色渐变，会污染极值统计
  const out = new Uint8Array(W * H);
  const r = 3;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!mask[y * W + x]) continue;
      for (let dy = -r; dy <= r; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -r; dx <= r; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          out[yy * W + xx] = 1;
        }
      }
    }
  }
  return out;
}

const img = loadRaw(REF);
const mask = letterMask(REF, img.W, img.H);

/**
 * 沿一条剖线找局部极大/极小之间的距离。
 *
 * 先做 3px 滑动平均压掉像素噪声（参考图本身有压缩噪点），
 * 再找「比左右 4px 都高/都低」的点。峰值突出度小于 2 的不算——
 * 参考图的丝对比很轻，阈值定高了会把它们全滤掉。
 */
function profilePeaks(values) {
  const n = values.length;
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let cnt = 0;
    for (let d = -1; d <= 1; d += 1) {
      const j = i + d;
      if (j < 0 || j >= n) continue;
      sum += values[j];
      cnt += 1;
    }
    smooth[i] = sum / cnt;
  }
  const peaks = [];
  const MIN_PROMINENCE = 2;
  for (let i = 4; i < n - 4; i += 1) {
    const v = smooth[i];
    let isMax = true;
    let isMin = true;
    for (let d = -4; d <= 4; d += 1) {
      if (d === 0) continue;
      if (smooth[i + d] >= v) isMax = false;
      if (smooth[i + d] <= v) isMin = false;
    }
    if (!isMax && !isMin) continue;
    // 突出度：与左右 8px 内的最低/最高比
    let lo = Infinity;
    let hi = -Infinity;
    for (let d = -8; d <= 8; d += 1) {
      const j = i + d;
      if (j < 0 || j >= n) continue;
      lo = Math.min(lo, smooth[j]);
      hi = Math.max(hi, smooth[j]);
    }
    const prominence = isMax ? v - lo : hi - v;
    if (prominence < MIN_PROMINENCE) continue;
    peaks.push({ i, sign: isMax ? 1 : -1, prominence });
  }
  return peaks;
}

/** 一条剖线：从 (x0,y0) 方向 (dx,dy) 走 len 步，跳过字母像素。 */
function slice(x0, y0, dx, dy, len) {
  const vals = [];
  let clean = 0;
  for (let t = 0; t < len; t += 1) {
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    if (x < 0 || y < 0 || x >= img.W || y >= img.H) break;
    if (mask[y * img.W + x]) {
      // 字母处断开：把这一段标记为脏，最后只统计干净段
      vals.push(NaN);
      continue;
    }
    clean += 1;
    vals.push(img.at(x, y));
  }
  return { vals, clean };
}

/** 去掉 NaN 段后逐段找峰，返回相邻峰间距。 */
function spacingsOf(vals) {
  const gaps = [];
  let run = [];
  const flush = () => {
    if (run.length >= 40) {
      const peaks = profilePeaks(run);
      for (let i = 1; i < peaks.length; i += 1) {
        gaps.push(peaks[i].i - peaks[i - 1].i);
      }
    }
    run = [];
  };
  for (const v of vals) {
    if (Number.isNaN(v)) flush();
    else run.push(v);
  }
  flush();
  return gaps;
}

const report = { W: img.W, H: img.H, dirs: {} };

// 四个方向各取多条平行剖线：横向、纵向、两条斜向。
const dirs = {
  horizontal: { dx: 1, dy: 0, count: 24, len: img.W },
  vertical: { dx: 0, dy: 1, count: 20, len: img.H },
  diag45: { dx: 0.7071, dy: 0.7071, count: 16, len: Math.min(img.W, img.H) },
  diag135: { dx: -0.7071, dy: 0.7071, count: 16, len: Math.min(img.W, img.H) },
};

for (const [name, cfg] of Object.entries(dirs)) {
  const all = [];
  let cleanPx = 0;
  for (let c = 0; c < cfg.count; c += 1) {
    // 剖线在垂直方向铺开，留出 10% 边距避开圆角
    const frac = (c + 0.5) / cfg.count;
    let x0;
    let y0;
    if (name === 'horizontal') {
      x0 = 0;
      y0 = Math.round(img.H * (0.1 + 0.8 * frac));
    } else if (name === 'vertical') {
      x0 = Math.round(img.W * (0.1 + 0.8 * frac));
      y0 = 0;
    } else if (name === 'diag45') {
      x0 = Math.round(img.W * 0.1 * (1 - frac));
      y0 = Math.round(img.H * 0.1 + cfg.len * 0.7 * frac);
    } else {
      x0 = Math.round(img.W * (0.9 - 0.8 * frac));
      y0 = Math.round(img.H * 0.1 + cfg.len * 0.7 * frac);
    }
    const { vals, clean } = slice(x0, y0, cfg.dx, cfg.dy, cfg.len);
    cleanPx += clean;
    all.push(...spacingsOf(vals));
  }
  all.sort((a, b) => a - b);
  const pick = q => (all.length ? all[Math.min(all.length - 1, Math.round(q * (all.length - 1)))] : null);
  report.dirs[name] = {
    n: all.length,
    cleanPx,
    p25: pick(0.25),
    p50: pick(0.5),
    p75: pick(0.75),
    // 只统计合理的间距（1~60px）：再大就是整块的明暗渐变，不是丝
    under60: all.filter(g => g <= 60).length,
  };
}

console.log(JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(ROOT, 'tools', 'measure', 'vein-scale.json'), JSON.stringify(report, null, 2));
