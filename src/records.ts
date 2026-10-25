import { clamp, type Mix } from './model.ts';
import { findAmbientCover, matchAmbientCover } from './ambient-covers.ts';
import { depthRange, percentToDb } from './ducking.ts';

export type RecordType = 'music' | 'ambient';
export type RecordItem = {
  id: string; assetId: string; name: string; artist: string; description: string;
  category: RecordType; duration: number; format: string; size: number;
  color: string; coverId?: string; coverPreset?: string; fingerprint: string; volume: number; pan: number; warmth: number;
  /** 音乐响起时压低的量，分贝。0 表示这张不避让。 */
  duckDepth: number;
};
/** 音乐的播放顺序：列表循环、单曲循环、随机播放。 */
export type PlayOrder = 'sequence' | 'repeat-one' | 'shuffle';
export const playOrders: PlayOrder[] = ['sequence', 'repeat-one', 'shuffle'];
export const orderNames: Record<PlayOrder, string> = { sequence: '列表循环', 'repeat-one': '单曲循环', shuffle: '随机播放' };
/** 播放顺序按固定顺序循环切换：列表 → 单曲 → 随机 → 列表。 */
export function nextOrder(order: PlayOrder): PlayOrder {
  return playOrders[(playOrders.indexOf(order) + 1) % playOrders.length];
}
/** 手动切歌时两首音乐之间的过渡方式。 */
export type TrackTransition = 'off' | 'crossfade' | 'fade';
export const trackTransitions: TrackTransition[] = ['off', 'crossfade', 'fade'];
export const transitionNames: Record<TrackTransition, string> = { off: '直接切换', crossfade: '交叉淡化', fade: '淡出后淡入' };
export const transitionHints: Record<TrackTransition, string> = {
  off: '上一首立刻停，下一首立刻响。',
  crossfade: '上一首还没淡完，下一首已经进来，中间不断声。',
  fade: '上一首先退到安静，下一首再慢慢进来。',
};
/** 过渡时长（秒），与唱片切换动画等长，换碟和换声是同一次呼吸。 */
export const transitionDuration = 1;
export type Cabinet = {
  version: 2; records: RecordItem[]; queue: string[]; ambience: string[];
  master: number; musicVolume: number; ducking: boolean;
  order: PlayOrder;
  transition: TrackTransition;
  /** 外部音乐模式：音乐交给别的播放器，本程序只留环境音。 */
  lineMode: boolean;
  /** 外部音乐的音量（0–100），单独一条，和本地音乐互不影响。 */
  lineVolume: number;
  /** 被单独按了暂停的环境音（记录 id）。不在这里面的照常流动。 */
  muted: string[];
  theme: string; imageName: string;
};
export const emptyCabinet: Cabinet = { version: 2, records: [], queue: [], ambience: [], master: 60, musicVolume: 70, ducking: true, order: 'sequence', transition: 'crossfade', lineMode: false, lineVolume: 100, muted: [], theme: '#9a8b78', imageName: '' };
export const recordColors = ['#879a91', '#aaa2b4', '#bd9b80', '#8c9caa', '#aaa481', '#b28e92'];

/** 默认避让 9 dB，约等于旧版 65% 的手感。 */
export const defaultDuckDepth = 9;

/**
 * 把旧的百分比换算成分贝，只用于读旧数据。
 * 旧版说「降低 65%」，意思是振幅乘 0.35，也就是 −9.1 dB。
 */
export function percentToDepth(percent: number): number {
  return percentToDb(percent);
}

