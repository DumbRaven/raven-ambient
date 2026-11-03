/**
 * 放映版式的配色设置。
 *
 * 默认跟着画面自动取色。但有两种情况需要用户插手：
 *   - 画面太灰，取出来一整套都是灰的，不好看；
 *   - 用户想指定一个主题色（比如这期视频的品牌色）。
 * 所以留三层：自动 / 从画面主色里挑一个 / 完全手填。
 *
 * 存 localStorage，和版式、叠加元素一样属于「看片偏好」，不进收藏库。
 */
export type ToneMode = 'auto' | 'pick' | 'custom';

export type ToneSetting = {
  mode: ToneMode;
  /** pick 模式下：画面取出的第几个主色当主色（0–3）。 */
  pick: number;
  /** custom 模式下：三档颜色。留空表示这一档仍然用自动值。 */
  custom: { base: string; panel: string; bar: string };
};

export const toneKey = 'raven-stage-tone';

export const defaultTone: ToneSetting = {
  mode: 'auto',
  pick: 1,
  custom: { base: '', panel: '', bar: '' },
};

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

export function readTone(raw: string | null): ToneSetting {
  if (!raw) return defaultTone;
  try {
    const value = JSON.parse(raw) as Partial<ToneSetting>;
    const mode: ToneMode = value.mode === 'pick' || value.mode === 'custom' ? value.mode : 'auto';
    const pick = typeof value.pick === 'number' && value.pick >= 0 && value.pick <= 3 ? Math.round(value.pick) : 1;
    return {
      mode,
      pick,
      custom: {
        base: isHex(value.custom?.base) ? value.custom.base.toLowerCase() : '',
        panel: isHex(value.custom?.panel) ? value.custom.panel.toLowerCase() : '',
        bar: isHex(value.custom?.bar) ? value.custom.bar.toLowerCase() : '',
      },
    };
  } catch {
    return defaultTone;
  }
}

export function writeTone(value: ToneSetting) {
  try { localStorage.setItem(toneKey, JSON.stringify(value)); } catch { /* 存不下就算了 */ }
}

/** 把设置翻成 collageTone 的 hint。取不到色时返回空对象（退回自动）。 */
export function toneHint(setting: ToneSetting, colors: string[]): { hue?: number; base?: string; panel?: string; bar?: string } {
  if (setting.mode === 'custom') {
    return {
      base: isHex(setting.custom.base) ? setting.custom.base : undefined,
      panel: isHex(setting.custom.panel) ? setting.custom.panel : undefined,
      bar: isHex(setting.custom.bar) ? setting.custom.bar : undefined,
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
