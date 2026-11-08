/**
 * 石纹统计：**同一个口径**量参考图和我们的截图。
 *
 * 为什么重写：上一版用「剔除金色像素」来去掉字母，但字母的抗锯齿边缘
 * 会残留一大圈中间色，混进样本后 sd 主要由**字母边缘**贡献，纹理本身的
 * 起伏被淹没。证据：mist-a/b/c 三档肉眼几乎纯灰片，sd 却和浪脊版持平（24 上下）。
 *
 * 这一版做两件事：
 *   1. **藏掉字母再截图**（探针侧负责），样本里本来就没有字母；
 *   2. 统计用**粗化块均值 sd**：把图按边长 f×宽度 的方块取均值，再算这些
 *      均值的 sd。边缘是局部的，块一大就被平均掉；而参考图的起伏「跨越大尺度」
 *      （粗化到 16px 块 sd 仍有 8.9），所以它留得住。
 * f 用相对宽度的比例，两边（参考 700px 放大片 / 我们 152px 截图）物理尺度就一致。
 */
const { load, lum } = require('./pixels.cjs');

const FRACTIONS = [0.02, 0.04, 0.08, 0.16];

/** 粗化到块均值后的一维数组（行优先）。块不满就丢弃尾部。 */
function blocks(img, size) {
  const out = [];
  const nx = Math.floor(img.W / size);
  const ny = Math.floor(img.H / size);
  for (let by = 0; by < ny; by++) {
    for (let bx = 0; bx < nx; bx++) {
      let sum = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const [r, g, b] = img.px(bx * size + x, by * size + y);
          sum += lum(r, g, b);
        }
      }
      out.push(sum / (size * size));
    }
  }
  return out;
}

function describe(values) {
  const n = values.length;
  if (!n) return { n: 0, mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, mean: +mean.toFixed(1), sd: +sd.toFixed(2) };
}

/**
 * 量一张图。
 *
 * @param {string} file
 * @param {{inset?:number}} [opts] inset 是相对边距（像素），避开圆角与边缘抗锯齿
 */
function texture(file, opts = {}) {
  const whole = load(file);
  const inset = opts.inset ?? Math.round(whole.W * 0.08);
  const img = load(file, {
    x: inset, y: inset,
    w: whole.W - inset * 2, h: whole.H - inset * 2,
  });

  const rows = FRACTIONS.map(f => {
    const size = Math.max(1, Math.round(whole.W * f));
    const b = blocks(img, size);
    return { /** 块边长占胶囊宽的比例 */ f, size, ...describe(b) };
  });

  return { file, width: whole.W, inset, rows };
}

/** 参考图靶子（`tools/measure/tag-ref.png`，700px 宽放大片）。 */
function reference() {
  return texture(require('node:path').join(__dirname, 'tag-ref.png'));
}

/** 一行里最该看的那个尺度：参考图在此处 sd 约 8.9（16px / 700px ≈ 0.023）。 */
const CANONICAL_F = 0.02;

function canonical(row) {
  const hit = row.rows.find(r => r.f === CANONICAL_F);
  return hit ?? row.rows[0];
}

module.exports = { FRACTIONS, CANONICAL_F, texture, reference, canonical, blocks, describe };
