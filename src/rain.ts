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

import { clamp } from './num.ts';

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
  /** 起始相位，错开出发时间，否则一片水珠同时起步像列队。 */
  phase: number;
  /** 寿命（秒）。AE 里 Longevity 5.0。 */
  life: number;
  /**
   * 挂住，还是滑落。
   *
   * 真实的雨窗上大部分珠子是不动的：落在玻璃上就挂着，被表面张力拉住，
   * 只在自身重量下极缓慢地往下渗一点；只有攒够了、或者被别的珠子撞到的那几颗
   * 才会一路滑下去，并在身后拖一条水痕。全都往下滑会变成「往下掉的贴纸」。
   */
  kind: DropKind;
};

export type DropKind = 'hang' | 'slide';

export const MAX_DROPS = 200;

/**
 * 尺寸分布：一成是大珠，三成中等，六成细密水气。
 *
 * 数值单位是「画面高度的比例」，乘 100 才是 vh（1080 高时 ×21.6 = px）。
 *
 * 走过两版弯路：
 *   ① 0.0022~0.028（4.7~30px）：七成只有 4~11px，整屏像一层灰，读不出来；
 *   ② 0.006~0.052（13~112px）：能看见了，但一共才 66 颗，稀得像刚下雨，
 *      而且每颗都清清楚楚，反而像贴纸。
 *
 * 真实的雨窗是「大量很小的 + 少数很大的」：绝大多数珠子小到只能看出一个亮点，
 * 只有十来颗足够大，能看见背后的画面在里面被掰弯。所以这里把小档压到 0.003，
 * 靠**数量**给出密度感，靠少数大珠给出「水」的质感。
 */
function radiusOf(i: number, t: number): number {
  const tier = i % 10;
  // 六成：细密水气，5~9px。密度感全靠它们。
  if (tier < 6) return 0.0024 + t * 0.0018;
  // 三成：中珠，22~45px。能看出球面，滑落时最明显。
  if (tier < 9) return 0.0105 + t * 0.010;
  // 一成：大珠，45~95px。能看清背后画面被掰弯的只有它们。
  return 0.021 + t * 0.023;
}

export function drops(count: number): Drop[] {
  const out: Drop[] = [];
  const total = clamp(count, 0, MAX_DROPS);
  for (let i = 0; i < total; i++) {
    // 三条互质的步长，让 x / y / 大小看起来没有规律。
    // 不能共用一个：共用了 x 和大小会成比例，珠子从左上到右下整齐变大。
    const a = (i * 37) % 101;
    const b = (i * 61) % 97;
    const c = (i * 17) % 89;
    const t = c / 89;
    const radius = radiusOf(i, t);
    out.push({
      x: 0.02 + (a / 101) * 0.96,
      y: (b / 97) * 1.2,
      radius,
      phase: (i % 17) / 17,
      // 大珠滑得慢（表面张力大、本身重），小珠一沾就被吸走；寿命也一并拉开，
      // 否则每颗都在同一秒重生，整片同时闪一下。
      life: 5 + t * 4 + (1 - radius * 20) * 0.8,
      // 三分之一滑落。全滑会像下瀑布，全挂会像静止的贴图。
      kind: i % 3 === 0 ? 'slide' : 'hang',
    });
  }
  return out;
}
