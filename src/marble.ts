/**
 * 竖排胶囊的石纹滤镜。
 *
 * 从 `TemplateStage.tsx` 抽出来单独放，是因为这个串**写错了不会有任何报错**：
 * 引用的 id 对不上时 computed 只是变回 `none`（静默失效），
 * 滤波器顺序写反时也只是「看着不像石头」。抽成纯字符串函数之后，
 * 测试可以直接对管线本身做断言，不用起 Electron 截图比对。
 *
 * ## 两种石头
 *
 * `sea`（浪脊，默认）：真大理石是一层**被揉弯的条带**。石头在地壳里被挤，
 * 沉积层的平行条纹被压成弯弯曲曲的脉络。所以正确做法不是「生成噪声」，
 * 而是「先画直的条纹，再用低频噪声把它揉弯」——这正是 feDisplacementMap 干的事。
 * 直接照搬 feTurbulence 出来的是一片**均匀噪点**，像电视雪花。
 *
 * `jade`（玉石）：参考视频里那块胶囊。它的判据被用户反复纠正过四次：
 *
 *   m07154「不是云雾，而是类似于玉石那样的质感，明暗比较分明」
 *   m07574「有那种玉石里面有那种色彩纹路渐隐渐现的沁在里面一样……
 *           现在单纯是色块了，没有链接感」
 *   m08231「有点太雾了，没有玉石明显的纹路感啊，你自己没发现吗」
 *   m09592「把重点的颜色分散的均匀一些，而且做成细长的样子而不是点，
 *           就好像树根，有各种枝杈」
 *
 * 四句连起来才是完整需求：**要有纹路、纹路连贯细长、粗细有主次、
 * 分布均匀，但边缘不能硬**。
 *
 * **总根因**：我长期把「边缘不生硬」读成了「没有边界」，
 * 于是越调越糊，中间做过十几轮雾。
 */

export const MARBLE_FILTER_ID = 'tpl-marble';

/** 胶囊表面的两种石纹。`sea` 是默认的浪脊，`jade` 是参考视频里那种玉。 */
export type StoneStyle = 'sea' | 'jade';

/**
 * 面板里可选的石纹。
 *
 * `hint` 是**选项副标题**，跟着选项自己出现——按「界面不加解释」的约定，
 * 说明要贴在选项上，不能在整组下面挂一行通用文字。
 */
export const stoneStyles: ReadonlyArray<{ id: StoneStyle; name: string; hint: string }> = [
  { id: 'sea', name: '浪脊', hint: '横向起伏的石纹' },
  { id: 'jade', name: '玉石', hint: '细丝连成枝杈' },
];

export function isStoneStyle(value: unknown): value is StoneStyle {
  return value === 'sea' || value === 'jade';
}

/** 找不到就把任意值收敛成默认那一种。 */
export function findStoneStyle(value: unknown): StoneStyle {
  return isStoneStyle(value) ? value : 'sea';
}

/** 挂滤镜用的 <svg> 标记。插到 <body> 上，不要放进被裁的容器里。 */
export function marbleFilterMarkup(style: StoneStyle = 'sea', id = MARBLE_FILTER_ID): string {
  return bandMarkup(id, style === 'jade' ? JADE_SPEC : SEA_SPEC);
}

/**
 * 换下一个石纹。
 *
 * 为什么要有这个函数：切换入口在胶囊自己身上（点一下换一种），
 * 组件里不该知道「有两种、顺序是什么」——那是风格表的事。
 */
export function nextStoneStyle(value: unknown): StoneStyle {
  const current = findStoneStyle(value);
  const at = stoneStyles.findIndex(style => style.id === current);
  return stoneStyles[(at + 1) % stoneStyles.length].id;
}

/**
 * 中值等值带管线：两个风格共用。
 *
 * 取噪声值等于 0.5 的那一层——
 *
 *   `val = hi − (hi − lo)·exp(−((x − 0.5)/width)²)`
 *
 * 噪声的等值面天然连成蜿蜒曲线，细长、会分叉、铺满整个平面。
 * 多层的差别只在频率、带宽、权重，所以两个风格共用一套代码，
 * 换风格只是换参数表。早期浪脊走的是另一条路（白条纹 + 位移），
 * 那条路出的是「条纹」而不是「纹路」，而且白色叠在白底上对比度被吃掉，
 * 用户 m09905 说「波浪这个不太明显」，就是这条路的问题。
 */
type BandLayer = {
  /** 噪声频率。两个数（x y）时 y 高于 x，等值线就横着走。 */
  freq: string;
  seed: number;
  /** 带子半宽（0~1）：越大线越粗。 */
  width: number;
  /** 线心亮度（最暗处）。 */
  lo: number;
  /** 带的边界亮度。 */
  hi: number;
  /** 只磨等值面的硬边。越粗的线给越大的值，边缘才晕得开。 */
  blur: number;
  /** 加权平均的权重，三条加起来必须为 1。 */
  weight: number;
};

