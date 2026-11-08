/**
 * 玉石候选的统计对比：把探针截出来的图逐张量一遍，
 * 与参考图原分辨率裁片 `tag-raw.png` 并排。
 *
 * 只看三个数（`jade-stats.cjs` 里解释了为什么是这三个）：
 * - `range95` 总跨度，参考 41
 * - `kurtosis` 分布形状，参考 3.7（太低=平，太高=糊成一块）
 * - `gradP95` 边界陡度，参考 12.45
 *
 * 距离用三项相对误差的均方根，权重按「差多少算明显」定：
 * range95 差 5 分算明显、kurtosis 差 1.5、gradP95 差 2.5。
 *
 * 跑法：node tools/measure/jade-rank.cjs tools/probe/jade-*.png
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REF = path.join(__dirname, 'tag-raw.png');
const TARGET = { range95: 41, kurtosis: 3.7, gradP95: 12.45 };
const SCALE = { range95: 5, kurtosis: 1.5, gradP95: 2.5 };

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/measure/jade-rank.cjs <png> [png...]');
  process.exit(2);
}

const out = execFileSync('node', [
  path.join(__dirname, 'jade-stats.cjs'), REF, ...files,
], { encoding: 'utf8', maxBuffer: 1 << 26 });

const line = out.split('\n').find(l => l.trim().startsWith('{"rows"'));
if (!line) {
  console.error('jade-stats produced no rows');
  process.exit(1);
}

const { rows } = JSON.parse(line);
const ranked = rows
  .filter(r => path.basename(r.file) !== path.basename(REF))
  .map(r => {
    const d = (key) => ((r[key] - TARGET[key]) / SCALE[key]) ** 2;
    const distance = Math.sqrt((d('range95') + d('kurtosis') + d('gradP95')) / 3);
    return {
      file: r.file,
      range95: r.range95,
      kurtosis: r.kurtosis,
      gradP95: r.gradP95,
      skew: r.skew,
      distance: +distance.toFixed(3),
    };
  })
  .sort((a, b) => a.distance - b.distance);

console.log(JSON.stringify({ target: TARGET, ref: rows[0], ranked }, null, 0));
