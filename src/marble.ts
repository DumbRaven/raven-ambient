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
 * （AE 源里那层就是「分型杂色 + 柔光」，照搬过来正是用户说的
 *  「看着就有点像分型杂色原来的样子」。）
 *
 * `jade`（玉石）：参考视频里那块胶囊放大看，是**大块的明暗、边界清楚、
 * 整体落差不大**的玉质感。用户 m07154 原话「不是云雾，而是类似于玉石那样的质感，
 * 明暗比较分明」，m07352 再确认「这个图一是我想要的感觉」。
 *
 * ## jade 的参数是怎么定的（三次失败之后）
 *
 * 一开始照统计靶子调：量参考图裁片的 sd / 峰度 / range95，然后搜参数。
 * 连做七轮都不像，原因有三层，每一层都是「测量骗人」：
 *
 *   1. **采样位置错了**：量的是胶囊左右两侧的无字窄带（6%~17% 与 83%~94%），
 *      那两条恰好是整块里最均匀的部分。拿边缘的统计去逼近整体，
 *      必然做出「均匀的糊」。
 *
 *   2. **绝对 sd 不可比**：参考图是从 134px 放大到 700px 的低通片，
 *      我们的截图是原生 140px。一路压 opacity 去追绝对 sd，压到看不见为止。
 *      改成比**衰减形状**（块均值 sd ÷ 1px sd）之后才有意义。
 *
 *   3. **峰度这个判据本身是错的**：`feTurbulence` 只有单一尺度，
 *      分布天生接近高斯，峰度停在 8~17 做不出参考图的 3.33。
 *      为了压峰度去加第二尺度，反而把纹理做成斑点。
 *
 * 最后靠两个数把形态定死（口径见 `tools/measure/stone-stats.cjs`）：
 *
 * |        | sd  | gradP95 | sd / gradP95 |
 * |--------|-----|---------|--------------|
 * | 参考图  | 12.1|   4.2   |     2.88     |
 * | 本版    | 13.0|   3.0   |     4.33     |
 *
 * `sd / gradP95` 说的是「这么大起伏里有多少是清楚的边界」。
 * 云雾版是 13.2（全是糊），`turbulence` 高频版是 1.8（全是碎点）。
 * `turbulence` 配大 slope 落在 3~4 之间，与参考图同量级——这一步才找对方向。
 *
 * 两条踩过的坑固化在参数里：
 *   - **alpha 必须钉死**：feTurbulence 的 alpha 也是噪声，不钉整块会半透明，
 *     柔光叠上去只剩一层灰雾。
 *   - **blur 不能大**：`stdDeviation` 超过 1 边界就糊回去（变塑料），
 *     小于 0.3 又留 1px 锯齿。0.6 是试出来的。
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
  { id: 'jade', name: '玉石', hint: '大块明暗，像玉里的雾' },
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
 * 玉石：两尺度噪声叠加 → 揉弯 → 抬底裁顶。
 *
 * 这一版和最初那版（`type="turbulence"` + 大 slope 做「脊」）是完全两条路。
 * 走到现在换了二十多轮，把结论留在这里，改参数之前先读：
 *
 * ## 参考图到底是什么
 *
 * 放大 6 倍看（`tools/measure/ref-top.png`）是一片**连续的灰雾**：
 * 有明有暗，但**没有任何一条边界线**；最暗处只到中灰，最亮处远不到白。
 * 没有丝、没有石脉、没有颗粒。此前十几轮追求的「边界清楚 / 有主有支的丝」
 * 在参考图里根本不存在——那是照着错误的统计靶子想象出来的。
 *
 * ## 三条把方向纠正过来的硬结论
 *
 *   1. **`turbulence` 出的是等值线**（丝、细胞、闭合圈）。用它配大 slope，
 *      无论怎么调都是「满屏均匀斑驳」。要做雾必须用 `fractalNoise`，
 *      且 `numOctaves` 只取 2（多了立刻碎成颗粒）。
 *
 *   2. **`<feComposite operator="over">` 会把整张灰度图盖上去**，
 *      得到一层不透明灰，CSS 的底色完全看不见。这一条静默出错，
 *      是前十几版「怎么做都像海绵」的直接原因。
 *      要乘用 `operator="arithmetic" k1="1"`。
 *
 *   3. **`operator="in"` 会用 SourceGraphic 的 alpha 当遮罩**。
 *      `::before` 的 `background` 一旦是透明，整张纹理就被乘成 0——
 *      现象是「换个底色，纹理忽然不见」，而且不报错。
 *      圆角裁剪由 CSS 的 `clip-path` 负责，这里不需要它。
 *
 * ## 参数
 *
 * - `baseFrequency 0.022`（横向）：胶囊约 140 CSS px 宽，周期 ≈ 45px，
 *   团块横跨胶囊三分之一。**这个数改大过也改小过，两头都不对**：
 *   0.062（周期 16px）实机是一粒一粒的霜花；0.014 以下整条胶囊
 *   只有一处起伏，读起来像渐变而不像石头。
 * - `freqY = freq / 1.45`：参考图量出的各向异性是**纵向拉长 1.41 倍**
 *   （`texture-scale.cjs` 的相关半衰 x 6.73 / y 9.77），所以纵向频率更低。
 * - `blur 0.9`（只作用在细层）：磨掉 `feTurbulence` 等值面的硬边。
 *   没有模糊时那些等值线边界清楚，像霜花；加到 1.4 以上整块糊成
 *   一片均匀浅灰（`stone-jade35.cjs` 六档全平），结构没了。
 * - `room 1.6 / center 0.487`：`center` 取裸玻璃的实测亮度（124/255），
 *   纹理围绕它上下浮动，**不改变整体明暗**。`room` 大于 1 是有意的，
 *   两端被钳到 0/1，形成少量极亮极暗的小块。
 * - 第二层 `baseFrequency 0.005`（周期 ≈ 200px，比胶囊还宽）提供
 *   **整片的明暗过渡**，`room 2.0` 比细层更阔，负责那处「一半亮一半暗」。
 *   两层按 0.45 加权**相加**——相乘会把暗处压得更暗，均值会崩。
 * - 可见度在 CSS 那层（`opacity`），不在滤镜里。分开放的理由：
 *   滤镜决定「起伏多大」，CSS 决定「能不能看见」，两件事调的时候不该互相干扰。
 */
