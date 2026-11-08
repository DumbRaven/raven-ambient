/**
 * 把参考图里的竖排胶囊放大截出来，跟现在的实现对照。
 *
 * 为什么单独做：用户 m06439 问「如果像做成我视频里那种感觉有办法吗」——
 * 「视频里那种」指 AE 出的参考图。要判断差在哪，得先看清那块到底是什么质感，
 * 靠「大理石 / 磨砂 / 玻璃」这类形容词分辨不出来。
 *
 * 参考图 1917×1072，胶囊在 1920×1080 基准下的外接框是 [1704,92,140,311]
 * （tools/probe/marble.cjs 实测的 DOM rect）。这里按图片实际尺寸换算，
 * 不写死宽高——踩过「脚本写死分辨率静默输出假值」的坑。
 *
 * 用 ffmpeg 而不是 electron 的 nativeImage：这个脚本不需要起窗口，
 * 用 electron 跑会因为没调 app.whenReady 而挂住（踩过一次，等了 2 分钟）。
 *
 * 跑法：node tools/measure/tag-crop.cjs [放大倍数]
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { size } = require('./pixels.cjs');

const REF = 'C:/Users/DumbRaven/Pictures/Screenshots/屏幕截图 2026-10-17 192657.png';
const OUT = path.join(__dirname, 'tag-ref.png');

// 只用来定位，不参与任何断言
const TAG = { x: 1704, y: 92, w: 140, h: 311 };
const BASE = { w: 1920, h: 1080 };

const whole = size(REF);
const zoom = Math.max(1, Math.round(Number(process.argv[2] || 4)));

// 参考图实际尺寸和它被设计时的基准不一样，按比例换算
const sx = whole.W / BASE.w;
const sy = whole.H / BASE.h;
const x = Math.round(TAG.x * sx);
const y = Math.round(TAG.y * sy);
const w = Math.round(TAG.w * sx);
const h = Math.round(TAG.h * sy);

execFileSync('ffmpeg', [
  '-v', 'error', '-y',
  '-i', REF,
  '-vf', `crop=${w}:${h}:${x}:${y},scale=${w * zoom}:${h * zoom}:flags=neighbor`,
  '-frames:v', '1',
  OUT,
]);

console.log(JSON.stringify({
  source: { width: whole.W, height: whole.H },
  crop: { x, y, w, h, zoom },
  saved: OUT,
}));
