/**
 * 数值夹取。
 *
 * 全项目原先有三份一模一样的实现（`model.ts` 带 NaN 保护、`rain.ts` 与
 * `templates.ts` 不带），三处都不一样的原因只是各写各的。它们的差别在
 * 传入 NaN 时：`Math.min(max, Math.max(min, NaN))` 结果还是 NaN，
 * 所以不带保护的那两份拿到脏数据会把 NaN 一路传进样式里（`opacity: NaN`），
 * 而存档、用户导入的文件名里出现脏数据的可能是真的。
 */

/** 把 `n` 夹到 [min, max]。`n` 不是有限数时退回 `min`。 */
export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
