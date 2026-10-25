/**
 * 彩色胶盘：外圈从封面取色，内圈留给封面本身。
 *
 * 参考的是市面上几种真实压片工艺——透明胶上的颜料晕染、云石纹、
 * 放射状泼溅、单色透光。取色只做「取几个主色」这一件事，具体怎么铺
 * 由 CSS 决定，所以同一张封面在任何尺寸下都不会糊成一团。
 */

/** 压片工艺。每种对应 styles.css 里的一段 .pressing-* 规则。 */
export type PressingStyle = 'swirl' | 'marble' | 'splatter' | 'glow' | 'halo';

export type Pressing = { style: PressingStyle; name: string; angle: number };

export const pressings: Pressing[] = [
  { style: 'swirl', name: '晕染', angle: 24 },
  { style: 'marble', name: '云石', angle: 168 },
  { style: 'splatter', name: '泼溅', angle: 72 },
  { style: 'glow', name: '透光', angle: 300 },
  { style: 'halo', name: '光晕', angle: 132 },
];

export type VinylPalette = {
  /** 盘面底色：最深的那一档，胶盘的整体调子。 */
  base: string;
  /** 主色：颜料/纹理的主色块。 */
  accent: string;
  /** 第二主色：和主色错开的另一块。 */
  accent2: string;
  /** 纹路色：比底色亮一点点，用来画细密的沟槽。 */
  groove: string;
  /** 高光色：透明胶透出来的那层光。 */
  sheen: string;
  /** 底色偏浅时，盘面文字要换成深色。 */
  light: boolean;
};

const FALLBACK = '#9a8b78';

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function toRgb(hex: string): [number, number, number] {
  const text = hex.replace('#', '');
  const full = text.length === 3 ? text.split('').map(c => c + c).join('') : text;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(value)) return [154, 139, 120];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function toHex(rgb: [number, number, number]) {
  return '#' + rgb.map(n => clampByte(n).toString(16).padStart(2, '0')).join('');
}

/** 往黑里压，amount 越大越暗。 */
export function shade(hex: string, amount: number) {
  const [r, g, b] = toRgb(hex);
  const k = 1 - Math.max(0, Math.min(1, amount));
  return toHex([r * k, g * k, b * k]);
}

/** 往白里提。 */
export function tint(hex: string, amount: number) {
  const [r, g, b] = toRgb(hex);
  const k = Math.max(0, Math.min(1, amount));
  return toHex([r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k]);
}

