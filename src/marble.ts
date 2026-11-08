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
 * `jade`（玉石）：参考视频里那块胶囊，是**大块明暗之间带连贯纹路**的玉。
 * 用户三次否定的原话决定了它的样子：
 *   m07154「不是云雾，而是类似于玉石那样的质感，明暗比较分明」
 *   m07574「有那种玉石里面有那种色彩纹路渐隐渐现的沁在里面一样……现在单纯是色块了，没有链接感」
 *   m08231「有点太雾了，没有玉石明显的纹路感啊，你自己没发现吗」
 * 三句连起来是：**要有纹路，纹路要连贯、渐隐渐现，但不要硬边、不要糊成雾**。
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
  { id: 'jade', name: '玉石', hint: '明暗之间连着纹' },
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

/** 折一次 = 一条纹。峰处落 `lo`，其余落 `hi`。 */
function foldTable(rings: number, sharp: number, lo: number, hi: number): string {
  const steps = Math.max(96, 32 * rings + 1);
  const values: string[] = [];
  for (let index = 0; index < steps; index += 1) {
    const unit = index / (steps - 1);
    // |sin| 每跨 1/rings 循环一次，每次都是一个「峰」——峰处画一条暗纹。
    const peak = Math.pow(Math.abs(Math.sin(unit * rings * Math.PI)), sharp);
    values.push((hi - peak * (hi - lo)).toFixed(3));
  }
  return values.join(' ');
}

/**
 * 玉石：折叠出纹路 → 揉弯 → 多层 lerp → 末尾一级线性收尾。
 *
 * 走到这一版换了五十多轮，把结论留在这里，改参数之前先读。
 *
 * ## 参考图到底是什么（前四次都读错了）
 *
 * 放大 6 倍看像「一片连续的灰雾、没有任何边界」，于是做了十几轮雾；
 * 用户回「有点太雾了，没有玉石明显的纹路感啊，你自己没发现吗」。
 * 真正的结构是**大块明暗之间连着纹**：纹是半透明的、边缘晕开的，
 * 所以放大后看着不像「线」，但走向、粗细变化都在。
 * **把「边缘不生硬」读成「没有边界」**，是这一整段弯路的总根因。
 *
 * ## 四条把方向纠正过来的硬结论
 *
 *   1. **`feTurbulence` 的线性缩放只能改「振幅」，做不出「形状」**。
 *      各向异性只会把脊压扁（出来是拉丝金属），调 slope 只会改对比。
 *      要纹路必须是**等值线**——靠折叠 `pow(|sin(v·rings·π)|, sharp)`
 *      把噪声值反复循环，每跨一个 1/rings 就是一条线。
 *      `rings` 等于线的条数，`sharp` 等于线宽。这是唯一走出
 *      「雾 / 斑点 / 竖条」三条死路的路。
 *
 *   2. **遮罩必须用 lerp，不能用乘法**。乘法（`operator="multiply"` 或
 *      `arithmetic k1="1"` 直接连乘）会把均值一起砍半，整块发闷；
 *      lerp 的均值由纹路与背景两端共同决定。
 *
 *   3. **`<feComposite operator="over">` 会把整张灰度图盖上去**，
 *      得到一层不透明灰，CSS 底色完全看不见。这条静默出错，
 *      是前十几版「怎么做都像海绵」的直接原因。要乘用 `arithmetic k1="1"`。
 *
 *   4. **`operator="in"` 会用 SourceGraphic 的 alpha 当遮罩**。
 *      `::before` 的 `background` 一旦是透明，整张纹理就被乘成 0——
 *      现象是「换个底色，纹理忽然不见」，而且不报错。
 *      圆角裁剪由 CSS 的 `clip-path` 负责，这里不需要它。
 *
 * ## 参数（口径见 `tools/measure/hist-round.cjs` 与 `tools/measure/blobs.cjs`）
 *
 * 参考图（`tools/measure/tag-raw.png`，按胶囊自身圆角造掩膜）：
 *
 *   mean 133.2  sd 9.7  skew −0.55
 *   暗区占 0.498，其中 ≥12px 的连通块占 **0.908**，块数 30，直径 p95 **33.8**
 *
 * 本版实测 `mean 132.7 / sd 9.5 / skew −0.69 / large 0.871 / blobs 32 / diam p95 27.2`。
 *
 * - **`sharp 4.5 / rings 1`（不是高 sharp）**：这一条推翻了前面十几轮的判断。
 *   高 `sharp` 能把 `skew` 调成负的（亮底暗点），但暗部会碎成麻点——
 *   参考图是**几大片连着的暗团**，`blobs.cjs` 量出大块占比 0.908，
 *   而高 sharp 版只有 0.742。**直方图对不出这个差别**：
 *   一片 100px 的暗团与 100 个 10px 的点，直方图完全一样。
 *   所以判据必须是暗区的**连通性**，不是分布。
 * - **主纹周期 ≈50px、细纹 ≈12px**：细层只贡献边缘碎边、权重 0.22，
 *   不参与暗区主体——它一多，暗区就被切成小点。
 * - **位移 `scale 62` + 位移场频率 `0.011`**：把规整的等值线揉成不规则长团。
 *   位移太小出来是等值线圈，太大就散成斑。
 * - **`squeeze` 绕 0.625 等比压缩跨度**：结构对了之后剩下的只是「幅度太大」，
 *   `k` 只影响对比度、不影响均值。
 * - **末尾一级 `feColorMatrix` 收尾**：`y' = gain·y + offset`，
 *   同时给三通道不同的 offset 补偏色（`TINT`，见下）。
 *   `gain` 定跨度、`offset` 定均值，两者正交；解耦公式是
 *   `offset = 均值 / 255 − gain × 中间值`，中间值由实测反推。
 * - 可见度在 CSS 那层（`opacity: 1`），不在滤镜里。
 */
