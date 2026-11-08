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
  return style === 'jade' ? jadeMarkup(id) : seaMarkup(id);
}

/** 浪脊：条纹 → 揉弯 → 模糊 → 提对比 → 叠细颗粒。 */
function seaMarkup(id: string): string {
  return (
    // 位移会让像素跑出元素边界，region 必须放宽，否则四周会被裁掉一圈。
    `<svg width="300" height="300"><filter id="${id}" x="-25%" y="-25%" width="150%" height="150%">` +
    // 位移场：x 频率远低于 y，条纹主要被「左右挤」，这是大理石脉络的方向感来源。
    // numOctaves 4 而不是 10：层数多了又变成细碎噪点，正是要避免的那种。
    '<feTurbulence type="fractalNoise" baseFrequency="0.006 0.019" numOctaves="4" seed="23" result="warp"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="warp" scale="46" xChannelSelector="R" yChannelSelector="G" result="bent"/>' +
    '<feGaussianBlur in="bent" stdDeviation="0.9" result="soft"/>' +
    '<feComponentTransfer in="soft" result="contrast">' +
    '<feFuncR type="linear" slope="1.55" intercept="-0.28"/>' +
    '<feFuncG type="linear" slope="1.55" intercept="-0.28"/>' +
    '<feFuncB type="linear" slope="1.55" intercept="-0.28"/>' +
    '</feComponentTransfer>' +
    // 细颗粒：石面不是光滑的，但只留一点点，多了就又回到雪花。
    '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="grain"/>' +
    '<feColorMatrix in="grain" type="saturate" values="0" result="gray"/>' +
    '<feBlend in="contrast" in2="gray" mode="soft-light"/>' +
    '</filter></svg>'
  );
}



