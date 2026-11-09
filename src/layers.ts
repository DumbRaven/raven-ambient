/**
 * 图层：浮在画面上、位置由用户自己拖的那几块东西。
 *
 * 这里只有一个概念了。以前分成两套——拼贴/照片版式叫「叠加元素」（固定四件、
 * 每件一个开关），透明版式叫「组件」（可变长、能增删、能缩放）。用户 m12005
 * 问「加组件和叠加元素能完全一套吗」，答案是能：两套只差存档结构和图元表，
 * 行为完全一样。
 *
 * 合并后只有一条规则：**在列表里就是显示，不在就是没加**。
 * 以前那个 `on` 字段没有了——它和「在不在列表里」本来就是同一件事，
 * 两处各存一份只会对不上。代价是删掉之后重新加回来会回到默认位置，
 * 这个可以接受：位置是拖出来的，用户记得自己拖到哪，再拖一次不费事。
 *
 * 皮肤的差别不在数据里：拼贴/照片版式用 `.overlay-*` 那套小字，
 * 透明版式用 `.dw-*` 那套压在壁纸上的大字，由 `LayerStack` 按版式选。
 */

/** 六种图元。前四种四个版式都能用，唱片与曲目是透明模式才需要的。 */
export type LayerId = 'clock' | 'date' | 'title' | 'timer' | 'disc' | 'now';

/** 相对舞台的坐标，0–1。存比例而不是像素，换个窗口大小位置才不会跑。 */
export type LayerSpot = { x: number; y: number };

export type Layer = {
  id: LayerId;
  spot: LayerSpot;
  /** 缩放。目前只有透明版式的皮肤消费它，其余皮肤按 1 画。 */
  scale: number;
};

export type LayerList = Layer[];

export type LayerMeta = {
  id: LayerId;
  name: string;
  hint: string;
  /** 新加进来时落在哪。 */
  spot: LayerSpot;
};

/**
 * 默认位置分两套坐标。
 *
 * 横向 0.31 是给拼贴版式定的：画面块只占左边 62%，居中会有一半压到右侧色板上。
 * 反向 0.5 是给透明版式定的：那一版没有画面块，整块屏幕都是画布。
 * 所以 `spot` 只作为「刚刚点进来时」的落点，两个版式各自取用（见 defaultSpot）。
 */
export const layerMetas: LayerMeta[] = [
  { id: 'clock', name: '时间', hint: '当下的钟点，大号数字', spot: { x: 0.31, y: 0.22 } },
  { id: 'date', name: '日期', hint: '今天几号、星期几', spot: { x: 0.31, y: 0.34 } },
  { id: 'title', name: '标题', hint: '这一张的名字', spot: { x: 0.31, y: 0.44 } },
  { id: 'timer', name: '番茄钟', hint: '专注计时，跟着专注页走', spot: { x: 0.82, y: 0.16 } },
  { id: 'disc', name: '唱片', hint: '正在放的那张，会转', spot: { x: 0.84, y: 0.7 } },
  { id: 'now', name: '曲目', hint: '此刻在响的那一首', spot: { x: 0.5, y: 0.9 } },
];

export function findLayer(value: unknown): LayerMeta | undefined {
  return layerMetas.find(meta => meta.id === value);
}

/**
 * 默认那几块。
 *
 * 只放时间与标题：这是拼贴版式一直以来的样子（日期和番茄钟默认不带，
 * 用户要就自己去菜单里加）。透明版式下标题为空就不画，所以新用户切过去
 * 看到的是一块钟，正好。
 */
export const defaultLayers: LayerList = [
  { id: 'clock', spot: { x: 0.31, y: 0.22 }, scale: 1 },
  { id: 'title', spot: { x: 0.31, y: 0.44 }, scale: 1 },
];

export const layersKey = 'raven-layers';
/** 合并前的两份存档。只在第一次读的时候用来搬家，之后不再写。 */
export const legacyOverlaysKey = 'raven-overlays';
export const legacyWidgetsKey = 'raven-desktop-widgets';

/** 上限。菜单里有六项，留出重复摆放的余量，也挡住手滑一直加。 */
export const MAX_LAYERS = 12;
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2.4;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clampScale(value: number) {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

function spotOf(value: unknown, fallback: LayerSpot): LayerSpot {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<LayerSpot>;
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return fallback;
  return { x: clamp01(raw.x), y: clamp01(raw.y) };
}

function layerOf(value: unknown): Layer | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Layer>;
  const meta = findLayer(raw.id);
  if (!meta) return null;
  return {
    id: meta.id,
    spot: spotOf(raw.spot, meta.spot),
    scale: typeof raw.scale === 'number' ? clampScale(raw.scale) : 1,
  };
}

