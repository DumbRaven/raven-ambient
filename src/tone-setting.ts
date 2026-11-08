/**
 * 放映版式的配色设置。
 *
 * 默认跟着画面自动取色。但有两种情况需要用户插手：
 *   - 画面太灰，取出来一整套都是灰的，不好看；
 *   - 用户想指定一个主题色（比如这期视频的品牌色）。
 * 所以留三层：自动 / 从画面主色里挑一个 / 完全手填。
 *
 * 手填分成**三组**，对应拼贴版里三块会放字的地方（配色面板就是按这三组排的）：
 *   信息条     —— 底色 bar + 文字 onBar
 *   面板       —— 底色 panel + 文字 onPanel
 *   胶囊·署名  —— 金色 gold（竖排 DUMBRAVEN 字母、四颗 ✦、右下角 Produced By）
 * 画布底色 base 是垫在最底下的一层，跟着信息条那一组露出来，
 * 不单独给它一组——不然用户得点开第三个分组才知道那是什么。
 *
 * 存 localStorage，和版式、叠加元素一样属于「看片偏好」，不进收藏库。
 */
/* 扩展名要写出来：这个文件被 tests/tone-setting.test.ts 直接用 node 跑，
   而 node 的 TS 加载器不像打包器那样帮你补 .ts。 */
import { findStoneStyle, type StoneStyle } from './marble.ts';

export type ToneMode = 'auto' | 'pick' | 'custom';

/** 手填的那几档。留空表示这一档仍然吃自动算出来的值。 */
export type ToneCustom = {
  base: string;
  panel: string;
  onPanel: string;
  bar: string;
  onBar: string;
  gold: string;
};

export type ToneSetting = {
  mode: ToneMode;
  /** pick 模式下：画面取出的第几个主色当主色（0–3）。 */
  pick: number;
  custom: ToneCustom;
  /**
   * 竖排胶囊表面的石纹。跟配色放在同一个设置里，因为它们回答的是同一个问题：
   * 「这一页看上去该是什么样」。分两处存会让「恢复默认」只恢复一半。
   */
  stone: StoneStyle;
};

export const toneKey = 'raven-stage-tone';

export const defaultTone: ToneSetting = {
  mode: 'auto',
  pick: 1,
  custom: { base: '', panel: '', onPanel: '', bar: '', onBar: '', gold: '' },
  stone: 'sea',
};

/**
 * 配色面板上的分组。UI 直接遍历它，别在 JSX 里再手写一遍——
 * 以后加一档颜色只改这里，输入框、重置按钮会一起跟上。
 */
export const toneGroups = [
  { key: 'bar', title: '信息条', fields: [['bar', '底色'], ['onBar', '文字']] },
  { key: 'panel', title: '面板', fields: [['panel', '底色'], ['onPanel', '文字']] },
  { key: 'gold', title: '胶囊 · 署名', fields: [['gold', '金色']] },
] as const satisfies ReadonlyArray<{
  key: string;
  title: string;
  fields: ReadonlyArray<readonly [keyof ToneCustom, string]>;
}>;

const HEX = /^#[0-9a-f]{6}$/i;

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** 把用户输入的任意写法收敛成 #rrggbb；认不出来返回空串。 */
export function normaliseHex(raw: string): string {
  const text = raw.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(text)) return '#' + text.toLowerCase();
  if (/^[0-9a-f]{3}$/i.test(text)) return '#' + text.split('').map(c => c + c).join('').toLowerCase();
  return '';
}

/** 把一档读成合法色值或空串。手填的六个字段全走这一条。 */
const readField = (value: unknown) => (isHex(value) ? value.toLowerCase() : '');

export function readTone(raw: string | null): ToneSetting {
  if (!raw) return defaultTone;
  try {
    const value = JSON.parse(raw) as Partial<ToneSetting>;
    const mode: ToneMode = value.mode === 'pick' || value.mode === 'custom' ? value.mode : 'auto';
    const pick = typeof value.pick === 'number' && value.pick >= 0 && value.pick <= 3 ? Math.round(value.pick) : 1;
    const custom = (value.custom ?? {}) as Partial<ToneCustom>;
    return {
      mode,
      pick,
      custom: {
        base: readField(custom.base),
        panel: readField(custom.panel),
        onPanel: readField(custom.onPanel),
        bar: readField(custom.bar),
        onBar: readField(custom.onBar),
        gold: readField(custom.gold),
      },
      // 老数据里没有这个字段，或者被改成了别的字符串，都收敛回默认。
      stone: findStoneStyle(value.stone),
    };
  } catch {
    return defaultTone;
  }
}

export function writeTone(value: ToneSetting) {
  try { localStorage.setItem(toneKey, JSON.stringify(value)); } catch { /* 存不下就算了 */ }
}

export type ToneHintOut = {
  hue?: number;
  base?: string;
  panel?: string;
  bar?: string;
  onPanel?: string;
  onBar?: string;
  gold?: string;
};

/** 把设置翻成 collageTone 的 hint。取不到色时返回空对象（退回自动）。 */
export function toneHint(setting: ToneSetting, colors: string[]): ToneHintOut {
  if (setting.mode === 'custom') {
    const { custom } = setting;
    return {
      base: isHex(custom.base) ? custom.base : undefined,
      panel: isHex(custom.panel) ? custom.panel : undefined,
      onPanel: isHex(custom.onPanel) ? custom.onPanel : undefined,
      bar: isHex(custom.bar) ? custom.bar : undefined,
      onBar: isHex(custom.onBar) ? custom.onBar : undefined,
      gold: isHex(custom.gold) ? custom.gold : undefined,
    };
  }
  if (setting.mode === 'pick') {
    // 用画面里挑出来的那个色当主色相，三档明度还是自动排。
    const picked = colors[setting.pick] ?? colors[0];
    if (!picked) return {};
    const rgb = Number.parseInt(picked.slice(1), 16);
    const r = ((rgb >> 16) & 255) / 255;
    const g = ((rgb >> 8) & 255) / 255;
    const b = (rgb & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (!d) return {};
    let h: number;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { hue: h * 360 };
  }
  return {};
}
