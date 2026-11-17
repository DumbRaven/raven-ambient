/**
 * 放映台的三套版式。
 *
 * 学习自 DumbRaven 频道里的那套拼贴排版：整块画布铺底色，画面切成
 * 大圆角的块，旁边一块高饱和色板，底部一条浅色信息条，右下再挖一个
 * 圆形二次裁切。
 *
 * 关键的一点：那些颜色不是随便挑的，是**从画面里取的**。
 * 粉色花朵那张——底色是花的藕粉、面板是叶子的柠檬黄、信息条是天空的淡蓝；
 * 深色图书馆那张——底色是暗棕、面板是砖红。所以这套版式换一张图就是另一种气质，
 * 不会出现「版式和画面打架」。
 */

import { clamp } from './num.ts';

export type TemplateId = 'collage' | 'photo' | 'desktop';

export type Template = { id: TemplateId; name: string; hint: string };

export const templates: Template[] = [
  { id: 'collage', name: '拼贴', hint: '大圆角画面、色块信息栏、右下圆形裁切——你视频里那套' },
  // 原叫「照片」，因为那版是照着一张摄影集内页做的：手写体标题、曲目列、署名。
  // 用户 m12760 要的是另一件事——相册就该只有照片，所有字都交给用户自己加。
  { id: 'photo', name: '相集', hint: '整张铺满，不加任何字，组件自己往上加' },
  // 这一格原先站的是「画框」（画面缩成卡片、四边留底色、底部一行小字）。
  // 用户要的是另一件事：一个全透明的模式，桌面上的场景壁纸从窗口透上来，
  // 自己往上加组件。它不留底、不裁画面——底就是桌面本身。
  { id: 'desktop', name: '透明', hint: '不铺画面，桌面壁纸就是底，组件自己往上摆' },
];

export const templateIds = templates.map(template => template.id);

/** 按 id 找版式。存档里可能是旧版本删掉的 id，找不到就退回第一个而不是报错。 */
export function findTemplate(value: unknown): Template {
  return templates.find(template => template.id === value) ?? templates[0];
}

/** 文件名去掉扩展名、把下划线换成空格，当标题用。 */
export function templateTitle(name: string, fromWallpaper: boolean): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base || (fromWallpaper ? 'From the Wallpaper Library' : 'Untitled');
}

type Hsl = { h: number; s: number; l: number };

