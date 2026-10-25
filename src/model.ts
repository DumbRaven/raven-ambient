import { depthRange, percentToDb } from './ducking.ts';

export type SoundKind = 'rain' | 'fire' | 'wind' | 'file';
export type Track = {
  id: string; name: string; detail: string; kind: SoundKind; volume: number; pan: number; warmth: number;
  /** 音乐响起时压低的量，分贝。0 表示这张不避让。 */
  duckDepth: number;
  /** 封面类型，用来决定淡入淡出等手感；没有就走通用值。 */
  coverId?: string;
  enabled: boolean;
};
export type Mix = { tracks: Track[]; master: number; musicVolume: number; ducking: boolean; lineVolume?: number };
export type Scene = { id: string; name: string; description: string; theme: string; mix: Mix };
export const defaultTracks: Track[] = [
  { id: 'rain', name: '窗外细雨', detail: '细密雨声 · 合成试听', kind: 'rain', volume: 55, pan: -12, warmth: 48, duckDepth: 9, coverId: 'rain', enabled: true },
  { id: 'fire', name: '壁炉余温', detail: '低声炉火 · 合成试听', kind: 'fire', volume: 38, pan: 12, warmth: 66, duckDepth: 9, coverId: 'fire', enabled: false },
  { id: 'wind', name: '林间晚风', detail: '舒缓风声 · 合成试听', kind: 'wind', volume: 25, pan: 0, warmth: 55, duckDepth: 9, coverId: 'wind', enabled: true },
];
export const defaultMix: Mix = { tracks: defaultTracks, master: 65, musicVolume: 65, ducking: true };
export const scenes: Scene[] = [
  { id: 'rainy', name: '雨夜书房', description: '一页书，一场温柔的雨。', theme: '#91b9a7', mix: defaultMix },
  { id: 'forest', name: '松林微风', description: '让思绪沿着风，走进森林。', theme: '#b1bd8a', mix: { ...defaultMix, tracks: defaultTracks.map(t => ({ ...t, enabled: t.id !== 'fire', volume: t.id === 'wind' ? 65 : 18 })) } },
  { id: 'fireplace', name: '暖炉独处', description: '给自己留一盏灯的时间。', theme: '#d4a67c', mix: { ...defaultMix, tracks: defaultTracks.map(t => ({ ...t, enabled: t.id !== 'wind', volume: t.id === 'fire' ? 65 : 20 })) } },
];
export const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
export function sanitizeMix(value: unknown): Mix {
  if (!value || typeof value !== 'object') return structuredClone(defaultMix);
  const v = value as Partial<Mix> & { duckAmount?: number; duckDepth?: number };
  const tracks = Array.isArray(v.tracks) ? v.tracks.filter(t => t && typeof t.id === 'string' && typeof t.name === 'string' && ['rain', 'fire', 'wind', 'file'].includes(t.kind)).slice(0, 12).map(t => {
    const legacy = t as typeof t & { duckAmount?: number };
    // 新字段优先；老数据只有百分比，读的时候换算一次，用户不会感觉到断层
    const rawDepth = typeof legacy.duckDepth === 'number' ? legacy.duckDepth
      : typeof legacy.duckAmount === 'number' ? percentToDb(legacy.duckAmount)
      : typeof v.duckDepth === 'number' ? v.duckDepth
      : defaultTracks.find(d => d.id === t.id)?.duckDepth ?? 9;
    return {
      id: t.id, name: t.name.slice(0, 60), detail: typeof t.detail === 'string' ? t.detail.slice(0, 80) : '本地音频', kind: t.kind,
      volume: clamp(t.volume), pan: clamp(t.pan, -100, 100), warmth: clamp(t.warmth),
      duckDepth: clamp(rawDepth, depthRange.min, depthRange.max),
      coverId: typeof t.coverId === 'string' ? t.coverId : undefined,
      enabled: t.enabled === true,
    };
  }) : structuredClone(defaultTracks);
  return { tracks, master: clamp(v.master ?? 65), musicVolume: clamp(v.musicVolume ?? 65), ducking: v.ducking !== false };
}
export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
