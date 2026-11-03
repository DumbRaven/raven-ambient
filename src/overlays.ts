/**
 * 叠加元素：可以叠在画面上、位置能自己拖的那几块东西。
 *
 * 和版式（template）是两件事：版式决定画面怎么排，叠加元素浮在最上面。
 * 用户要的是「番茄钟/歌名/日期这些能自己摆位置」，所以每个元素都记一份
 * 相对坐标（0–1），拖到哪里存哪里。
 */
export type OverlayId = 'clock' | 'title' | 'date' | 'timer';

/** 相对舞台的坐标，0–1。存比例而不是像素，换个窗口大小位置才不会跑。 */
export type OverlaySpot = { x: number; y: number };

export type OverlaySetting = {
  on: boolean;
  spot: OverlaySpot;
};

export type Overlays = Record<OverlayId, OverlaySetting>;

export type OverlayMeta = {
  id: OverlayId;
  name: string;
  hint: string;
};

export const overlays: OverlayMeta[] = [
  { id: 'clock', name: '时间', hint: '当下的钟点，大号数字' },
  { id: 'title', name: '标题', hint: '这一张的名字' },
  { id: 'date', name: '日期', hint: '今天几号、星期几' },
  { id: 'timer', name: '番茄钟', hint: '专注计时，跟着专注页走' },
];

/**
 * 默认位置。
 *
 * 横向取 0.31 而不是 0.5：拼贴版式的画面块只占左边 62%，居中会有一半压到右侧色板上。
 * 0.31 正好是画面块的中心。照片版式下会显得偏左一点，但那是「整张铺满」的版式，
 * 偏左本身不难看；何况位置本来就是让用户自己拖的。
 *
 * 纵向落在 0.2–0.45：再往下就压到信息条上的字了。
 */
export const defaultOverlays: Overlays = {
  clock: { on: true, spot: { x: 0.31, y: 0.22 } },
  title: { on: true, spot: { x: 0.31, y: 0.44 } },
  date: { on: false, spot: { x: 0.31, y: 0.34 } },
  timer: { on: false, spot: { x: 0.82, y: 0.16 } },
};

const KEY = 'raven-overlays';

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function spotOf(value: unknown, fallback: OverlaySpot): OverlaySpot {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<OverlaySpot>;
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return fallback;
  return { x: clamp01(raw.x), y: clamp01(raw.y) };
}

/** 读存档。坏数据、缺字段、旧版本一律退回默认值，不让界面因为一份脏数据起不来。 */
export function readOverlays(raw: string | null): Overlays {
  if (!raw) return structuredClone(defaultOverlays);
  try {
    const parsed = JSON.parse(raw) as Partial<Record<OverlayId, Partial<OverlaySetting>>>;
    if (!parsed || typeof parsed !== 'object') return structuredClone(defaultOverlays);
    const out = structuredClone(defaultOverlays);
    for (const meta of overlays) {
      const saved = parsed[meta.id];
      if (!saved || typeof saved !== 'object') continue;
      out[meta.id] = {
        on: saved.on === true,
        spot: spotOf(saved.spot, defaultOverlays[meta.id].spot),
      };
    }
    return out;
  } catch {
    return structuredClone(defaultOverlays);
  }
}

export function writeOverlays(value: Overlays) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // 存不进去也不该打断放映：位置丢了顶多下次回到默认位置。
  }
}

export { KEY as overlaysKey };

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