/** 十六进制 → HSL。格式不对时退回 `#9a8b78`（中性暖灰）而不是抛错：来源是画面取色，脏值是常态。 */
function toHsl(hex: string): Hsl {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#9a8b78';
  const r = Number.parseInt(clean.slice(1, 3), 16) / 255;
  const g = Number.parseInt(clean.slice(3, 5), 16) / 255;
  const b = Number.parseInt(clean.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/**
 * HSL → 十六进制。
 *
 * 饱和度为 0 时走灰阶分支：通用公式在 s=0 时会因为浮点误差吐出 RGB 不相等的结果，
 * 灰会带上一丝颜色——这正是 2026-11-16 那轮修的「灰阶被强行染色」的另一半。
 */
function toHex({ h, s, l }: Hsl): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  if (!sat) {
    const v = Math.round(lig * 255).toString(16).padStart(2, '0');
    return '#' + v + v + v;
  }
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const out = [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
  return '#' + out.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

/** 相对亮度，只用来判断「这块底上该用深字还是浅字」。 */
function luminance(hex: string): number {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#9a8b78';
  const channel = (i: number) => {
    const v = Number.parseInt(clean.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export type CollageTone = {
  /** 整块画布的底色。 */
  base: string;
  /** 右侧那块高饱和面板。 */
  panel: string;
  /** 底部信息条。 */
  bar: string;
  /** 压在底色上的字。 */
  ink: string;
  /** 压在面板上的字。 */
  onPanel: string;
  /** 压在信息条上的字。 */
  onBar: string;
  /** 金色：竖排 DUMBRAVEN 字母、四颗 ✦，以及右下角 Produced By 署名共用这一档。 */
  gold: string;
};

/**
 * 从画面的主色推出一整套拼贴配色。
 *
 * **核心规则：三个色块的色相相同，只差明度。** 这是照着你视频里的三张图量出来的——
 * 樱花那张底 `#deada4`、面板 `#ddce02`、信息条 `#b0cdff` 看着像三个色，
 * 但深蓝那张 `#1c2433`(l15%) → `#4a5363`(l34%) → `#72777d`(l47%) 三个色相全在 h213–219，
 * 橄榄绿那张 `#3d482b` → `#c4a456` → `#f2e9d0` 也全在 h43–83。
 * 也就是说这套版式的骨架是「同一个颜色，三层明度」，不是三个独立色。
 *
 * 所以取色只做两件事：
 *   1. 定一个主色相（画面里面积最大、又不是灰的那个）
 *   2. 沿这个色相排出「底最暗 → 面板中间 → 信息条最亮」三档
 * 饱和度做轻微差异（面板略浓一点，信息条略淡），但不再拉出完全不同的色相。
 *
 * hint 允许用户指定：
 *   hue   强制主色相（0–360），不传就按画面算
 *   sat   强制饱和度（0–1），不传就用画面里最艳那个色的饱和度
 *   base / panel / bar  直接指定某一档的底色，指定的那档原样用，其余照算
 *   onPanel / onBar     直接指定压在面板 / 信息条上的字色
 *   gold                竖排胶囊的四颗星、DUMBRAVEN 字母与右下角署名
 *
 * `sat` 是给「挑一个」模式补的。那个模式只传色相，饱和度仍然取画面里
 * 最艳的那个色（`lead.s`）——于是用户挑一块几乎是灰的色块，算出来的面板
 * 却顶着一整套高饱和。实测：`#ccd2cd`（h130 s0.062）配着画面里
 * `#e4b08e`（s0.614）的饱和度，面板算出 `#4dcb62` 亮绿，饱和 0.548。
 * 用户挑的是灰的，看到的是荧光绿——这就是「取色怎么这么多绿色」。
 */
export type ToneHint = {
  hue?: number;
  sat?: number;
  base?: string;
  panel?: string;
  bar?: string;
  onPanel?: string;
  onBar?: string;
  gold?: string;
};

/**
 * 从取到的色板算出一整套配色。这是整个视觉层最核心的一段，改动前请先读这一节。
 *
 * 分三层：底色（暗）、右侧面板（中）、信息条（亮）。三层的**明度阶梯是固定的**，
 * 不跟画面亮度走——实测三张参考图（樱花 / 深蓝 / 橄榄绿），亮图那张的底色也是暗的
 * （`#deada4` 的底只有 l0.76，而深蓝图的底是 l0.15，橄榄绿是 l0.23）。
 * 所以 `baseL` 固定 0.14，`pageLight` 只决定信息条要不要抬到 0.88。
 *
 * 饱和度分两种情况：有 `hint.sat`（用户在「挑一个」里挑了某个色块）就听它的，
 * 否则听 `lead`（色板里最艳的那个）。**这个区别不能省**——只听 lead 的话，
 * 用户挑一个几乎灰的绿会得到一片荧光绿面板（实测 s0.062 → s0.548）。
 *
 * 色相：`tinted`（s > 0.15）加权圆周平均，`coherence >= 0.35` 用平均角；
 * 否则退回 30° 分桶投票。`pool` 全是很灰的颜色时 `hue = 0`，不做无意义的染色。
 */
export function collageTone(colors: string[], hint: ToneHint = {}): CollageTone {
  // 取不到色（图还没解码、路径不通）时，退回一个中性灰而不是暖砂色。
  // 暖砂色会让整套版式看着像棕色的，和画面完全不像——灰至少诚实。
  const list = (colors.length ? colors : ['#6f6f6f']).slice(0, 6);
  const hsls = list.map(toHsl);

  // 主色相：把所有「有颜色」的色按饱和度平方加权，做圆周平均。
  //
  // 不能直接取第一个有色相的颜色——取色是按面积排的，画面里经常先冒出
  // 一小块暖色的石头或墙，结果整块版式被染成棕色，跟画面本来的绿对不上。
  // 也不能只取饱和度最高的那一个——单点色相容易被一个高光像素带偏。
  // 加权平均能让「画面整体是什么颜色」决定主色相。
  const tinted = hsls.filter(color => color.s > 0.15);
  const pool = tinted.length ? tinted : hsls;
  let hue: number;
  if (pool.every(color => color.s < 0.06)) {
    hue = 0; // 纯灰画面：不染，整套配色走灰阶
  } else {
    let x = 0;
    let y = 0;
    let total = 0;
    for (const color of pool) {
      // 灰色不投票，否则会把色相往「无意义」的方向拉
      if (color.s < 0.1) continue;
      const weight = color.s * color.s;
      const rad = (color.h * Math.PI) / 180;
      x += Math.cos(rad) * weight;
      y += Math.sin(rad) * weight;
      total += weight;
    }

    // 圆周平均只在几种颜色「大致同向」时才有意义。
    // 黄昏那种金→蓝的渐变，两边色相相差 160°，平均下来会落在中间的绿色上——
    // 画面里根本没有绿色，整套版式却染成了绿。
    // 所以先看这个平均向量有多长：接近 1 说明大家指向同一边，可以用；
    // 接近 0 说明互相抵消，这时退回「票数最多的那一边」。
    const coherence = total > 0 ? Math.hypot(x, y) / total : 0;
    if (coherence >= 0.35) {
      hue = (Math.atan2(y, x) * 180) / Math.PI;
      if (hue < 0) hue += 360;
    } else {
      // 按 30° 分桶投票，取权重最高的那个桶的中心。
      //
      // 门槛从 s>0.1 提到 0.22、权重从 s² 改成 s³：
      // 实测「蓝海 + 大片沙滩 + 黄昏天空」那张，沙滩面积大但接近中性，
      // 用 s² 投票会把整套版式染成土黄；蓝海饱和度更高，s³ 才让它站出来。
      // 人看这种画面的第一印象是海的颜色，配色应该跟这个走。
      const bins = new Map<number, number>();
      for (const color of pool) {
        if (color.s < 0.22) continue;
        const bin = Math.round(color.h / 30) % 12;
        bins.set(bin, (bins.get(bin) ?? 0) + color.s * color.s * color.s);
      }
      let best = 0;
      let bestWeight = -1;
      for (const [bin, weight] of bins) {
        if (weight > bestWeight) { bestWeight = weight; best = bin; }
      }
      hue = best * 30 + 15;
    }
  }
  const lead = pool.reduce((best, next) => (next.s > best.s ? next : best), pool[0]);
  if (typeof hint.hue === 'number' && Number.isFinite(hint.hue)) {
    hue = ((hint.hue % 360) + 360) % 360;
  }

  // 三层阶梯。**底色永远是暗的，不分亮图暗图。**
  //
  // 这里踩过一个很贵的坑：原来按「画面亮不亮」决定底色明度
  // （`pageLight ? 0.62 : 0.14`），理由是樱花/沙滩那种亮图底色看着浅。
  // 但把三张参考图的底色抓出来量，亮图那张（橄榄绿 `#3d482b`）是 l23%，
  // 比深蓝那张（`#1c2433` l15%）只亮一点点——**它仍然是暗的**。
  // 真正浅的是信息条（l85~88%），底色从头到尾都是画面里最深的那一层。
  //
  // 按画面亮度分叉的后果：橄榄绿那张算出来 base l62% / 实测 l23%，
  // 整套版式底色比面板还亮，三层阶梯 180 组输入里乱了 68 组。
  //
  // 现在的口径：底色固定压到暗端，面板走中间调，信息条走纸白。
  // 「画面亮不亮」只用来决定**信息条**要不要再抬一档（亮图给 0.88、暗图 0.47），
  // 因为暗图的信息条在参考图里也只到 l47%。
  const pageLight = lead.l > 0.62;

  // 饱和度的下限必须是 0，不能写成 0.10。
  // 见过的事故：灰阶封面（`#787878`）被染成 `#272020`，偏红。
  // clamp 的下限不是「至少有点颜色」，而是「灰色就是没有颜色」——
  // 纯灰画面在 `hue` 那段已经被判成 0（走灰阶），这里再补饱和度就自相矛盾。
  const baseL = 0.14;

  // 饱和度的来源：默认是画面里最艳那个色（自动模式的口径，别动），
  // 但「挑一个」会把自己的饱和度传进来（`hint.sat`）。
  //
  // 为什么要能覆盖：挑一个模式原先把色相和饱和度拆给了两个不同的来源——
  // 色相听用户挑的，饱和度仍听画面最艳的。挑一块 `#ccd2cd`（s0.062 的灰绿）
  // 会得到 `#4dcb62`（s0.548 的荧光绿），中间的差额全是别人的。
  const sat = typeof hint.sat === 'number' && Number.isFinite(hint.sat)
    ? clamp(hint.sat, 0, 1)
    : lead.s;

  const baseS = clamp(sat * 0.55, 0, 0.42);

  // 面板比底色亮一档。深蓝那张实测 l15% → l34%；橄榄绿 l23% → l55%。
  // 两个都是「底色 + 0.20 左右」，所以暗图沿用旧的 +0.20 是对的。
  // 亮图（橄榄绿那种）面板要更亮一点才压得住深底色，给 0.55。
  const panelL = pageLight ? 0.55 : clamp(baseL + 0.20, 0.13, 0.36);
  const panelS = clamp(sat * 0.9, 0, 0.55);

  // 信息条再亮一档，通常是「纸」的感觉。深蓝/橄榄绿都停在 l47~88%。
  const barL = pageLight ? 0.88 : 0.47;
  const barS = clamp(sat * 0.35, 0, 0.30);

  const base = hint.base || toHex({ h: hue, s: baseS, l: baseL });
  const panel = hint.panel || toHex({ h: hue, s: panelS, l: panelL });
  const bar = hint.bar || toHex({ h: hue, s: barS, l: barL });

  const dark = luminance(base) > 0.45;
  return {
    base,
    panel,
    bar,
    ink: dark ? '#151515' : '#f6f2ea',
    // 字色也允许用户接管。留空就走「按底色明度自动翻深浅」这条老路——
    // 面板和信息条的明度可能被用户改到很浅，自动翻面仍然要能跟上。
    //
    // 亮字用纯白而不是暖白 #f7f3ec：面板明度落在中间调时（l=0.55 那档，
    // 实测底色相对亮度约 0.177），暖白只有 4.18:1，差一点不够，纯白是 4.62。
    // 这一点点色温在这块小字上看不出差别，但少掉的那 0.44 对比度是实打实的。
    onPanel: hint.onPanel || (luminance(panel) > 0.42 ? '#151515' : '#ffffff'),
    onBar: hint.onBar || (luminance(bar) > 0.45 ? '#151515' : '#ffffff'),
    // 金色不跟画面取色走：它得在深色面板和浅色信息条上都读得出金，
    // 自动算出来的色相会随画面一路漂，飘到绿或粉就不像「金」了。
    // 默认取参考图实测的中位值。
    gold: hint.gold || '#d4a040',
  };
}
