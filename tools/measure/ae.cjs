#!/usr/bin/env node
/**
 * 读 AE 导出的 `raven-shapes.json`，沿预合成链把局部坐标换算成主合成绝对坐标。
 *
 * 跑法：
 *   node tools/measure/ae.cjs                    # 摘要（每层一行）
 *   node tools/measure/ae.cjs --grep Picked      # 只看名字匹配的层
 *   node tools/measure/ae.cjs --json             # 完整 JSON
 *   node tools/measure/ae.cjs --shapes           # 只列带顶点数据的图层
 *
 * ⚠️ **位置数据不可信，只取字号 / 字距 / 文案 / 颜色 / 字体名**。
 *
 * 原因：导出的 JSON 缺父级（父对象 / Null）变换。被摆位过的预合成内层，
 * 算出来的绝对值会差很远。实测三例：
 *     竖排徽标：算出 x=51.6%，参考图实测 67.79%
 *     乌鸦图：  算出 x=49.6%，参考图实测 55.87%
 *     Produced By：算出 x=116.1%，参考图实测 88.78%
 * 位置一律以参考图像素为准（`tools/measure/` 里的其它脚本）。
 *
 * 还有一处对不上：竖排徽标这里登记的是 Montserrat-Bold（无衬线），
 * 但参考图放大后是斜体衬线。**那份导出和出图不是同一版**。同样以像素为准。
 */
const fs = require('node:fs');
const { AE_JSON } = require('./pixels.cjs');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const onlyShapes = argv.includes('--shapes');
const grepAt = argv.indexOf('--grep');
const grep = grepAt >= 0 ? argv[grepAt + 1] : null;

let doc;
try {
  doc = JSON.parse(fs.readFileSync(AE_JSON, 'utf8'));
} catch (e) {
  console.error(`读不到 AE JSON：${AE_JSON}`);
  console.error(`  ${e.message}`);
  console.error('这个文件在 AE 工程目录里，不在仓库中。没有它就跳过这一步，');
  console.error('用参考图像素测量（tools/measure 的其它脚本）也能做版式还原。');
  process.exit(1);
}

/**
 * 沿 anchor/scale/pos 把局部坐标换算到父坐标系。
 * 公式与 AE 一致：父坐标 = (子坐标 - anchor) * scale + pos
 *
 * 注意：这份导出里预合成会**互相引用**（A 引 B、B 又引 A），
 * 不加 visited 会直接爆栈。实测原始 JSON 就这样，不是数据坏了。
 */
function toParent(layer) {
  const pos = Array.isArray(layer.pos) ? layer.pos : [0, 0];
  return { x: pos[0] || 0, y: pos[1] || 0 };
}

function walk(comp, parent, depth, out, ancestors) {
  if (!comp || depth > 12) return;
  // 只拦「祖先链上已经出现过」的合成——那才是真环。
  // 不能用全局 visited：同一个预合成常被多个图层各引用一次，全局去重会漏掉后几次。
  if (ancestors.has(comp.comp)) return;
  const chain = new Set(ancestors).add(comp.comp);

  for (const layer of comp.layers || []) {
    const local = toParent(layer);
    const abs = {
      x: parent.x + local.x,
      y: parent.y + local.y,
    };
    out.push({ comp: comp.comp, depth, layer, abs });

    // 找它引用的子合成，继续往下走。
    const child = doc.comps.find(c => c.comp === layer.source);
    if (child) walk(child, abs, depth + 1, out, chain);
  }
}

// JSON 里有两个同名的「主合成」：第 0 个是片头（15 层全是 TextAnimation），
// 第 1 个才是正片（13 层，含「唱片 合成 1」「右上 合成 1」「左下 合成 1」）。
// 不能按名字取，按「引用的子合成名里出现了这几个正片模块」来挑。
const ROOT_MARKERS = ['唱片 合成 1', '右上 合成 1', '左下 合成 1'];
const root = doc.comps
  .filter(c => (c.layers || []).some(l => ROOT_MARKERS.includes(l.source)))
  .sort((a, b) => (b.layers || []).length - (a.layers || []).length)[0];

if (!root) {
  console.error('找不到正片主合成（引用了「唱片 合成 1 / 右上 合成 1 / 左下 合成 1」的那个）');
  process.exit(1);
}

const flat = [];
// 每个预合成只展开一次。这份导出里预合成互相引用，不去重会无限递归。
walk(root, { x: 0, y: 0 }, 0, flat, new Set());

console.log(`AE ${AE_JSON}`);
console.log(`ROOT ${root.comp} (${root.width}×${root.height})  合成 ${doc.comps.length} 个  可达图层 ${flat.length} 个`);
console.log('');

const rows = flat.filter(({ layer }) => {
  if (onlyShapes && !(layer.shapes && layer.shapes.length)) return false;
  if (grep && !`${layer.name} ${layer.text || ''}`.toLowerCase().includes(grep.toLowerCase())) return false;
  return true;
});

if (asJson) {
  console.log(JSON.stringify(rows.map(({ comp, depth, layer, abs }) => ({
    comp, depth,
    name: layer.name,
    kind: layer.kind,
    abs: [+abs.x.toFixed(2), +abs.y.toFixed(2)],
    pct: [+(abs.x / root.width * 100).toFixed(2), +(abs.y / root.height * 100).toFixed(2)],
    scale: layer.scale,
    fontSize: layer.fontSize,
    tracking: layer.tracking,
    font: layer.font,
    text: layer.text,
    fill: layer.fill,
    shapes: layer.shapes,
  })), null, 1));
  process.exit(0);
}

for (const { comp, depth, layer, abs } of rows) {
  const pct = `(${(abs.x / root.width * 100).toFixed(1)},${(abs.y / root.height * 100).toFixed(1)})`;
  const bits = [
    `${'  '.repeat(depth)}${comp}`,
    layer.name,
    layer.kind,
    `abs=${abs.x.toFixed(1)},${abs.y.toFixed(1)}`,
    `pct=${pct}`,
  ];
  if (layer.fontSize) bits.push(`fs=${layer.fontSize}`);
  if (layer.tracking) bits.push(`track=${layer.tracking}`);
  if (layer.font) bits.push(`font=${layer.font}`);
  if (layer.scale && (layer.scale[0] !== 100 || layer.scale[1] !== 100)) {
    bits.push(`scale=${layer.scale[0]}x${layer.scale[1]}`);
  }
  if (layer.shapes && layer.shapes.length) bits.push(`shapes=${layer.shapes.length}`);
  if (layer.text) bits.push(`text=${JSON.stringify(layer.text)}`);
  console.log(bits.join(' | '));
}

console.log('');
console.log('⚠️ 位置（abs / pct）**不可信**，见文件头说明。只取 fs / track / font / text。');