export function sanitizeCabinet(value: unknown): Cabinet {
  if (!value || typeof value !== 'object') return structuredClone(emptyCabinet);
  const v = value as Partial<Cabinet> & { duckAmount?: number; duckDepth?: number };
  const seen = new Set<string>();
  // 旧数据里没有 duckDepth，只有 duckAmount 百分比，读的时候一起兼容
  const incoming = (Array.isArray(v.records) ? v.records : []) as (RecordItem & { duckAmount?: number })[];
  const records = incoming.filter(r => {
    if (!r || typeof r.id !== 'string' || !r.id || seen.has(r.id) || typeof r.assetId !== 'string' || !r.assetId || typeof r.name !== 'string' || !['music', 'ambient'].includes(r.category)) return false;
    seen.add(r.id); return true;
  }).map(r => ({
    ...r, name: r.name.slice(0, 100), artist: typeof r.artist === 'string' ? r.artist.slice(0, 100) : '本地收藏',
    description: typeof r.description === 'string' ? r.description.slice(0, 500) : '',
    duration: clamp(r.duration, 0, 86400), size: clamp(r.size, 0, 1e10), format: typeof r.format === 'string' ? r.format.slice(0, 12) : 'AUDIO',
    fingerprint: typeof r.fingerprint === 'string' ? r.fingerprint : r.id,
    color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : recordColors[0],
    coverId: typeof r.coverId === 'string' ? r.coverId : undefined,
    coverPreset: r.category === 'ambient' ? (findAmbientCover(r.coverPreset)?.id ?? (!r.coverId ? matchAmbientCover(r.name)?.id : undefined)) : undefined,
    // 导入时已经做过响度归一化（见 loudness.ts），素材之间不再差十几个 dB，
    // 所以 100% 就够用了，不需要再把上限放到 200。
    volume: clamp(r.volume ?? 60, 0, 100),
    pan: clamp(r.pan ?? 0, -100, 100), warmth: clamp(r.warmth ?? 0),
    // 新字段优先；旧数据里只有百分比，换算一次即可，用户不会感觉到断层
    duckDepth: clamp(
      typeof r.duckDepth === 'number' ? r.duckDepth : percentToDepth(r.duckAmount ?? v.duckAmount ?? 65),
      depthRange.min, depthRange.max,
    ),
  }));
  const ids = (list: unknown, type: RecordType) => [...new Set(Array.isArray(list) ? list : [])].filter((id): id is string => typeof id === 'string' && records.some(r => r.id === id && r.category === type));
  return { version: 2, records, queue: ids(v.queue, 'music'), ambience: ids(v.ambience, 'ambient').slice(0, 8),
    master: clamp(v.master ?? 60), musicVolume: clamp(v.musicVolume ?? 70), ducking: v.ducking !== false,
    order: playOrders.includes(v.order as PlayOrder) ? (v.order as PlayOrder) : 'sequence',
    transition: trackTransitions.includes(v.transition as TrackTransition) ? (v.transition as TrackTransition) : emptyCabinet.transition,
    lineMode: v.lineMode === true,
    lineVolume: clamp(v.lineVolume ?? 100),
    muted: Array.isArray(v.muted) ? v.muted.filter((id): id is string => typeof id === 'string').slice(0, 8) : [],
    theme: /^#[0-9a-f]{6}$/i.test(v.theme ?? '') ? v.theme! : emptyCabinet.theme,
    imageName: typeof v.imageName === 'string' ? v.imageName : '' };
}
export function toggleRecord(cabinet: Cabinet, id: string): Cabinet {
  const record = cabinet.records.find(r => r.id === id);
  if (!record) return cabinet;
  const key = record.category === 'music' ? 'queue' : 'ambience';
  const list = cabinet[key];
  if (key === 'ambience' && !list.includes(id) && list.length >= 8) throw new Error('最多同时叠加 8 张环境音唱片。');
  return { ...cabinet, [key]: list.includes(id) ? list.filter(item => item !== id) : [...list, id] };
}
export function removeRecord(cabinet: Cabinet, id: string): Cabinet {
  return { ...cabinet, records: cabinet.records.filter(r => r.id !== id), queue: cabinet.queue.filter(item => item !== id), ambience: cabinet.ambience.filter(item => item !== id) };
}
export function nextInQueue(queue: string[], current?: string): string | undefined {
  if (!queue.length) return undefined;
  const index = current ? queue.indexOf(current) : -1;
  return queue[(index + 1) % queue.length];
}
/**
 * 按当前播放顺序取下一首。
 * manual 表示用户主动点「下一首」——单曲循环下手动切歌仍然换一首，只有自然放完才重播。
 */
