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

export type TemplateId = 'collage' | 'photo' | 'desktop';

export type Template = { id: TemplateId; name: string; hint: string };

export const templates: Template[] = [
  { id: 'collage', name: '拼贴', hint: '大圆角画面、色块信息栏、右下圆形裁切——你视频里那套' },
  { id: 'photo', name: '照片', hint: '整张铺满，手写体标题压在左上，曲目列在右侧' },
  // 这一格原先站的是「画框」（画面缩成卡片、四边留底色、底部一行小字）。
  // 用户要的是另一件事：一个全透明的模式，桌面上的场景壁纸从窗口透上来，
  // 自己往上加组件。它不留底、不裁画面——底就是桌面本身。
  { id: 'desktop', name: '透明', hint: '不留底，桌面壁纸直接透过来，组件自己往上加' },
];

export const templateIds = templates.map(template => template.id);

export function findTemplate(value: unknown): Template {
  return templates.find(template => template.id === value) ?? templates[0];
}

/** 文件名去掉扩展名、把下划线换成空格，当标题用。 */
export function templateTitle(name: string, fromWallpaper: boolean): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base || (fromWallpaper ? 'From the Wallpaper Library' : 'Untitled');
}

type Hsl = { h: number; s: number; l: number };

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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type CollageTone = {
  /** 整块画布的底色。 */
  base: string;
  /** 右侧那块高饱和面板。 */
  panel: string;
  /** 底部信息条。 */
  bar: string;
  /** 压在底色上的字。 */
  ink: string;
  /** 次要文字。 */
  inkSoft: string;
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
 */
/**
 * 从画面的主色推出一整套拼贴配色。
 *
 * 三条规则：
 *   底色 = 面积最大的那个色，压饱和、明度往舒适区拉（暗图压到 0.14，亮图提到 0.62）
 *   面板 = 饱和度最高的那个色，再提一档饱和 —— 拼贴里那块跳出来的颜色
 *   信息条 = 最亮的那个色，再提亮 —— 通常是画面里的天空、墙面、纸
 * 所以同一张图永远是同一套色，换图就换气质。
 *
 * hint 允许用户指定：
 *   hue   强制主色相（0–360），不传就按画面算
 *   base / panel / bar  直接指定某一档的底色，指定的那档原样用，其余照算
 *   onPanel / onBar     直接指定压在面板 / 信息条上的字色
 *   gold                竖排胶囊的四颗星、DUMBRAVEN 字母与右下角署名
 */
export type ToneHint = {
  hue?: number;
  base?: string;
  panel?: string;
  bar?: string;
  onPanel?: string;
  onBar?: string;
  gold?: string;
};

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

  // 底色的深浅跟着画面走：亮图（樱花、沙滩）底色用中明度，暗图（深蓝、夜色）用很暗的。
  // 但不管哪种，它都必须比面板暗、比信息条更暗——三层阶梯不能乱。
  const pageLight = lead.l > 0.62;
  const baseL = pageLight ? 0.62 : 0.14;
  const baseS = clamp(lead.s * 0.55, 0.10, 0.42);

  // 面板比底色亮一档。暗图里只亮一点点（图1 是 l11% → l13%），亮图里差得更大（图3 l23% → l55%）。
  // 面板永远走中间调。三张参考图的面板明度是 34% / 34% / 55%——
  // 亮图那张（樱花）的面板也不是浅色，而是同色系里更实的那一档。
  // 之前亮图给 0.80，整块面板变成浅绿，白字压上去几乎看不见。
  const panelL = pageLight ? 0.55 : clamp(baseL + 0.20, 0.13, 0.36);
  const panelS = clamp(lead.s * 0.9, 0.12, 0.55);

  // 信息条再亮一档，通常是「纸」的感觉。图2/图1 都停在 l47%，图3 到 l88%。
  const barL = pageLight ? 0.88 : 0.47;
  const barS = clamp(lead.s * 0.35, 0.05, 0.30);

  const base = hint.base || toHex({ h: hue, s: baseS, l: baseL });
  const panel = hint.panel || toHex({ h: hue, s: panelS, l: panelL });
  const bar = hint.bar || toHex({ h: hue, s: barS, l: barL });

  const dark = luminance(base) > 0.45;
  return {
    base,
    panel,
    bar,
    ink: dark ? '#151515' : '#f6f2ea',
    inkSoft: dark ? '#1515158f' : '#f6f2ea9e',
    // 字色也允许用户接管。留空就走「按底色明度自动翻深浅」这条老路——
    // 面板和信息条的明度可能被用户改到很浅，自动翻面仍然要能跟上。
    onPanel: hint.onPanel || (luminance(panel) > 0.42 ? '#151515' : '#f7f3ec'),
    onBar: hint.onBar || (luminance(bar) > 0.45 ? '#151515' : '#f7f3ec'),
    // 金色不跟画面取色走：它得在深色面板和浅色信息条上都读得出金，
    // 自动算出来的色相会随画面一路漂，飘到绿或粉就不像「金」了。
    // 默认取参考图实测的中位值。
    gold: hint.gold || '#d4a040',
  };
}
