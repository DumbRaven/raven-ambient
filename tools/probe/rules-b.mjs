/**
 * B 组：给还没令牌的常用色起语义名。
 *
 * 分成属性限定的形式，因为同一个色值在不同属性里是**不同的东西**：
 *   `#fff` 在 color 上是「深底上的白字」，调主题时它要跟着底走；
 *         在 background 上是「白卡片」，调主题时它可能要保持白；
 *         在 border 上是「白描边」，通常跟 background 同进退但不总是。
 * 混成一个令牌，往后想调一处就得连带改其他两处——那不是重构，是欠新债。
 *
 * 所以这里逐个属性起名，并且**只在确认过语义一致时才合并**。
 * 每一条的语义依据在行尾注明，改之前先看依据还成不成立。
 */
export default [
  // ── 白 ───────────────────────────────────────────────────────────
  // 深底上的白字：激活页签、主按钮文字、危险按钮文字。
  { from: '#fff', to: 'var(--bold-on-dark)', only: ['color'] },
  // 白卡片/白胶囊/白圆钮的底。与 --bold-bg 同值，但语义是「浮起来的那层」，
  // 将来可能改成带一点点暖的白，而 --bold-bg 是画布底色，两者不该绑死。
  { from: '#fff', to: 'var(--bold-surface)', only: ['background', 'background-color'] },
  // 白描边：护眼的分隔线，在深色块边缘或控件内圈用。
  { from: '#fff', to: 'var(--bold-edge)', only: ['border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left'] },

  // ── 黑 ───────────────────────────────────────────────────────────
  // 「已选中」那种实心黑底（`#000` 出现在 .notes-preview.on、播放器底等）。
  { from: '#000', to: 'var(--bold-solid)', only: ['background', 'background-color'] },
  // 黑字：在浅底上用纯黑而不是墨色，是刻意更重的强调。
  { from: '#000', to: 'var(--bold-solid)', only: ['color'] },
  // 纯黑描边/描线。
  { from: '#000', to: 'var(--bold-solid)', only: ['border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left', 'outline'] },

  // ── 悬停／浅色块 ─────────────────────────────────────────────────
  // `#f2f1ed` 与 `#f0efea` 只差 2 个色阶，肉眼几乎看不出，
  // 但它们分别代表「控件悬停」与「区块底色」两类用途。
  // 这里保留为两个令牌而不是合并：合并会让将来的微调失去落点，
  // 而分开的成本只是一个变量名。
  { from: '#f2f1ed', to: 'var(--bold-hover)' },
  { from: '#f0efea', to: 'var(--bold-sunken)' },

  // ── 语义色 ───────────────────────────────────────────────────────
  // 危险/删除：第一下变红、第二下才真删，红只在这一步出现。
  { from: '#c04a34', to: 'var(--bold-danger)' },
  // 删除态的深一档（hover 时压暗），保持与 --bold-danger 同色相。
  { from: '#a13a26', to: 'var(--bold-danger-deep)' },
  // 次级文字：比 --bold-muted 更暗一点，用在说明性正文。
  { from: '#6f6f6a', to: 'var(--bold-soft)' },
];
