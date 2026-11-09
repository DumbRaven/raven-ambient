/**
 * 透明模式的那套组件存档。
 *
 * 为什么单独一个文件、存 localStorage 而不进收藏库：摆哪儿、留哪几块是
 * 「桌面怎么摆」的偏好，和配色、雨层、叠加元素是同一类东西——它们都不该
 * 触发一次写盘，也不该跟着收藏库同步走。
 *
 * 位置用 0–1 的比例而不是像素：换一块 4K 屏不该把组件全挤到左上角。
 * 缩放是乘数而不是字号：同一块组件在 1080p 和 4K 下应该看起来一样大。
 */

export type WidgetId = 'clock' | 'date' | 'title' | 'timer' | 'disc' | 'now';

/** 组件在画面里的位置，按画面宽高的比例给（0–1）。 */
export type WidgetSpot = { x: number; y: number };

export type Widget = {
  id: WidgetId;
  spot: WidgetSpot;
  /** 字号/直径的乘数。1 是基准。 */
  scale: number;
};

export type WidgetList = Widget[];

export type WidgetMeta = {
  id: WidgetId;
  name: string;
  hint: string;
  /** 默认摆哪儿。挑的是不互相压住的位置。 */
  spot: WidgetSpot;
};

export const widgetMetas: WidgetMeta[] = [
  { id: 'clock', name: '时间', hint: '大号的时与分', spot: { x: 0.5, y: 0.36 } },
  { id: 'date', name: '日期', hint: '月日与星期', spot: { x: 0.5, y: 0.48 } },
  { id: 'title', name: '标题', hint: '写着这一页叫什么', spot: { x: 0.5, y: 0.82 } },
  { id: 'timer', name: '番茄钟', hint: '专注还剩多久', spot: { x: 0.5, y: 0.62 } },
  { id: 'disc', name: '唱片', hint: '正在听的那一张', spot: { x: 0.84, y: 0.7 } },
  { id: 'now', name: '曲目', hint: '此刻在响的那一首', spot: { x: 0.5, y: 0.9 } },
];

export function findWidget(value: unknown): WidgetMeta | undefined {
  return widgetMetas.find(meta => meta.id === value);
}

/** 一块都没加过时的默认：时间与日期。这两样是「桌面时钟」最基础的东西。 */
export const defaultWidgets: WidgetList = [
  // 两块都摆在正中：时钟在上、日期在下。
  { id: 'clock', spot: { x: 0.5, y: 0.42 }, scale: 1 },
  { id: 'date', spot: { x: 0.5, y: 0.53 }, scale: 1 },
];

export const widgetsKey = 'raven-desktop-widgets';

export const MAX_WIDGETS = 12;
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2.4;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function spotOf(raw: unknown, fallback: WidgetSpot): WidgetSpot {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const spot = raw as Partial<WidgetSpot>;
  return { x: clamp01(Number(spot.x)), y: clamp01(Number(spot.y)) };
}

function clampScale(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

export function readWidgets(raw: string | null): WidgetList {
  if (!raw) return structuredClone(defaultWidgets);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return structuredClone(defaultWidgets);
    const seen = new Set<WidgetId>();
    const out: WidgetList = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Partial<Widget>;
      const meta = findWidget(raw.id);
      if (!meta || seen.has(meta.id)) continue;
      seen.add(meta.id);
      out.push({ id: meta.id, spot: spotOf(raw.spot, meta.spot), scale: clampScale(raw.scale) });
      if (out.length >= MAX_WIDGETS) break;
    }
    // 空数组是合法状态（用户把组件全删了）。只有「一个都认不出」才退回默认，
    // 否则用户清空之后一刷新又冒出来，那像是没记住。
    return out;
  } catch {
    return structuredClone(defaultWidgets);
  }
}

export function writeWidgets(value: WidgetList) {
  try {
    localStorage.setItem(widgetsKey, JSON.stringify(value));
  } catch {
    // 存不进去只丢位置，不影响这一屏显示。
  }
}

/** 加一个组件。已经有了就不动——菜单里那一项该是灰的，不是加出两个钟。 */
export function addWidget(list: WidgetList, id: WidgetId, at?: WidgetSpot): WidgetList {
  if (list.length >= MAX_WIDGETS) return list;
  if (list.some(widget => widget.id === id)) return list;
  const meta = findWidget(id);
  if (!meta) return list;
  return [...list, { id, spot: at ? spotOf(at, meta.spot) : { ...meta.spot }, scale: 1 }];
}

export function removeWidget(list: WidgetList, id: WidgetId): WidgetList {
  return list.filter(widget => widget.id !== id);
}

export function moveWidget(list: WidgetList, id: WidgetId, spot: WidgetSpot): WidgetList {
  return list.map(widget => (widget.id === id ? { ...widget, spot: spotOf(spot, widget.spot) } : widget));
}

export function scaleWidget(list: WidgetList, id: WidgetId, scale: number): WidgetList {
  return list.map(widget => (widget.id === id ? { ...widget, scale: clampScale(scale) } : widget));
}

/** 这一屏能不能加：数量没满、且这个还没加。控制条那个「+」用它决定灰不灰。 */
export function canAddWidget(list: WidgetList, id: WidgetId): boolean {
  return list.length < MAX_WIDGETS && !list.some(widget => widget.id === id);
}

export { MAX_WIDGETS as widgetLimit, SCALE_MAX as widgetScaleMax, SCALE_MIN as widgetScaleMin };
