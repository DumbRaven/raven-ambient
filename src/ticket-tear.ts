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

/**
 * 掀开角度的上限（度）。
 *
 * 12 度是在 1040×498 的浮层上试出来的：绕接缝底端转，顶端横向让开
 * 498 × sin(12°) ≈ 103px，刚好是一道看得清的 V 形。再大就像整块牌子被掀翻，
 * 不像纸。
 *
 * **注意**：自从右半改成多段卷曲（见 CURL_* 常量）之后，这条只给
 * `prefers-reduced-motion` 的降级态用——那时不切开、不做 3D，退回整块绕底端转。
 */
export const TEAR_HINGE_DEG = 12;

/**
 * 折痕：从右下角掀起一块三角狗耳，翻过折痕压在纸上、露出纸背。
 *
 * 用户 m04030 的原话是「这个不应该是从右下角掀起来然后折叠着往上撕吗」，m04023
 * 补了一句「这是一个柔软的东西明白吗，这是一种折叠」。
 *
 * 为什么是狗耳而不是「一条横贯的折痕」：折痕横贯整块面板时，折起来的是
 * 面板的 60%，翻过去必然戳出票面之外；探针截图里那块纸整个飞出了票根。
 * 狗耳折的是右下角一个等腰直角三角形，翻过 180 度之后正好落在折痕另一侧，
 * 仍然在纸面之内。
 *
 * 之前两条路都不对，记在这里免得再走一遍：
 * - 整块绕轴转（铰链、skew、绕斜轴 rotate3d）：硬板味道，用户连着否了两次；
 * - 把右半切成 8 条横带各自转：相邻两条的边不再共线，接缝裂成阶梯（探针
 *   maxSeam 从 1.04 涨到 6.21）。
 *
 * 一个折痕、一次旋转就不可能裂——这也是用户 m04075 要的「简单办法」。
 */

/** 折满时的折叠角（度）。180 是纸对折贴平；留一点角度，翻起来那块还立着。 */
export const TEAR_FOLD_DEG = 176;

/**
 * 折满时那个角有多大：折痕吃掉的直角边长，占面板宽的比例。
 *
 * 0.42 是「看得出来是掀了一个角」与「不至于把半张票撕走」之间的取舍。
 * 拉到 1（等于整条下边缘）时折痕横到左边缘，翻起来的是面板下半部整整一半，
 * 读起来像票根缺了一块，而不是掀角。
 */
export const TEAR_FOLD_EDGE = 0.42;

/**
 * 右半面板的宽 / 高比。
 *
 * 面板宽占整票 28%（CSS `.ticket-lift-shot { flex: 0 0 72% }` 的剩下那块），
 * 票的高占宽的 47.85%（CSS `.ticket-lift { aspect-ratio: 100 / 47.85 }`），
 * 所以宽高比 = 0.28 / 0.4785 ≈ 0.585。这两个数在 CSS 里是写死的，改那边要同步这里。
 * 早先按 `(1 - SHOT_SHARE) * TICKET_ASPECT` 算是 0.568，和实际差 4%，
 * 折痕右端因此偏离旋转轴 7.6px（探针 hingeShift 测出来的）。
 */
export const TEAR_PANEL_RATIO = 0.28 / 0.4785;

/**
 * 折痕的形状：一个从右下角掀起的三角狗耳。
 *
 * 坐标都是 0~1 的比值，由 CSS 乘上面板尺寸。
 */
export type FoldShape = {
  /** 折痕已经吃掉多少（0~TEAR_FOLD_EDGE，按面板宽算）。0 = 什么都没折。 */
  edge: number;
  /** 折痕在下边缘的落点（x 比值）。1 = 就在右下角。 */
  x1: number;
  /** 折痕在右边缘的落点（y 比值）。1 = 就在右下角。 */
  y1: number;
  /** 绕折痕转的轴，平面内单位向量。 */
  ax: number;
  ay: number;
  /** 折叠角（度），0 = 平铺。 */
  deg: number;
};

/**
 * 算这条狗耳折痕该长什么样。
 *
 * `bend` 是**已经过成曲线的**形变进度（tearEase 的输出），不是手位移。
 *
 * 几何是一张纸被捏住右下角、沿一条 45° 的折痕翻起来：
 * 折痕从下边缘的 (x1, 1) 连到右边缘的 (1, y1)，两条直角边等长，
 * 于是被折的那块正好是等腰直角三角形。180 度翻过去之后它盖在折痕另一侧，
 * **仍然落在纸面之内**——这是狗耳与「整块翻」的根本区别：整块翻会飞出纸外。
 * 角的大小由 TEAR_FOLD_EDGE 封顶，不让它长到把半张票掀走。
 *
 * 轴恒为 45°（像素空间里 ax = -ay），不随进度变：折痕自己就是那条 45° 线，
 * 变的是它离右下角多远。这样旋转过程中折痕那条边一个像素都不动。
 */
export function foldShape(bend: number): FoldShape {
  const shape = Number.isFinite(bend) ? Math.max(0, Math.min(1, bend)) : 0;
  // 直角边长占面板宽的比例：0 → TEAR_FOLD_EDGE，折满时那个角掀到最大。
  const edge = TEAR_FOLD_EDGE * shape;
  // 折痕两端。右下角是 (1, 1)，沿两条边各退 edge 个「面板宽」。
  const x1 = 1 - edge;
  // 右边缘那端竖着退同样长的像素，所以要乘面板宽高比换算成比值。
  const y1 = 1 - edge * TEAR_PANEL_RATIO;
  // 轴就是 45° 那条线：两端在**像素**空间里横向与纵向走一样多
  // （(1-x1)·W = edge·W，(y1-1)·H = -edge·W，因为 H = W / TEAR_PANEL_RATIO）。
  // rotate3d 的轴是像素坐标系里的方向，所以这里直接写 1/√2，不看宽高比。
  const k = Math.SQRT1_2;
  return {
    edge,
    x1,
    y1,
    ax: k,
    ay: -k,
    deg: TEAR_FOLD_DEG * shape,
  };
}

/** 拖拽位移换算成 0~1 的撕开进度。 */
export function tearProgress(dy: number, panelHeight: number): number {
  if (!Number.isFinite(dy) || dy <= 0 || !Number.isFinite(panelHeight) || panelHeight <= 0) return 0;
  return Math.min(1, dy / panelHeight);
}

/**
 * 把匀速的撕开进度过成「前段绷住、后段加速」的曲线。
 *
 * 为什么不直接用 --pull：手匀速往上拖，纸是按同样的比例在动，读起来就是
 * 机械的匀速位移。真纸不是这样——一开始纤维还连着，几乎不动，越过
 * 临界点之后突然顺着撕线跑开。1.6 次幂恰好是这个味道：手拖到一半，形变
 * 只走三分之一；到断的那一刻才走满。
 *
 * 归一化到 TEAR_TRIGGER 而不是 1：撕到 42% 就断了，1 永远走不到。以 1 为
 * 分母的话，阈值那一刻形变只有 0.43^1.6 ≈ 0.26，掀开角不到 4 度，拖了一路
 * 看起来纹丝不动（实测 m02809 就是 3.16 度）。以「断开点」为 1，手到阈值
 * 才刚好把这一下撕满，中途的滞后感也还在。
 */
export function tearEase(progress: number, trigger = TEAR_TRIGGER): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  const reach = Number.isFinite(trigger) && trigger > 0 ? trigger : TEAR_TRIGGER;
  const t = Math.min(1, progress / reach);
  return t ** 1.6;
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