type BandSpec = {
  layers: BandLayer[];
  /** 三条共用的位移场。频率太低只会整体平移，太高会散成斑。 */
  warp: { freq: string; seed: number; scale: number };
  /** 亮度系数幅度：把中性灰乘到多大范围。对到参考图 sd 的那一档。 */
  amount: number;
  /** 纹理的亮度中心，`mix = center` 处正好乘 1。必须实测，不能假设 0.5。 */
  center: number;
};

/** 一条丝的映射表：在 x = 0.5 处取到 `lo`（最暗），离得越远越亮。 */
function bandTable(lo: number, hi: number, width: number, samples = 160): string {
  const values: string[] = [];
  for (let index = 0; index < samples; index += 1) {
    const unit = index / (samples - 1);
    const offset = (unit - 0.5) / width;
    values.push((hi - (hi - lo) * Math.exp(-offset * offset)).toFixed(4));
  }
  return values.join(' ');
}

/**
 * 这套管线的结论都在这，改参数之前先读。
 *
 * ## 三条静默出错（都不报错，只是「看着不对」）
 *
 *   1. `<feComposite operator="over">` 会把整张灰度图盖上去，
 *      得到一层不透明灰，CSS 底色完全看不见。要乘用 `arithmetic k1="1"`。
 *   2. `operator="in"` 用 SourceGraphic 的 alpha 当遮罩。`::before` 的
 *      `background` 一旦是透明，整张纹理被乘成 0——现象是「换个底色，
 *      纹理忽然不见」。圆角裁剪由 CSS 的 `clip-path` 负责，这里不需要它。
 *   3. 多个 `<feFuncX>` 让 `feComponentTransfer` 静默失效：
 *      `innerHTML` 把兄弟节点吞成子节点。偏色只能靠 `feColorMatrix`。
 *
 * ## 颜色不属于这个滤镜（用户 m09087）
 *
 * 「这个胶囊不是分型杂色吗，也就是说它本身是没有色彩的，
 *   他是根据面板的颜色来变色的」。
 *
 * 参考图那块偏蓝（`blueMinusRed +24.3`），我一度把蓝写死进末尾三个 offset。
 * 数值对上了，但那是把「面板的蓝透过半透明胶囊」拍成死照片——
 * 用户把面板换成暖色，胶囊纹丝不动（`stone-follow.cjs` 实测 `dR=dG=dB=0`）。
 *
 * 落地方式：**末尾与 `SourceGraphic` 相乘**。滤镜只输出中性灰当亮度系数，
 * 颜色始终等于 CSS 给的那层底色，而底色是
 * `hsl(from var(--tpl-panel) h s calc(l * 1.6))`（只抬明度，色相饱和度原样）。
 *
 * ## 均值与幅度是两个旋钮
 *
 * `center` 管均值、`amount` 管对比度，**两个都要实测，不能假设**：
 *
 *   - 纹理均值不是中灰 0.5：折叠版 0.73，等值带版 0.63，压过 `lo` 之后 0.54。
 *     按 0.5 算映射，均值越过 1 被钳住，于是「调 amount 只改被钳面积、
 *     对比度纹丝不动」——这个现象卡了很久。
 *   - 换一组参数就要重新标定一次 `center`。
 *     `tools/probe/stone-root.cjs` 的 `calibrate()` 是自动标定的写法：
 *     **一次渲染反解**。别用两端拟合，输出在 0/1 处被钳，
 *     两端去拟合会解出负的底色亮度。
 *
 * ## 口径（改之前先跑一遍，改完再跑一遍）
 *
 *   `tag-stats.cjs`    mean / sd / p05 / p95（亮度与对比度）
 *   `vein-shape.cjs`  elongation / coverage / meanWidth（「细长」与「均匀」）
 *   `blobs.cjs`       连通块（区分「连成片」与「碎成点」）
 *
 * 参考图 `tools/measure/tag-raw.png`：
 *   mean 130.1 / sd 12.22 / elong p90 2.46 / coverage 0.56 / width 5.4
 * 本版：
 *   mean 123.9 / sd 11.25 / elong p90 3.34 / coverage 0.75 / width 3.5
 *
 * 色偏实机会更大（`blueMinusRed` +64 vs 参考 +25），因为探针壁纸取到的
 * 面板本身更饱和。要调该去调面板取色，不要往胶囊里加白。
 */
