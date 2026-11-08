/**
 * 凹槽（竖排胶囊）的石纹滤镜。
 *
 * 从 TemplateStage.tsx 抽出来单独放，是因为这个串**写错了不会有任何报错**：
 * 引用的 id 对不上时 computed 只是变回 `none`（静默失效），
 * 滤波器顺序写反时也只是"看着不像石头"。抽成纯字符串函数之后，
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
 * `cloud`（云雾）：参考视频里那块胶囊放大看，是**大团柔和的明暗**、
 * 边缘晕开、几乎没有方向性脉络，像浓雾或水下——和上面的浪脊是两种东西。
 * 用户要能自己选，所以两条管线并存。
 *
 * ## cloud 的参数是量出来的，不是调出来的
 *
 * 拿参考图裁片（`tools/measure/tag-crop.cjs` 用 ffmpeg 放大 5 倍）做靶子，
 * 在 `.tools/tag-direction.cjs` 里量了两件决定性的事：
 *
 *   1. **相关半衰距离**：相邻像素相关系数降到 0.5 的距离只有
 *      x 5.8px / y 8.2px（已折算回原尺寸）⇒ 团块直径十几到几十像素。
 *      前六轮一直用 baseFrequency 0.005~0.020（周期 50~200px），
 *      等于「在一整块渐变上撒灰」，怎么调 opacity 都不像。
 *
 *   2. **各向异性**：lag=32 时 x 相关 0.452、y 相关 0.574，纵向掉得慢
 *      ⇒ 纹理沿纵向被拉长 1.41 倍。所以 baseFrequency 给两个不同的值
 *      （横 0.025 / 纵 0.0177），团块是竖着拉长的，与胶囊的窄高形态一致。
 *
 * 另外两条踩过的坑也固化在参数里：
 *   - **alpha 必须钉死**：feTurbulence 的 alpha 也是噪声，不钉整块会半透明，
 *     柔光叠上去只剩一层灰雾（第二轮六个候选全废在这上面）。
 *   - **blur 不能大**：超过 2 团块边界就糊掉，变成一块塑料；
 *     小于 1.2 又会出现细颗粒，读作斑驳。
 */
export const MARBLE_FILTER_ID = 'tpl-marble';

/** 胶囊表面的两种石纹。`sea` 是默认的浪脊，`cloud` 是参考视频里那种雾。 */
export type StoneStyle = 'sea' | 'cloud';

/**
 * 面板里可选的石纹。
 *
 * `hint` 是**选项副标题**，跟着选项自己出现——按「界面不加解释」的约定，
 * 说明要贴在选项上，不能在整组下面挂一行通用文字。
 */
export const stoneStyles: ReadonlyArray<{ id: StoneStyle; name: string; hint: string }> = [
  { id: 'sea', name: '浪脊', hint: '横向起伏的石纹' },
  { id: 'cloud', name: '云雾', hint: '柔和的团块，像浓雾' },
];

export function isStoneStyle(value: unknown): value is StoneStyle {
  return value === 'sea' || value === 'cloud';
}

/** 找不到就把任意值收敛成默认那一种。 */
export function findStoneStyle(value: unknown): StoneStyle {
  return isStoneStyle(value) ? value : 'sea';
}

/** 挂滤镜用的 <svg> 标记。插到 <body> 上，不要放进被裁的容器里。 */
export function marbleFilterMarkup(style: StoneStyle = 'sea', id = MARBLE_FILTER_ID): string {
  return style === 'cloud' ? cloudMarkup(id) : seaMarkup(id);
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

/** 云雾：团块噪声 → 去色 → 拉开对比 → 大模糊。不碰 SourceGraphic。 */
function cloudMarkup(id: string): string {
  return (
    // 模糊会把像素推到边界外，region 同样要放宽。
    `<svg width="300" height="300"><filter id="${id}" x="-25%" y="-25%" width="150%" height="150%">` +
    // 横向频率高于纵向（0.025 / 0.0177）⇒ 团块沿纵向拉长，与胶囊的窄高一致。
    // 这两个数是量出来的：纵向周期 = 横向 × 1.41，见文件头。
    '<feTurbulence type="fractalNoise" baseFrequency="0.025 0.0177" numOctaves="4" seed="23" result="cloud"/>' +
    '<feColorMatrix in="cloud" type="saturate" values="0" result="flat"/>' +
    // 先围绕 0.5 拉开对比：柔光对接近 0.5 的像素几乎不做改动，
    // 而团块噪声的输出恰好挤在中间，不拉就是一片平灰。
    '<feComponentTransfer in="flat" result="lifted">' +
    '<feFuncR type="linear" slope="1.5" intercept="-0.25"/>' +
    '<feFuncG type="linear" slope="1.5" intercept="-0.25"/>' +
    '<feFuncB type="linear" slope="1.5" intercept="-0.25"/>' +
    // alpha 钉死为 1。这一条漏了整块会半透明，柔光叠上去只剩灰雾。
    '<feFuncA type="linear" slope="0" intercept="1"/>' +
    '</feComponentTransfer>' +
    // 模糊要够把八度的棱角化开（不然是霉斑），又不能糊到没有边界（不然是塑料）。
    '<feGaussianBlur in="lifted" stdDeviation="2"/>' +
    '</filter></svg>'
  );
}