/**
 * 玉石：三层中值等值带 → 揉弯 → 加权平均 → 亮度系数 × 底色。
 *
 * 走到这一版换了六十多轮，结论留在这里，改参数之前先读。
 *
 * ## 为什么是「中值等值带」而不是折叠
 *
 * 上一版用折叠 `pow(|sin(v·rings·π)|, sharp)` 出等值线。
 * 那出的是**闭合等值线圈**，挤在一起就成了圆斑——
 * `blobs.cjs` 量出 149 个块、直径 p50 只有 1.1px，用户正是因此说
 * 「太像龟裂 / 像点不像根」。
 *
 * 中值等值带取噪声值等于 0.5 的那一层：
 *
 *   `val = hi − (hi − lo)·exp(−((x − 0.5)/width)²)`
 *
 * 噪声的等值面天然连成蜿蜒曲线，细长、会分叉、铺满整个平面。
 * 三层不同频率叠加（主干 / 中枝 / 细枝），宽度依次收窄，
 * 就得到「有粗有细、有主有支」的树根感。
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
function jadeMarkup(id: string): string {
  /**
   * 一条丝的映射表：`val = hi − (hi − lo)·exp(−((x − 0.5)/width)²)`。
   *
   * 在 x = 0.5 处取到 `lo`（最暗），离得越远越亮，`width` 越大带越宽。
   * 写成 `feComponentTransfer type="table"` 就是在整张图上执行这条曲线。
   */
  const bandTable = (lo: number, hi: number, width: number, samples = 160): string => {
    const values: string[] = [];
    for (let index = 0; index < samples; index += 1) {
      const unit = index / (samples - 1);
      const offset = (unit - 0.5) / width;
      values.push((hi - (hi - lo) * Math.exp(-offset * offset)).toFixed(4));
    }
    return values.join(' ');
  };

  const layer = (
    name: string,
    cfg: { freq: string; seed: number; width: number; lo: number; hi: number },
  ): string => {
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

  /**
   * 调制幅度。纹理只在这层底色上**加减明暗**，不改它是什么颜色。
   * 1.6 是把对比度对到参考图 sd 12.22 的那一档（stone-amount.cjs 扫出来的）。
   */
  const amount = 1.6;

  /**
   * 纹理的亮度中心。**必须实测，不能假设 0.5**（见上方「均值与幅度」）。
   * 0.54 来自 `stone-root.cjs` 的自动标定，对应最终这组 `lo/width`。
   */
  const center = 0.54;

  const lit = (1 - amount * center).toFixed(3);

  return (
    // 位移与模糊都会让像素跑出元素边界，region 放宽一圈，否则四周被裁。
    `<svg width="300" height="300"><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    // 1. 三条丝：主干宽而深，中枝与细枝依次收窄提亮——「有粗有细，有主有支」。
    layer('v0', { freq: '0.007', seed: 23, width: 0.150, lo: 0.0, hi: 0.9 }) +
    layer('v1', { freq: '0.030', seed: 67, width: 0.022, lo: 0.24, hi: 0.9 }) +
    layer('v2', { freq: '0.070', seed: 91, width: 0.009, lo: 0.32, hi: 0.9 }) +
    // 2. 位移场：三条丝共用同一个，否则主支朝不同方向弯，像三层贴在一起。
    //    频率 0.007 配 scale 66 是把等值线揉成「不规则长团」的档位；
    //    频率再低只会整体平移，再高就散成斑。
    '<feTurbulence type="fractalNoise" baseFrequency="0.007" numOctaves="2" seed="31" result="wn"/>' +
    '<feColorMatrix in="wn" type="saturate" values="0" result="wg"/>' +
    '<feDisplacementMap in="v0t" in2="wg" scale="66" xChannelSelector="R" yChannelSelector="G" result="v0b"/>' +
    '<feDisplacementMap in="v1t" in2="wg" scale="66" xChannelSelector="R" yChannelSelector="G" result="v1b"/>' +
    '<feDisplacementMap in="v2t" in2="wg" scale="66" xChannelSelector="R" yChannelSelector="G" result="v2b"/>' +
    // 3. 模糊只磨等值面的硬边。主干 2.8 是为了让暗团边缘晕开（参考图就是晕的）。
    '<feGaussianBlur in="v0b" stdDeviation="2.8" result="v0f"/>' +
    '<feGaussianBlur in="v1b" stdDeviation="0.85" result="v1f"/>' +
    '<feGaussianBlur in="v2b" stdDeviation="0.4" result="v2f"/>' +
    // 4. 加权平均：权重和 = 1，均值才不跟着权重跑。
    //    主干 0.46（决定暗区主体）、中枝 0.30、细枝 0.24（只补边缘碎线）。
    //    用乘积会把均值一起砍半，整块发闷，所以只能是加权平均。
    '<feComposite in="v0f" in2="v1f" operator="arithmetic" k1="0" k2="0.46" k3="0.30" k4="0" result="s1"/>' +
    '<feComposite in="s1" in2="v2f" operator="arithmetic" k1="0" k2="0.76" k3="0.24" k4="0" result="mix"/>' +
    // 5. 把中性灰映射成**亮度系数**：`m = amount·(mix − center) + 1`，
    //    于是 `mix = center` 处正好乘 1（不改整体明暗），上下各 ±amount/2。
    '<feComponentTransfer in="mix" result="lit">' +
    `<feFuncR type="linear" slope="${amount}" intercept="${lit}"/>` +
    `<feFuncG type="linear" slope="${amount}" intercept="${lit}"/>` +
    `<feFuncB type="linear" slope="${amount}" intercept="${lit}"/>` +
    '<feFuncA type="linear" slope="0" intercept="1"/>' +
    '</feComponentTransfer>' +
    // 6. 与 `SourceGraphic`（CSS 给的那层底色）相乘。只缩放亮度、不改色相，
    //    所以胶囊的颜色始终等于面板色提亮后的样子——换配色它自动跟着变。
    '<feComposite in="SourceGraphic" in2="lit" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="out"/>' +
    '</filter></svg>'
  );
}
