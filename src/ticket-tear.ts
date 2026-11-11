// 票根的「撕」与「灰烬」——只算数，不碰 DOM。
//
// 单独抽出来是为了能测：拖多少算撕开、灰烬落在哪儿、飞行落点怎么算，
// 这些都不需要真的渲染一遍才知道对不对。
//
// 用户 m14144 定的交互：「点击，票根浮起放大，用户手撕划线部分，
// 右侧文字部分化为灰烬消失，左侧电影票飘进放映区域」。

/**
 * 画面占整张票的宽度比例。
 *
 * 0.709 是从 ref-1 上量出来的：整票横跨 x 87..1185（1098px），画面到撕线
 * 是 x 866（779px）。早先记的 0.692 是照另一张图量的，偏窄了 1.7 个点。
 */
export const SHOT_SHARE = 0.709;

/**
 * 票根的比例。
 *
 * 参考图那张整票是 1098×562 ≈ 1.95:1，画面块本身 779×562 ≈ 1.39:1。
 * （562 是逐像素量出来的：x=300 列票顶 y=1029、票底 y=1591；早先记的 526
 * 量在了尾部圆角里侧，把票量薄了一圈。）
 *
 * 用户 m14515：「至少应该按 16：9 把画面展示全了」——16:9 的素材放进
 * 1.39:1 的框里靠 contain 完整显示，上下留一条纸色边（像裱在相册页上），
 * 不裁画面。所以 CSS 里 `.ticket` 的 `aspect-ratio` 取 1098 / 562。
 *
 * 这两个数只是给测试与文档一个参照，布局不读它们——否则改画面比例要同步改三处。
 */
export const TICKET_ASPECT = 1098 / 562;

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

/**
 * 把一块矩形从起点搬到终点要的 transform。用来把画面「飘」进放映台。
 *
 * **用左上角差，不是中心点差**。CSS 那边是 `transform-origin: 0 0` +
 * `translate(...) scale(...)`，缩放绕左上角做，所以左上角只受 translate 影响：
 * `落点左上 = 起点左上 + (dx, dy)`。第一版写的中心点差，缩放一乘就把
 * 偏移放大了——实测拼贴的落点偏左 137px（用户 m14515 第 2 条报的「位置是错的」）。
 */
export function flightOf(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
): { dx: number; dy: number; scale: number } {
  const scale = from.w > 0 ? to.w / from.w : 1;
  return {
    dx: to.x - from.x,
    dy: to.y - from.y,
    scale,
  };
}

export type FlightRect = { x: number; y: number; w: number; h: number };

/**
 * 每种版式里，「画面」落在哪个块上。
 *
 * 用户 m14515 报的 bug 就是这里没有分模式：原来三种版式一律飞向
 * `.theater-screen`（那块黑底），但拼贴的画面其实只占它左上 63%×65%，
 * 于是非全屏时画面会飞偏、还飞大了。相集是整块铺满，透明版式压根没有画面——
 * 那时退回 `.theater-screen` 当落点是唯一说得通的。
 *
 * 顺序有意义：先匹配到的就是落点。
 */
export const FLIGHT_SELECTORS: Readonly<Record<string, readonly string[]>> = {
  collage: ['.tpl-block-media'],
  photo: ['.tpl-photo-media'],
  desktop: ['.theater-screen'],
};

/** 不知道版式时按相集处理：整个屏幕也是合理的落点。 */
export function flightSelectors(template: string): readonly string[] {
  return FLIGHT_SELECTORS[template] ?? ['.theater-screen'];
}

/** 两块矩形有交集时取交集，没有交集就退回外框——飞到一个不存在的缝里没有意义。 */
export function clipRect(rect: FlightRect, bounds: FlightRect): FlightRect {
  const x = Math.max(rect.x, bounds.x);
  const y = Math.max(rect.y, bounds.y);
  const right = Math.min(rect.x + rect.w, bounds.x + bounds.w);
  const bottom = Math.min(rect.y + rect.h, bounds.y + bounds.h);
  if (right <= x || bottom <= y) return bounds;
  return { x, y, w: right - x, h: bottom - y };
}

/** 从一串候选里挑第一个真正有面积的，并夹进屏幕边界。都没有就退回屏幕本身。 */
export function pickFlightRect(
  candidates: readonly (FlightRect | null | undefined)[],
  bounds: FlightRect,
): FlightRect {
  for (const rect of candidates) {
    if (!rect || rect.w <= 0 || rect.h <= 0) continue;
    return clipRect(rect, bounds);
  }
  return bounds;
}