/** 相对亮度，判断盘面要不要换深色字。 */
export function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map(n => {
    const v = n / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两个颜色在色相上的距离，用来挑「不像」的第二个主色。 */
function distance(a: string, b: string) {
  const [r1, g1, b1] = toRgb(a);
  const [r2, g2, b2] = toRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** RGB 转 HSV，色相换算时才不会把颜色抬成灰。 */
function toHsv(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map(n => n / 255) as [number, number, number];
  const high = Math.max(r, g, b), low = Math.min(r, g, b), span = high - low;
  let hue = 0;
  if (span > 0) {
    if (high === r) hue = ((g - b) / span + (g < b ? 6 : 0)) / 6;
    else if (high === g) hue = ((b - r) / span + 2) / 6;
    else hue = ((r - g) / span + 4) / 6;
  }
  return [hue, high === 0 ? 0 : span / high, high];
}

function fromHsv(hue: number, sat: number, value: number): string {
  const h = ((hue % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = value * (1 - sat), q = value * (1 - f * sat), t = value * (1 - (1 - f) * sat);
  const [r, g, b] = i % 6 === 0 ? [value, t, p]
    : i === 1 ? [q, value, p]
    : i === 2 ? [p, value, t]
    : i === 3 ? [p, q, value]
    : i === 4 ? [t, p, value]
    : [value, p, q];
  return toHex([r * 255, g * 255, b * 255]);
}

/** 胶盘至少要有这么亮，否则暗封面上看不出彩胶的层次。 */
const VINYL_MIN_VALUE = 0.42;
/** 色相低于这个值就当它是灰：灰有自己的处理，不能凭空染出颜色。 */
const GRAY_HUE = 0.08;
/** 有色相但太寡淡时补一点饱和，让工艺的纹理看得出来。 */
const VINYL_MIN_SAT = 0.28;

/**
 * 暗封面兜底，只在「抬完看得出彩胶」这个前提下动颜色：
 * - 够亮的颜色原样返回，多数封面完全不受影响；
 * - 暗但有色相的，色相一点不动，只抬明度（太寡淡时补一点饱和）；
 * - 暗且几乎没色相的灰，只抬明度，保持灰，不染色。
 */
export function liftForVinyl(hex: string): string {
  const [hue, sat, value] = toHsv(hex);
  if (value >= VINYL_MIN_VALUE) return hex;
  const gray = sat < GRAY_HUE;
  return fromHsv(hue, gray ? sat : Math.max(sat, VINYL_MIN_SAT), VINYL_MIN_VALUE);
}

/**
 * 把一张封面的颜色归纳成胶盘要用的六档。
 * 没有取到色（封面加载失败）时退回唱片自己的颜色，画面不会空掉。
 */
export function vinylPalette(colors: string[], fallback: string): VinylPalette {
  // 封面色先过一道兜底：太暗的抬高明度，够亮的原样不动
  const raw = colors.length ? colors : [fallback || FALLBACK];
  const source = raw.map(liftForVinyl);
  const primary = source[0] ?? FALLBACK;
  const secondary = source.find(color => distance(color, primary) > 60) ?? source[1] ?? tint(primary, 0.35);
  const deep = source.reduce((darkest, color) => (luminance(color) < luminance(darkest) ? color : darkest), primary);
  const bright = source.reduce((lightest, color) => (luminance(color) > luminance(lightest) ? color : lightest), primary);
  const base = shade(deep, 0.34);
  return {
    base,
    accent: primary,
    accent2: secondary,
    groove: tint(base, 0.16),
    sheen: tint(bright, 0.55),
    light: luminance(base) > 0.55,
  };
}

/** 同一张唱片在同一次启动里压片工艺固定，翻页、播放都不会换。 */
export function recordPressing(recordId: string, seed: string): Pressing {
  let hash = 2166136261;
  const text = `${seed}:pressing:${recordId}`;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const value = hash >>> 0;
  return pressings[value % pressings.length];
}

const cache = new Map<string, Promise<string[]>>();

/** 读一张封面，取回最多四个主色。结果按 src 缓存，翻页不会重复解码。 */
export function coverPalette(src: string): Promise<string[]> {
  const hit = cache.get(src);
  if (hit) return hit;
  const task = new Promise<string[]>(resolve => {
    if (typeof document === 'undefined') { resolve([]); return; }
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const size = 36;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) { resolve([]); return; }
        context.drawImage(image, 0, 0, size, size);
        const { data } = context.getImageData(0, 0, size, size);
        const buckets = new Map<string, { r: number; g: number; b: number; count: number; weight: number }>();
        for (let index = 0; index < data.length; index += 4) {
          const r = data[index], g = data[index + 1], b = data[index + 2], alpha = data[index + 3];
          if (alpha < 140) continue;
          const high = Math.max(r, g, b), low = Math.min(r, g, b);
          // 纯黑和纯白对胶盘没有信息量，跳过；留一点灰阶给云石纹。
          if (high < 22 || low > 240) continue;
          const key = `${r >> 5},${g >> 5},${b >> 5}`;
          const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, weight: 0 };
          bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
          bucket.weight += 1 + (high - low) / 96;
          buckets.set(key, bucket);
        }
        const ranked = [...buckets.values()]
          .sort((a, b) => b.weight * Math.sqrt(b.count) - a.weight * Math.sqrt(a.count))
          .map(bucket => toHex([bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count]));
        const picked: string[] = [];
        for (const color of ranked) {
          if (picked.length >= 4) break;
          if (picked.every(seen => distance(seen, color) > 34)) picked.push(color);
        }
        resolve(picked);
      } catch {
        resolve([]);
      }
    };
    image.onerror = () => resolve([]);
    image.src = src;
  });
  cache.set(src, task);
  return task;
}