function jadeMarkup(id: string): string {
  /**
   * 一层纹路：噪声 → 去色 → 折叠成等值线 → 抬到 `[lo, hi]`。
   *
   * 折叠必须写在 `feComponentTransfer type="table"` 里——`tableValues`
   * 就是映射表，浏览器按输入值在表里插值，等价于对整张图做一次折函数。
   */
  const vein = (
    name: string,
    cfg: { freq: string; seed: number; rings: number; sharp: number; lo: number; hi: number },
  ): string => {
    const table = foldTable(cfg.rings, cfg.sharp, cfg.lo, cfg.hi);
    return (
      `<feTurbulence type="turbulence" baseFrequency="${cfg.freq}" numOctaves="2" seed="${cfg.seed}" result="${name}n"/>` +
      `<feColorMatrix in="${name}n" type="saturate" values="0" result="${name}g"/>` +
      `<feComponentTransfer in="${name}g" result="${name}c">` +
      `<feFuncR type="table" tableValues="${table}"/>` +
      `<feFuncG type="table" tableValues="${table}"/>` +
      `<feFuncB type="table" tableValues="${table}"/>` +
      // alpha 钉死：feTurbulence 的 alpha 也是噪声，不钉整块会半透明。
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer>`
    );
  };

  const bgTable = foldTable(1, 5, 0.66, 0.90);

  /**
   * 调制幅度：纹理只在这层底色上**加减明暗**，不改它是什么颜色。
   *
   * 这一条是用户 m09087 指出来的，也是我先前做错的地方：
   * 「这个胶囊不是分型杂色吗，也就是说它本身是没有色彩的，
   *   他是根据面板的颜色来变色的」。
   *
   * 参考图那块胶囊偏蓝（`blueMinusRed +24.3`），我量到之后**把蓝写死进了
   * 滤镜末尾的三个 offset**。数值是对上了，但那是把「面板的蓝透过半透明
   * 胶囊」这件事拍成了一张死照片——用户把面板换成暖色，胶囊纹丝不动。
   * 实测（`tools/probe/stone-follow.cjs` 六档面板）时 `dR=dG=dB=0`。
   *
   * 改法：管线最后一级**读 `SourceGraphic`**（也就是 CSS 给 `::before` 的
   * 那层底色，由 `color-mix(白, var(--tpl-panel))` 算出来），把中性灰纹理
   * 当代数和加上去。颜色于是始终等于「面板提亮后的颜色」，
   * 纹理只负责明暗起伏。
   *
   * 试过但不对的：给 `::before` 换 `mix-blend-mode: multiply`。
   * 实测六档候选里 multiply 与 normal 的数值一字不差——`.tpl-tag` 上有
   * `isolation: isolate`，混合只在胶囊自己的层叠上下文里发生，背景里
   * 根本没有面板色可乘。拆掉 isolation 直接乘面板又会把整块压暗
   * （mean 132 → 92）。
   */
  const amount = 1.6;

  /**
   * 纹理的亮度中心（0~1）。
   *
   * **这个数必须实测，不能假设 0.5。** 前两层折叠后的 `hi` 是 0.94/0.92、
   * 背景层 0.66~0.90，加权平均下来整张纹理的平均亮度是 **0.73**，
   * 比中灰亮不少（`tools/probe/stone-mixrange.cjs` 截 mix 层直接量的）。
   *
   * 我一开始按「中灰」把它映射成 `amount·mix + (1 − amount/2)`，
   * 于是均值落在 1.078，一大片被钳在 1 —— 调 `amount` 只是让被钳的面积
   * 变大变小，纹理对比度（sd）几乎不动（0.7 → 0.8），只有 skew 在翻。
   * 找了很久「为什么调不动」，就是这一条。
   */
  const CENTER = 0.73;

  return (
    // 位移与模糊都会让像素跑出元素边界，region 放宽一圈，否则四周被裁。
    `<svg width="300" height="300"><filter id="${id}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">` +
    // 1. 主纹与支纹：主纹宽而连续（暗区主体），细纹窄而碎（只做边缘）。
    vein('vm', { freq: '0.018 0.025', seed: 23, rings: 1, sharp: 4.5, lo: 0.05, hi: 0.94 }) +
    vein('vs', { freq: '0.080 0.108', seed: 67, rings: 1, sharp: 14, lo: 0.28, hi: 0.92 }) +
    // 2. 位移场：两层共用同一个，否则主支朝不同方向弯，像两层贴在一起。
    //    频率 0.011 配 scale 62 是把等值线揉成「不规则长团」的档位，
    //    频率再低只会整体平移，再高就散成斑。
    '<feTurbulence type="fractalNoise" baseFrequency="0.011 0.008" numOctaves="2" seed="31" result="wn"/>' +
    '<feColorMatrix in="wn" type="saturate" values="0" result="wg"/>' +
    '<feDisplacementMap in="vmc" in2="wg" scale="62" xChannelSelector="R" yChannelSelector="G" result="vmb"/>' +
    '<feDisplacementMap in="vsc" in2="wg" scale="62" xChannelSelector="R" yChannelSelector="G" result="vsb"/>' +
    // 3. 模糊只磨等值面的硬边。主纹 1.8 是为了让暗团边缘晕开（参考图就是晕的）。
    '<feGaussianBlur in="vmb" stdDeviation="1.8" result="vmf"/>' +
    '<feGaussianBlur in="vsb" stdDeviation="0.55" result="vsf"/>' +
    '<feComposite in="vmf" in2="vsf" operator="arithmetic" k1="0" k2="0.78" k3="0.22" k4="0" result="vv"/>' +
    // 4. 背景层：低频 turbulence 折叠一次，出「大片浅灰 + 少数几处深斑」。
    '<feTurbulence type="turbulence" baseFrequency="0.006 0.0044" numOctaves="2" seed="41" result="bn"/>' +
    '<feColorMatrix in="bn" type="saturate" values="0" result="bg"/>' +
    `<feComponentTransfer in="bg" result="bgt">` +
    `<feFuncR type="table" tableValues="${bgTable}"/>` +
    `<feFuncG type="table" tableValues="${bgTable}"/>` +
    `<feFuncB type="table" tableValues="${bgTable}"/>` +
    `<feFuncA type="linear" slope="0" intercept="1"/>` +
    `</feComponentTransfer>` +
    '<feGaussianBlur in="bgt" stdDeviation="2.2" result="bc"/>' +
    // 5. 加权平均（不是 lerp、不是乘法）：两层都偏亮，只在纹与暗斑处下拉。
    //    用乘积会把均值一起砍半，整块发闷。
    '<feComposite in="vv" in2="bc" operator="arithmetic" k1="0" k2="0.42" k3="0.58" k4="0" result="mix"/>' +
    // 6. 把中性灰映射成**亮度系数**：`m = amount·(mix − CENTER) + 1`，
    //    于是 `mix = CENTER` 处正好乘 1（不改整体明暗），上下各 `±amount/2`。
    //    中心取实测的 0.73，不是中灰 0.5——写成 0.5 会让均值越界被钳住。
    `<feComponentTransfer in="mix" result="lit">` +
    `<feFuncR type="linear" slope="${amount}" intercept="${(1 - amount * CENTER).toFixed(3)}"/>` +
    `<feFuncG type="linear" slope="${amount}" intercept="${(1 - amount * CENTER).toFixed(3)}"/>` +
    `<feFuncB type="linear" slope="${amount}" intercept="${(1 - amount * CENTER).toFixed(3)}"/>` +
    `<feFuncA type="linear" slope="0" intercept="1"/>` +
    `</feComponentTransfer>` +
    // 7. 与 `SourceGraphic`（CSS 给的那层「白 + 面板色」）相乘。
    //    相乘只缩放亮度、不改色相，所以胶囊的颜色始终等于面板色提亮后的样子——
    //    面板换成暖色，胶囊自动跟着变暖。这就是「纹理本身没有颜色」的落地方式。
    '<feComposite in="SourceGraphic" in2="lit" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="out"/>' +
    '</filter></svg>'
  );
}
