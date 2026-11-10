/**
 * 造一批纯色图当媒体库素材。
 *
 * 为什么要有：`harness.cjs` 的 CABINET 只放一件媒体，「一页八张」的分页
 * 永远出现不了——不补素材，票根网格的探针量到的东西全是常量。
 * 颜色按色相绕一圈，票面上一眼能分出是不同的一件；名字按字母序，
 * 翻页前后对得上 id 与标题。
 *
 * **只写 `color=` 一处**。早先同时给了 `color=0x…` 和 `-vf hue=h=…`，
 * 色相被转了两遍，量到的颜色和算的对不上，查了半天才发现是探针自己干的。
 */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { MEDIA_DIR } = require('./harness.cjs');

const NAMES = [
  'DROWNED DUSK', 'SECOND SHADE', 'THIRD LIGHT', 'HOLLOW REED',
  'QUIET FJORD', 'PALE EMBER', 'SLOW TIDE', 'NORTH WINDOW',
  'LOW HORIZON', 'STILL WATER', 'GLASS FERN', 'AMBER ROOM',
  'SILENT PIER', 'WINTER FIELD', 'BLUE HOLLOW', 'DUST LANE',
  'OPEN SEA', 'LAST LIGHT',
];

/** 色相 → #rrggbb。饱和度与亮度写死成「偏暗但彼此分得开」的一档。 */
function hsl(hue) {
  const h = hue / 60;
  const c = 0.42;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const table = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][Math.floor(h) % 6];
  return table.map(v => Math.round((v + 0.29) * 255).toString(16).padStart(2, '0')).join('');
}

function seedImages(count) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  return NAMES.slice(0, count).map((name, index) => {
    const file = path.join(MEDIA_DIR, `${name}.png`);
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=0x${hsl((index * 360) / count)}:s=960x540:d=1`,
      '-frames:v', '1', file,
    ]);
    return { id: `image:${index + 1}`, kind: 'image', path: file, name, size: 1024 * (index + 1) };
  });
}

module.exports = { seedImages, hsl, NAMES };
