// 票根纸张的颗粒。
//
// 用户 m14823：「是不是还有一种纸张的纹理感滤镜，这个也得做出来」。参考图放大
// 看纸面是一层很细的颗粒，深浅差一两个色阶，不是网点也不是布纹。
//
// 做法和 src/marble.ts 同一条路：纯字符串生成 SVG 滤镜标记，挂到 <body> 上，
// 纸面用 filter: url(#id) 引用。挂在被 overflow/clip-path 裁的容器里，
// Chromium 会判滤镜引用失效（大理石那轮踩过），所以宿主固定在 body。
//
// 这个文件不 import React：生成的 markup 要能被直接跑测试，
// 否则滤镜 id 对不上时 computed 会静默变 none，没有任何报错。

export const PAPER_FILTER_ID = 'tpl-ticket-paper';

/**
 * 纸纹滤镜。
 *
 * `fractalNoise` 而不是 `turbulence`：后者出的是等值线（那正是大理石要的脊），
 * 纸纹要的是均匀的细颗粒，fractalNoise 更像。
 *
 * 两步压对比是关键：
 * - `feColorMatrix saturate 0` 先把三个通道合成灰度（噪声三通道各自独立，
 *   不先合成会得到彩色噪点）；
 * - `feComponentTransfer` 把灰度压到 0.5 附近的一小段（slope 小、intercept 补回），
 *   再靠 `feBlend mode="multiply"` 乘到纸色上。直接乘原噪声会是满幅黑白噪点，
 *   纸上那是一层灰。
 *
 * 频率 0.9：纸纹的周期要在 1px 上下才有「颗粒」而不「花色」。每元素尺寸是
 * 300×300，0.9 对应的周期约 1.1px，正是印刷纸的目数。
 */
export function paperFilterMarkup(id = PAPER_FILTER_ID): string {
  return [
    `<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;pointer-events:none">`,
    `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`,
    `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="17" stitchTiles="stitch" result="n"/>`,
    `<feColorMatrix in="n" type="saturate" values="0" result="g"/>`,
    `<feComponentTransfer in="g" result="t">`,
    `<feFuncR type="linear" slope="0.34" intercept="0.83"/>`,
    `<feFuncG type="linear" slope="0.34" intercept="0.83"/>`,
    `<feFuncB type="linear" slope="0.34" intercept="0.83"/>`,
    `<feFuncA type="linear" slope="0" intercept="1"/>`,
    `</feComponentTransfer>`,
    `<feBlend in="SourceGraphic" in2="t" mode="multiply"/>`,
    `</filter>`,
    `</svg>`,
  ].join('');
}
