/**
 * 凹槽（竖排胶囊）的大理石纹滤镜。
 *
 * 从 TemplateStage.tsx 抽出来单独放，是因为这个串**写错了不会有任何报错**：
 * 引用的 id 对不上时 computed 只是变回 `none`（静默失效），
 * 滤波器顺序写反时也只是"看着不像石头"。抽成纯字符串函数之后，
 * 测试可以直接对管线本身做断言，不用起 Electron 截图比对。
 *
 * 真大理石长什么样：它是一层**被揉弯的条带**。石头在地壳里被挤，
 * 沉积层的平行条纹被压成弯弯曲曲的脉络。所以正确做法不是「生成噪声」，
 * 而是「先画直的条纹，再用低频噪声把它揉弯」——这正是 feDisplacementMap 干的事。
 * 直接照搬 feTurbulence 出来的是一片**均匀噪点**，像电视雪花。
 * （AE 源里那层就是「分型杂色 + 柔光」，照搬过来正是用户说的
 *  「看着就有点像分型杂色原来的样子」。）
 *
 * 管线：
 *   SourceGraphic（::before 自己画的 repeating-linear-gradient 条纹）
 *     → 用一段低频、横向拉长的湍流当位移场，把条纹揉成有机脉络
 *     → 轻微模糊，让边缘晕开（石头没有硬边）
 *     → 提对比，中间调压成「亮脉 + 暗底」两层
 *     → 再乘一层低幅噪声，避免脉络过于规整
 */
export const MARBLE_FILTER_ID = 'tpl-marble';

/** 挂滤镜用的 <svg> 标记。插到 <body> 上，不要放进被裁的容器里。 */
export function marbleFilterMarkup(id = MARBLE_FILTER_ID): string {
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
