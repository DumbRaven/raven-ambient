import { depthRange, percentToDb } from './ducking.ts';

export type SoundKind = 'file';
export type Track = {
  id: string; name: string; detail: string; kind: SoundKind; volume: number; pan: number; warmth: number;
  /** 音乐响起时压低的量，分贝。0 表示这张不避让。 */
  duckDepth: number;
  /** 封面类型，用来决定淡入淡出等手感；没有就走通用值。 */
  coverId?: string;
  enabled: boolean;
};
export type Mix = { tracks: Track[]; master: number; musicVolume: number; ducking: boolean; lineVolume?: number };
/**
 * 混音基准值。产品里唯一的生产来源是 `records.ts` 的 `cabinetMix(cabinet)`；
 * 这份只被测试当作 fixture（验混音平衡、避让曲线、限幅）。
 *
 * 早先这里还有 rain/fire/wind 三种内置合成音，`audio.ts` 里也留着对应的
 * `synthesize()`。那条链已经断了：`cabinetMix` 把每一路的 kind 都写死成
 * `'file'`，合成音分支运行时永远走不到。2026-11-15 删掉了三段合成音和
 * 三个场景预设（雨夜书房 / 松林微风 / 暖炉独处）——那套「内置白噪音 + 场景」
 * 的设计早就被「用户自己导入环境音唱片」取代了。
 */
export const defaultTracks: Track[] = [
  { id: 'rain', name: '窗外细雨', detail: '细密雨声 · 合成试听', kind: 'file', volume: 55, pan: -12, warmth: 48, duckDepth: 9, coverId: 'rain', enabled: true },
  { id: 'fire', name: '壁炉余温', detail: '低声炉火 · 合成试听', kind: 'file', volume: 38, pan: 12, warmth: 66, duckDepth: 9, coverId: 'fire', enabled: false },
  { id: 'wind', name: '林间晚风', detail: '舒缓风声 · 合成试听', kind: 'file', volume: 25, pan: 0, warmth: 55, duckDepth: 9, coverId: 'wind', enabled: true },
];
export const defaultMix: Mix = { tracks: defaultTracks, master: 65, musicVolume: 65, ducking: true };
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
