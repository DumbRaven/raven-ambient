/**
 * 时长读数。全项目的「还剩多久 / 已经播了多久」都从这里出。
 *
 * 原先有四份独立实现（`focus.ts` 的倒计时、`stage-text.ts` 的播放进度、
 * `model.ts` 的曲目时长、`layers.ts` 的图层番茄钟），它们只在两件事上不同，
 * 而这两件事都是**语义差异而不是复制粘贴的意外**，所以做成参数：
 *
 * - **取整**。倒计时向上取整（25:00 从第一帧就要完整显示，不能一上来就是
 *   24:59）；播放进度向下取整（播到 2:05.9 时应该显示 2:05，而不是提前
 *   报 2:06）；图层番茄钟四舍五入（它每 100ms 刷一次，向下取整会看着像卡住）。
 * - **分钟补零**。图层番茄钟是等宽数字、位置固定，`00:00` 对齐才不会跳；
 *   曲目时长是行内文字，`2:05` 比 `02:05` 紧凑。
 *
 * **没有小时位，这是有意的**：90 分钟就显示 `90:00`。加小时位会让同一个
 * 位置出现两种宽度（`59:59` → `1:00:00` 反而变短），读数会跳；而 `90:00`
 * 这种写法在计时器语境里本来就不难读——它只有一个数在变，另一位数不动。
 */

type Rounding = 'floor' | 'ceil' | 'round';

export type DurationOptions = {
  /** 秒的小数部分怎么处理。默认 `floor`。 */
  round?: Rounding;
  /** 分钟位是否补零到两位。默认否——`2:05` 比 `02:05` 紧凑。 */
  padMinutes?: boolean;
};

/**
 * 时长（**秒**）→ `m:ss`。超过 60 分钟分钟数继续往上加（`90:00`）。
 *
 * 传进来的是秒不是毫秒：全项目里的时长来源（`HTMLMediaElement.duration`、
 * `Date.now()` 差值、`remainingMs`）都先各自归一成秒再调用，免得这里猜单位。
 */
export function durationText(seconds: number, options: DurationOptions = {}): string {
  // 非有限数（NaN / ±Infinity）和负数一律当 0：读数为空比读出 NaN 好。
  if (!Number.isFinite(seconds) || seconds < 0) return pair(0, 0, options);
  const { round = 'floor' } = options;
  const total = round === 'ceil' ? Math.ceil(seconds) : round === 'round' ? Math.round(seconds) : Math.floor(seconds);
  return pair(Math.floor(total / 60), total % 60, options);
}

function pair(minutes: number, rest: number, options: DurationOptions): string {
  const { padMinutes = false } = options;
  return `${padMinutes ? String(minutes).padStart(2, '0') : minutes}:${String(rest).padStart(2, '0')}`;
}
