/**
 * 雨滴：WebGL 版的「玻璃上滑落的水珠」。
 *
 * 为什么不用纯 CSS：
 *   AE 里那套效果（CC Mr. Mercury + 置换图）的核心是**折射**——
 *   透过一颗水珠看到的画面会被放大、边缘反转，珠子本身边缘暗、中心亮，
 *   滑过之处还会拖出一条竖直的变形痕。这些是逐像素的采样偏移，
 *   CSS 只能画一个半透明圆，看起来像贴纸。
 *
 * 做法：
 *   1. 把台面（版式 + 叠加元素）整块画进一张纹理，作为「背后的世界」。
 *   2. 每个水珠在片元着色器里算球面法线，按法线去偏采样那张纹理。
 *   3. 边缘按菲涅尔压暗、中心加一点高光，得到体积感。
 *   4. 拖尾是同一颗珠子在过去若干时刻的残影，纵向拉长、透明度递减。
 *
 * 参数来自用户在 AE 里的效果控件（CC Mr. Mercury 那一套）：
 *   Radius 600 / Velocity 0.1 / Longevity 5s / Gravity 0.1 /
 *   Blob Birth Size 0.20 / Blob Death Size 0.15 / 置换 水平5 垂直20。
 */
export type RainMode = 'slide' | 'streak' | 'both';

export type RainSetting = {
  on: boolean;
  mode: RainMode;
  /** 0-100。滑落层控制水珠数量，雨丝层控制密度。 */
  strength: number;
  /** 0-100。整个雨层的不透明度。 */
  opacity: number;
};

export const defaultRain: RainSetting = { on: false, mode: 'both', strength: 55, opacity: 70 };

export const rainModes: { id: RainMode; name: string; hint: string }[] = [
  { id: 'slide', name: '水珠', hint: '玻璃上挂着的水珠往下滑' },
  { id: 'streak', name: '雨丝', hint: '斜着扫过画面的细密雨丝' },
  { id: 'both', name: '两样都要', hint: '水珠 + 雨丝' },
];

const KEY = 'raven-rain';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 读存档。坏数据退回默认值——雨层开不开不该让放映页起不来。 */
export function readRain(raw: string | null): RainSetting {
  if (!raw) return { ...defaultRain };
  try {
    const parsed = JSON.parse(raw) as Partial<RainSetting>;
    if (!parsed || typeof parsed !== 'object') return { ...defaultRain };
    const mode = rainModes.some(item => item.id === parsed.mode) ? (parsed.mode as RainMode) : defaultRain.mode;
    return {
      on: parsed.on === true,
      mode,
      strength: typeof parsed.strength === 'number' ? clamp(parsed.strength, 0, 100) : defaultRain.strength,
      opacity: typeof parsed.opacity === 'number' ? clamp(parsed.opacity, 0, 100) : defaultRain.opacity,
    };
  } catch {
    return { ...defaultRain };
  }
}

export function writeRain(value: RainSetting) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // 存不进去顶多下次回到默认，不影响放映
  }
}

export { KEY as rainKey };

/**
 * 每颗水珠的初始状态。
 *
 * 用固定的伪随机（按序号算），不是 Math.random()——每次重渲染都重新随机的话，
 * 调一下强度滑块整片水珠就跳到别的位置，看着像刷新而不是「加了几颗」。
 */
export type Drop = {
  /** 归一化坐标 0-1。 */
  x: number;
  y: number;
  /** 半径，相对画面高度。 */
  radius: number;
  /** 下落速度，单位是「每秒多少屏高」。 */
  speed: number;
  /** 起始相位，错开出发时间，否则一片水珠同时起步像列队。 */
  phase: number;
  /** 寿命（秒）。AE 里 Longevity 5.0。 */
  life: number;
};

const MAX_DROPS = 120;

export function drops(count: number): Drop[] {
  const out: Drop[] = [];
  const total = clamp(count, 0, MAX_DROPS);
  for (let i = 0; i < total; i++) {
    // 四条互质的步长，让 x / y / 大小看起来没有规律
    const a = (i * 37) % 101;
    const b = (i * 61) % 97;
    const c = (i * 17) % 89;
    const d = (i * 43) % 83;
    out.push({
      x: 0.02 + (a / 101) * 0.96,
      y: (b / 97) * 1.2,
      // AE 的 Birth/Death Size 0.20 到 0.15 是「大珠慢慢缩小」，
      // 换到归一化坐标是 1.1% 到 2.6% 屏高
      radius: 0.011 + (c / 89) * 0.015,
      // AE Velocity 0.1 + Gravity 0.1，5 秒滑完约 40% 屏高，约 0.08/s
      speed: 0.055 + (d / 83) * 0.085,
      phase: (i % 17) / 17,
      life: 5 + (c / 89) * 4,
    });
  }
  return out;
}

export const dropBudget = MAX_DROPS;