function bandMarkup(id: string, spec: BandSpec): string {
  const layer = (name: string, cfg: BandLayer): string => {
    const table = bandTable(cfg.lo, cfg.hi, cfg.width);
    return (
      `<feTurbulence type="fractalNoise" baseFrequency="${cfg.freq}" numOctaves="2" seed="${cfg.seed}" result="${name}n"/>` +
      `<feColorMatrix in="${name}n" type="saturate" values="0" result="${name}g"/>` +
      `<feComponentTransfer in="${name}g" result="${name}t">` +
      `<feFuncR type="table" tableValues="${table}"/>` +
      `<feFuncG type="table" tableValues="${table}"/>` +
      `<feFuncB type="table" tableValues="${table}"/>` +
      // alpha 钉死：feTurbulence 的 alpha 也是噪声，不钉整块会半透明。
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer>`
    );
  };

  const { layers } = spec;
  const lit = (1 - spec.amount * spec.center).toFixed(3);

  // 加权平均：每合一层，左边累计权重乘以自身、右边乘以新层的权重。
  // 权重和从 0.46 一路涨到 1，所以最后一级的两数之和恰好是 1 ——
  // 整体亮度不跟着权重跑。用乘积会把均值一起砍半，整块发闷。
  let chain = '';
  let accName = 'v0f';
  let accWeight = layers[0].weight;
  for (let index = 1; index < layers.length; index += 1) {
    const last = index === layers.length - 1;
    const out = last ? 'mix' : `s${index}`;
    chain +=
      `<feComposite in="${accName}" in2="v${index}f" operator="arithmetic" k1="0" ` +
      `k2="${accWeight.toFixed(2)}" k3="${layers[index].weight.toFixed(2)}" k4="0" result="${out}"/>`;
    accName = out;
    accWeight += layers[index].weight;
  }

  return (
    // 位移与模糊都会让像素跑出元素边界，region 放宽一圈，否则四周被裁。
    `<svg width="300" height="300"><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    layers.map((cfg, index) => layer(`v${index}`, cfg)).join('') +
    `<feTurbulence type="fractalNoise" baseFrequency="${spec.warp.freq}" numOctaves="2" seed="${spec.warp.seed}" result="wn"/>` +
    '<feColorMatrix in="wn" type="saturate" values="0" result="wg"/>' +
    layers
      .map(
        (_, index) =>
          `<feDisplacementMap in="v${index}t" in2="wg" scale="${spec.warp.scale}" ` +
          `xChannelSelector="R" yChannelSelector="G" result="v${index}b"/>`,
      )
      .join('') +
    layers
      .map(
        (cfg, index) =>
          `<feGaussianBlur in="v${index}b" stdDeviation="${cfg.blur}" result="v${index}f"/>`,
      )
      .join('') +
    chain +
    // 把中性灰映射成**亮度系数**：`m = amount·(mix − center) + 1`。
    '<feComponentTransfer in="mix" result="lit">' +
    `<feFuncR type="linear" slope="${spec.amount}" intercept="${lit}"/>` +
    `<feFuncG type="linear" slope="${spec.amount}" intercept="${lit}"/>` +
    `<feFuncB type="linear" slope="${spec.amount}" intercept="${lit}"/>` +
    '<feFuncA type="linear" slope="0" intercept="1"/>' +
    '</feComponentTransfer>' +
    // 与 `SourceGraphic`（CSS 给的那层底色）相乘。只缩放亮度、不改色相，
    // 所以胶囊的颜色始终等于面板色提亮后的样子——换配色它自动跟着变。
    '<feComposite in="SourceGraphic" in2="lit" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="out"/>' +
    '</filter></svg>'
  );
}

/**
 * 浪脊：横着流的等值带。
 *
 * 和玉石同一套管线，只换参数：噪声的 y 频率是 x 的四倍多，
 * 梯度主要沿竖直方向，等值线于是横着走——一层压一层的浪。
 *
 * 为什么不再是「白条纹 + 位移」：那条路出的是「条纹」而不是「纹路」，
 * 而且白色叠在白底上，对比度被底色吃掉。用户 m09905 说
 * 「波浪这个不太明显，能不能也和玉石一样」，指的就是这件事。
 *
 * `center / amount` 是按本组参数**实测标定**的（`tools/probe/stone-sea.cjs`）：
 * 纹理均值 0.498、`amount 1.41` 时输出 sd 11.2，与玉石（11.4）和参考图（12.2）
 * 同一档。**换频率就要重新标一次**——两个数跟纹理分布绑定，不能照抄玉石的。
 */
const SEA_SPEC: BandSpec = {
  layers: [
    // 主干：又厚又晕，负责整块起伏。
    { freq: '0.004 0.018', seed: 23, width: 0.180, lo: 0.0, hi: 0.9, blur: 3.2, weight: 0.46 },
    // 中枝：横向压扁但仍在横向低频，形成一层压一层。
    { freq: '0.0088 0.0396', seed: 67, width: 0.034, lo: 0.22, hi: 0.9, blur: 1.0, weight: 0.32 },
    // 细枝：只补浪尖上的碎线，多了就变涟漪。
    { freq: '0.0152 0.0684', seed: 91, width: 0.014, lo: 0.30, hi: 0.9, blur: 0.5, weight: 0.22 },
  ],
  // 位移场与主干同频：低频只在整体平移，不会把浪拆碎。
  warp: { freq: '0.004 0.018', seed: 31, scale: 58 },
  amount: 1.41,
  center: 0.498,
};

const JADE_SPEC: BandSpec = {
  layers: [
    { freq: '0.007', seed: 23, width: 0.150, lo: 0.0, hi: 0.9, blur: 2.8, weight: 0.46 },
    { freq: '0.030', seed: 67, width: 0.022, lo: 0.24, hi: 0.9, blur: 0.85, weight: 0.30 },
    { freq: '0.070', seed: 91, width: 0.009, lo: 0.32, hi: 0.9, blur: 0.4, weight: 0.24 },
  ],
  warp: { freq: '0.007', seed: 31, scale: 66 },
  amount: 1.6,
  center: 0.54,
};
