/**
 * 把参考图里的竖排胶囊按**原分辨率**裁出来（不放大）。
 *
 * 为什么需要：放大版 `tag-ref.png` 是用 `neighbor` 插值放大的，
 * 每 5×5 像素块颜色完全一样，算出来的梯度中位数是 0，
 * 「边界有多陡」这类统计全被这个假象吃掉（实测 edge995 报出 10920400）。
 * 要量梯度和分布形状，必须用原分辨率。
 *
 * 参考图 1917×1072，胶囊在 1920×1080 基准下的外接框是 [1704,92,140,311]。
 * 按图片实际尺寸换算，不写死宽高。内缩 3px 避开圆角抗锯齿。
 *
 * 跑法：node tools/measure/tag-raw.cjs
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { size } = require('./pixels.cjs');

const REF = 'C:/Users/DumbRaven/Pictures/Screenshots/屏幕截图 2026-10-17 192657.png';
const OUT = path.join(__dirname, 'tag-raw.png');

const TAG = { x: 1704, y: 92, w: 140, h: 311 };
const BASE = { w: 1920, h: 1080 };
const INSET = 3;

const whole = size(REF);
const sx = whole.W / BASE.w;
const sy = whole.H / BASE.h;
const cx = Math.round(TAG.x * sx);
const cy = Math.round(TAG.y * sy);
const cw = Math.round(TAG.w * sx);
const ch = Math.round(TAG.h * sy);

const x = cx + INSET;
const y = cy + INSET;
const w = cw - INSET * 2;
const h = ch - INSET * 2;

execFileSync('ffmpeg', [
  '-v', 'error', '-y',
  '-i', REF,
  '-vf', `crop=${w}:${h}:${x}:${y}`,
  '-frames:v', '1',
  OUT,
]);

console.log(JSON.stringify({
  source: { width: whole.W, height: whole.H },
  crop: { x, y, w, h },
  saved: OUT,
}));