function jadeMarkup(id: string): string {
  const CENTER = 0.487;

  /**
   * 一层噪声 → 去色 →（可选）揉弯 → 抬底裁顶。
   *
   * `warp` 为 0 时用 `feOffset` 占位而不是省掉这一步：后面统一按
   * `${name}b` 取输入，少一个分支就少一种「某一层没接上」的可能。
   */
  const layer = (name: string, opts: { freq: string; seed: number; room: number; warp: number; warpSeed: number; blur: number }) => {
    const { freq, seed, room, warp, warpSeed, blur } = opts;
    // 保留三位小数：0.487 - 0.8 在浮点下是 -0.31300000000000006，
    // 直接插进 markup 会让标签字符串变脏（测试、探针、diff 都受影响）。
    const intercept = (CENTER - room / 2).toFixed(3);
    const bend = warp > 0
      ? '<feTurbulence type="fractalNoise" baseFrequency="0.01 0.0069" numOctaves="2" seed="' + warpSeed + '" result="' + name + 'wn"/>' +
        '<feColorMatrix in="' + name + 'wn" type="saturate" values="0" result="' + name + 'wg"/>' +
        '<feDisplacementMap in="' + name + 'g" in2="' + name + 'wg" scale="' + warp + '" xChannelSelector="R" yChannelSelector="G" result="' + name + 'b"/>'
      : '<feOffset in="' + name + 'g" dx="0" dy="0" result="' + name + 'b"/>';
    // 模糊只磨等值面的硬边。加到 1.4 以上整块会糊成一片均匀浅灰（试过）。
    const soft = blur > 0 ? '<feGaussianBlur in="' + name + 'b" stdDeviation="' + blur + '" result="' + name + 's"/>' : '';
    const tail = blur > 0 ? name + 's' : name + 'b';
    return (
      `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" result="${name}n"/>` +
      `<feColorMatrix in="${name}n" type="saturate" values="0" result="${name}g"/>` +
      bend +
      soft +
      `<feComponentTransfer in="${tail}" result="${name}">` +
      `<feFuncR type="linear" slope="${room}" intercept="${intercept}"/>` +
      `<feFuncG type="linear" slope="${room}" intercept="${intercept}"/>` +
      `<feFuncB type="linear" slope="${room}" intercept="${intercept}"/>` +
      // alpha 钉死：feTurbulence 的 alpha 也是噪声，不钉整块会半透明。
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer>`
    );
  };

  return (
    `<svg width="300" height="300"><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    // 细纹理：0.022 横向（周期 ≈ 45px，团块横跨胶囊三分之一）。
    // 揉弯让等值面不再闭合；模糊 0.9 磨掉硬边但保住结构。
    layer('fine', { freq: '0.022 0.0152', seed: 23, room: 1.6, warp: 22, warpSeed: 31, blur: 0.9 }) +
    // 大块：周期比胶囊还宽，只负责整片的明暗过渡，不揉弯（揉弯会把它切成块）。
    layer('big', { freq: '0.005', seed: 41, room: 2.0, warp: 0, warpSeed: 0, blur: 0 }) +
    // 相加：细纹理打底，大块明暗托住。k2 + k3 = 1，中心值不变。
    '<feComposite in="fine" in2="big" operator="arithmetic" k1="0" k2="0.55" k3="0.45" k4="0"/>' +
    '</filter></svg>'
  );
}
