/**
 * 在唱片上左右滑动切歌的手势判定。
 *
 * 为什么单独一个文件：规则本身只有几行，但「多少算滑动」「斜着算不算」
 * 「跟手要不要钳住」全是边界条件，而组件里没法对着真实手指验证。
 * 抽成纯函数之后，测试可以拿一串坐标把每条边界走一遍。
 *
 * 三个数是量出来的，不是拍的：
 *   - 阈值 48px：唱片直径约 390px，48px 是它的一成多一点。再小会把手指
 *     按下去时的轻微位移当成切歌；再大就得横跨小半个屏幕才生效。
 *   - 斜率 1.4：纵向分量超过横向的七成就不算横滑。少了这一条，
 *     斜着往下一划会既像「翻页」又像「切歌」。
 *   - 跟手上限 16px：唱片是从面板挖出来的圆洞里露着的，实测洞比碟大
 *     20.5px（半径方向）。超过这个数碟就撞上洞边，看着像穿模。
 */

/** 触发切歌的横向位移，像素。 */
export const SWIPE_THRESHOLD = 48;

/** 横向位移至少要是纵向的这么多倍。 */
export const SWIPE_SLOPE = 1.4;

/** 手指走 1px，碟走这么多。跟手是提示，不是真的把碟拖走。 */
export const SWIPE_FOLLOW_RATIO = 0.35;

/** 跟手位移的绝对值上限，像素。 */
export const SWIPE_FOLLOW_MAX = 16;

export type SwipePoint = { x: number; y: number };

/** 一次滑动的轨迹。`dx`/`dy` 是相对按下那一刻的位移。 */
export type SwipeTrack = { origin: SwipePoint; dx: number; dy: number };

export function beginSwipe(point: SwipePoint): SwipeTrack {
  return { origin: point, dx: 0, dy: 0 };
}

export function moveSwipe(track: SwipeTrack, point: SwipePoint): SwipeTrack {
  return { origin: track.origin, dx: point.x - track.origin.x, dy: point.y - track.origin.y };
}

/**
 * 跟手位移，像素。向左滑为负、向右为正，和手指方向一致。
 * 压缩比之外还钳在 ±max 内，理由见文件头。
 */
export function swipeFollow(track: SwipeTrack, max = SWIPE_FOLLOW_MAX): number {
  const raw = track.dx * SWIPE_FOLLOW_RATIO;
  return raw < 0 ? Math.max(-max, raw) : Math.min(max, raw);
}

/**
 * 松手时的判定：-1 上一曲、1 下一曲、0 不切。
 *
 * 方向上「左滑 = 下一曲」：手指往左推，拿走的是当前这张，
 * 下面顶上来的自然是下一首。这与列表内容左移表示前进是同一个直觉。
 */
export function swipeFires(
  track: SwipeTrack,
  threshold = SWIPE_THRESHOLD,
  slope = SWIPE_SLOPE,
): -1 | 0 | 1 {
  if (Math.abs(track.dx) < threshold) return 0;
  if (Math.abs(track.dx) < Math.abs(track.dy) * slope) return 0;
  return track.dx < 0 ? 1 : -1;
}