export function nextInOrder(queue: string[], current: string | undefined, order: PlayOrder, random: () => number = Math.random, manual = false): string | undefined {
  if (!queue.length) return undefined;
  if (order === 'repeat-one' && !manual) return current && queue.includes(current) ? current : queue[0];
  if (order === 'shuffle') return shufflePick(queue, current, random);
  return nextInQueue(queue, current);
}
export function previousInOrder(queue: string[], current: string | undefined, order: PlayOrder, random: () => number = Math.random): string | undefined {
  if (!queue.length) return undefined;
  if (order === 'shuffle') return shufflePick(queue, current, random);
  const index = Math.max(0, current ? queue.indexOf(current) : 0);
  return queue[(index - 1 + queue.length) % queue.length];
}
/** 把列表里的一项挪到新位置，返回新数组；位置越界时原样返回。 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
/** 随机挑一首，尽量不重复当前这首；只有一首时就是它自己。 */
function shufflePick(queue: string[], current: string | undefined, random: () => number): string {
  if (queue.length === 1) return queue[0];
  const pool = current ? queue.filter(id => id !== current) : queue;
  const at = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[at] ?? queue[0];
}
export function cabinetMix(cabinet: Cabinet): Mix {
  return {
    master: cabinet.master, musicVolume: cabinet.musicVolume, ducking: true,
    // 外部音乐有自己的音量：用户要能把它调小，才听得清环境音是不是在避让。
    lineVolume: cabinet.lineVolume,
    tracks: cabinet.records.filter(r => r.category === 'ambient' && cabinet.ambience.includes(r.id)).map(r => ({
      id: r.assetId, name: r.name, detail: r.description, kind: 'file', volume: r.volume, pan: r.pan, warmth: r.warmth,
      duckDepth: r.duckDepth, coverId: r.coverPreset, enabled: !cabinet.muted.includes(r.id),
    })),
  };
}
export type CabinetFilter = 'selected' | RecordType;
export function cabinetRecords(cabinet: Cabinet, filter: CabinetFilter, query = ''): RecordItem[] {
  // 外部音乐模式下音乐交给别的播放器，唱片柜里只剩环境音。
  // 这里只做显示层过滤，queue 原样保存，切回正常模式时音乐选择还在。
  const records = filter === 'selected'
    ? [...cabinet.queue, ...cabinet.ambience].map(id => cabinet.records.find(r => r.id === id)).filter((r): r is RecordItem => !!r)
    : cabinet.records.filter(r => r.category === filter);
  return records
    .filter(r => !cabinet.lineMode || r.category === 'ambient')
    .filter(r => `${r.name} ${r.artist}`.toLowerCase().includes(query.trim().toLowerCase()));
}
export function isAudioFile(file: { name: string; type: string }) { return file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|opus|aiff|aif|webm)$/i.test(file.name); }
export const fingerprint = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

/** 唱片柜每页最多摆 6 张（2 列 × 3 行），超出部分翻页。 */
export const PAGE_SIZE = 6;

/** 页码收敛到有效范围，空列表也返回 0，避免删除唱片后停在空白页。 */
export function clampPage(page: number, total: number, size = PAGE_SIZE): number {
  const pages = Math.max(1, Math.ceil(total / size));
  if (!Number.isFinite(page)) return 0;
  return Math.min(pages - 1, Math.max(0, Math.trunc(page)));
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function paginate<T>(items: T[], page: number, size = PAGE_SIZE): T[] {
  const at = clampPage(page, items.length, size);
  return items.slice(at * size, at * size + size);
}