/** 同一件只留第一份：数组里出现两次会让 React 的 key 撞车，也让「删一块」变得含糊。 */
function dedupe(list: LayerList): LayerList {
  const seen = new Set<LayerId>();
  const out: LayerList = [];
  for (const layer of list) {
    if (seen.has(layer.id)) continue;
    seen.add(layer.id);
    out.push(layer);
    if (out.length >= MAX_LAYERS) break;
  }
  return out;
}

/**
 * 把合并前那两份存档搬过来。
 *
 * 叠加元素那份是 `Record<id, { on, spot }>`，`on` 为真才算数；
 * 组件那份已经是数组，直接接上。两边可能都有同一件（时间、标题、日期、番茄钟），
 * **以叠加元素那份为准**——它跟着用户更久，位置是他拖惯的那个。
 */
function fromLegacy(overlayRaw: string | null, widgetRaw: string | null): LayerList {
  const out: LayerList = [];

  if (overlayRaw) {
    try {
      const parsed = JSON.parse(overlayRaw) as Record<string, { on?: unknown; spot?: unknown }>;
      if (parsed && typeof parsed === 'object') {
        for (const meta of layerMetas) {
          const saved = parsed[meta.id];
          if (!saved || typeof saved !== 'object') continue;
          if (saved.on !== true) continue;
          out.push({ id: meta.id, spot: spotOf(saved.spot, meta.spot), scale: 1 });
        }
      }
    } catch {
      /* 旧存档坏了就当没有 */
    }
  }

  if (widgetRaw) {
    try {
      const parsed = JSON.parse(widgetRaw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const layer = layerOf(item);
          if (layer) out.push(layer);
        }
      }
    } catch {
      /* 同上 */
    }
  }

  return out;
}

/**
 * 读存档。三种来源，按优先级：新键 → 两份旧键搬家 → 默认值。
 *
 * 空数组是合法状态（用户把东西全删了，刷新不该又冒出来），所以「解析成功
 * 但一个都没有」与「压根没存过」必须区分开——前者原样返回空数组。
 */
export function readLayers(raw: string | null, overlayRaw: string | null = null, widgetRaw: string | null = null): LayerList {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const out: LayerList = [];
        for (const item of parsed) {
          const layer = layerOf(item);
          if (layer) out.push(layer);
        }
        return dedupe(out);
      }
    } catch {
      /* 坏 JSON 往下走，试试旧存档 */
    }
  }

  const migrated = dedupe(fromLegacy(overlayRaw, widgetRaw));
  if (migrated.length) return migrated;
  // 两份旧键都读过了、都是空的，说明这人没摆过东西，给默认那两块。
  // 全新用户走的是这一支。
  if (overlayRaw !== null || widgetRaw !== null) return [];
  return structuredClone(defaultLayers);
}

export function writeLayers(value: LayerList) {
  try {
    localStorage.setItem(layersKey, JSON.stringify(value));
  } catch {
    // 存不进去也不该打断放映：位置丢了顶多下次回到默认位置。
  }
}

export function addLayer(list: LayerList, id: LayerId, at?: LayerSpot): LayerList {
  const meta = findLayer(id);
  if (!meta) return list;
  if (list.length >= MAX_LAYERS) return list;
  if (list.some(layer => layer.id === id)) return list;
  return [...list, { id, spot: at ? spotOf(at, meta.spot) : { ...meta.spot }, scale: 1 }];
}

export function removeLayer(list: LayerList, id: LayerId): LayerList {
  return list.filter(layer => layer.id !== id);
}

export function moveLayer(list: LayerList, id: LayerId, spot: LayerSpot): LayerList {
  return list.map(layer => (layer.id === id ? { ...layer, spot: spotOf(spot, layer.spot) } : layer));
}

export function scaleLayer(list: LayerList, id: LayerId, scale: number): LayerList {
  return list.map(layer => (layer.id === id ? { ...layer, scale: clampScale(scale) } : layer));
}

export function canAddLayer(list: LayerList, id: LayerId): boolean {
  return list.length < MAX_LAYERS && !list.some(layer => layer.id === id);
}

/** 时钟：24 小时制，补零。 */
export function clockText(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 日期：和软件别处一个语感，`Oct.26 Monday`。 */
export function dateText(date: Date) {
  return `${months[date.getMonth()]}.${date.getDate()} ${weekdays[date.getDay()]}`;
}

/** 番茄钟读数：分:秒。 */
export function timerText(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export { MAX_LAYERS as layerLimit, SCALE_MAX as layerScaleMax, SCALE_MIN as layerScaleMin };
