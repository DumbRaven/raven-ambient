/**
 * FNV-1a 32 位散列。
 *
 * 全项目所有「同一个输入每次都要长出同一个结果」的地方都用它：唱片压片工艺、
 * 封套款式、票根条码、灰烬粒子。用散列而不是 Math.random，是因为同一次启动里
 * 翻页、切分类、重新渲染都不能让画面换样——那看起来像画面在闪。
 *
 * 参数是 FNV-1a 的标准值：offset basis 2166136261、prime 16777619。
 * 写成 `0x811c9dc5` / `0x01000193` 是同一对数的十六进制形式，
 * 原先五个地方各写一种进制，读起来像是两套算法，其实逐位相同。
 */

/** 把字符串压成一个稳定的 32 位无符号整数。 */
export function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
