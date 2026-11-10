// 票根的「撕」与「灰烬」——只算数，不碰 DOM。
//
// 单独抽出来是为了能测：拖多少算撕开、灰烬落在哪儿、飞行落点怎么算，
// 这些都不需要真的渲染一遍才知道对不对。
//
// 用户 m14144 定的交互：「点击，票根浮起放大，用户手撕划线部分，
// 右侧文字部分化为灰烬消失，左侧电影票飘进放映区域」。

/** 票根沿用参考图（ref-1.jpg）的比例：整张 1124×563，画面 69.2%、票根 30.6%。 */
export const TICKET_ASPECT = 1124 / 563;
export const SHOT_SHARE = 0.692;

/**
 * 拖多远算撕开。
 *
 * 0.42 是拿手感定的：票根本身只有整张票三成宽，往上拖到接近自身高度
 * 一半的时候，视觉上那条缝已经明显裂开了。再高就要求人拖得太多，
 * 再低会变成「轻轻一碰就没了」——那不如直接点击。
 */
export const TEAR_TRIGGER = 0.42;

/** 拖拽位移换算成 0~1 的撕开进度。 */
export function tearProgress(dy: number, panelHeight: number): number {
  if (!Number.isFinite(dy) || dy <= 0 || !Number.isFinite(panelHeight) || panelHeight <= 0) return 0;
  return Math.min(1, dy / panelHeight);
}

/** 松手时是否算撕开。 */
export function shouldTear(dy: number, panelHeight: number): boolean {
  return tearProgress(dy, panelHeight) >= TEAR_TRIGGER;
}

export type AshFlake = {
  /** 起点，相对票根宽高的 0~1。 */
  x: number;
  y: number;
  /** 飘散位移，相对票根宽高的比例。 */
  dx: number;
  dy: number;
  rot: number;
  /** 边长，px。 */
  size: number;
  /** 延迟，ms。 */
  delay: number;
};

/** 灰烬粒子的确定性散列：同一张票每次炸开都是同一片灰，不会闪。 */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * 把票根拆成一捧灰。
 *
 * 为什么不按行按列均匀撒：均匀撒出来像马赛克，不像烧完的纸。这里让
 * 位置带点串扰（相邻两片会挨着），越靠上的片飘得越高——纸是从下面
 * 先断的，上沿最后散。
 */
export function ashParticles(seed: string, count = 28): AshFlake[] {
  const flakes: AshFlake[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = hash(`${seed}#${i}`);
    const b = hash(`${seed}@${i}`);
    const c = hash(`${seed}!${i}`);
    // 纵向从顶到底铺开：i=0 贴顶（y≈0），i=count-1 贴底（y≈1）。
    const down = (i + 0.5) / count;
    flakes.push({
      x: 0.08 + ((a % 1000) / 1000) * 0.84,
      y: Math.min(0.98, Math.max(0.02, down + ((b % 100) / 100 - 0.5) * 0.08)),
      dx: ((c % 100) / 100 - 0.5) * 0.9,
      // 越靠下（down 越大）飘得越高、起飞越早：纸是先从下沿断的，顶边最后散。
      dy: -(0.25 + down * 0.85 + ((b % 100) / 100) * 0.35),
      rot: ((a % 360) + ((c % 50) / 50 - 0.5) * 90),
      size: 3 + (c % 5),
      delay: Math.round((1 - down) * 420 + ((b % 40) / 40) * 160),
    });
  }
  return flakes;
}

/** 把一块矩形从起点搬到终点要的 transform。用来把画面「飘」进放映台。 */
export function flightOf(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
): { dx: number; dy: number; scale: number } {
  const scale = from.w > 0 ? to.w / from.w : 1;
  return {
    dx: (to.x + to.w / 2) - (from.x + from.w / 2),
    dy: (to.y + to.h / 2) - (from.y + from.h / 2),
    scale,
  };
}
