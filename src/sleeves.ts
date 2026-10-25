/**
 * 唱片封套：没有上传封面的唱片，每次打开应用随机挑一款构图和一组色调。
 * 款式和色调都由「启动种子 + 唱片 id」算出，所以同一次使用里翻页、切分类、
 * 播放都不会让封面跳动；关掉重开才会换一批。
 */

export type SleeveMotif = 'dawn' | 'horizon' | 'arch' | 'orbit' | 'ripple' | 'tide';

export type SleeveStyle = { id: SleeveMotif; name: string };

export type SleeveTone = { from: string; to: string; ink: string };

export type SleeveArt = { motif: SleeveMotif; tone: SleeveTone };

export const sleeveStyles: SleeveStyle[] = [
  { id: 'dawn', name: '晨光' },
  { id: 'horizon', name: '地平线' },
  { id: 'arch', name: '拱门' },
  { id: 'orbit', name: '轨道' },
  { id: 'ripple', name: '涟漪' },
  { id: 'tide', name: '潮汐' },
];

/**
 * 参考图里那几块亮色：薄荷、柠檬、淡紫、珊瑚，再加同族的青、粉、米、蓝。
 * from 是卡片实际铺的颜色，to 只在旧皮肤下当渐变的收尾。
 */
export const sleeveTones: SleeveTone[] = [
  { from: '#a8e6c1', to: '#8ed4ae', ink: '#0d2418' },
  { from: '#d9eb6c', to: '#c8de52', ink: '#1e2408' },
  { from: '#c7c0f0', to: '#b3aae6', ink: '#1a1430' },
  { from: '#f7b7a8', to: '#f0a08d', ink: '#2e150f' },
  { from: '#a8dbe8', to: '#8ecad9', ink: '#0d2228' },
  { from: '#f0c8dc', to: '#e6b3cb', ink: '#2a1220' },
  { from: '#f0e3b0', to: '#e6d69a', ink: '#2a2410' },
  { from: '#b8cdf0', to: '#a2bbe6', ink: '#111c2e' },
];

/**
 * 每次启动应用生成一次。同一次使用里所有唱片都用它算款式，
 * 所以翻页、切分类、播放都不会让封面跳；关掉重开才换一批。
 */
export const launchSeed = `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

/** FNV-1a：把「种子 + 唱片 id」压成一个稳定整数。 */
export function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 给一张唱片挑封套款式和色调；同一张唱片在同一次启动里结果固定。 */
export function pickSleeve(recordId: string, seed: string): SleeveArt {
  const motif = sleeveStyles[hashText(`${seed}:${recordId}`) % sleeveStyles.length].id;
  const tone = sleeveTones[hashText(`tone:${seed}:${recordId}`) % sleeveTones.length];
  return { motif, tone };
}
