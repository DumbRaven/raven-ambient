/**
 * 拼贴配色 `collageTone` 的三条硬约束。
 *
 * 这份测试是补债。`collageTone` 从写下来到 2026-11-16 一直**没有单元测试**，
 * 而它错了不会有任何报错——只是「配色看着不像画面」。用户 m02164 说的
 * 「自动取色效果不太好」，根因就在下面这两条被违反的约束上：
 *
 *   1. 灰阶画面被强行染色：`#787878` 算成 `base #272020`（偏红）。
 *      因为 `baseS / panelS` 的 clamp 下限写成了 0.10 / 0.12，
 *      无彩色也被补上了饱和度。
 *
 *   2. 亮图的三层明度阶梯是反的：按 `pageLight` 决定底色明度
 *      （`pageLight ? 0.62 : 0.14`），导致亮图底色比面板还亮。
 *      180 组输入里乱了 68 组。参考图实测：橄榄绿那张底色是 l23%，
 *      比深蓝那张（l15%）只亮一点点——**亮图底色也是暗的**。
 *
 * 这三条都是「跑一遍就能验」的不变量，不需要截图。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { collageTone } from '../src/templates.ts';
import { luminance, toRgb } from '../src/vinyl.ts';

function hsl(hex: string) {
  const [r, g, b] = toRgb(hex).map(n => n / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToHex(h: number, s: number, l: number) {
  const hue = ((((h % 360) + 360) % 360) / 360);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + to(f(hue + 1 / 3)) + to(f(hue)) + to(f(hue - 1 / 3));
}

test('灰阶画面保持灰：不能被补上任何饱和度', () => {
  // 用户 m02164 之前：#787878 → base #272020，一套纯灰封面被染成偏红。
  for (const gray of ['#787878', '#909090', '#606060', '#b0b0b0', '#2a2a2a']) {
    const tone = collageTone([gray]);
    for (const [name, color] of Object.entries({ base: tone.base, panel: tone.panel, bar: tone.bar })) {
      const sat = hsl(color).s;
      assert.ok(sat < 0.02, `${gray} 的 ${name} 被染上了 h${hsl(color).h.toFixed(0)} s${sat.toFixed(3)}`);
    }
  }
});

test('多层灰仍是灰：混进一点点色彩也不能把整块拉偏', () => {
  const tone = collageTone(['#808080', '#888888', '#7a7a7a', '#909090']);
  assert.ok(hsl(tone.panel).s < 0.02, `panel ${tone.panel} 的饱和度 ${hsl(tone.panel).s.toFixed(3)} 不该这么高`);
});

test('三层明度阶梯永远单调：底最暗 → 面板中间 → 信息条最亮', () => {
  // 用户 m02164 之前：180 组输入乱了 68 组。
  let checked = 0;
  const broken: string[] = [];
  for (let h = 0; h < 360; h += 30) {
    for (const l of [0.15, 0.35, 0.55, 0.72, 0.9]) {
      for (const s of [0.1, 0.4, 0.8]) {
        const input = hslToHex(h, s, l);
        const tone = collageTone([input]);
        const ladder = [luminance(tone.base), luminance(tone.panel), luminance(tone.bar)];
        checked += 1;
        if (!(ladder[0] <= ladder[1] + 1e-9 && ladder[1] <= ladder[2] + 1e-9)) {
          if (broken.length < 5) {
            broken.push(`${input}(h${h} s${s} l${l}) → ${tone.base}/${tone.panel}/${tone.bar} = ${ladder.map(v => v.toFixed(3)).join('<')}`);
          }
        }
      }
    }
  }
  assert.deepEqual(broken, [], `阶梯乱掉 ${broken.length}/5 例：\n` + broken.join('\n'));
  assert.equal(checked, 180);
});

test('亮图底色也是暗的：不能因为画面亮就抬高底色明度', () => {
  // 参考图实测：橄榄绿那张底色 #3d482b 是 l23%，深蓝那张 #1c2433 是 l15%。
  // 亮图桌面看着浅，但**底色仍然是画面里最深的那一层**。
  const bright = collageTone(['#f2e9d0', '#c4a456', '#3d482b']);
  assert.ok(hsl(bright.base).l < 0.25, `亮图底色 ${bright.base} 明度 ${hsl(bright.base).l.toFixed(2)} 太亮了`);

  const dark = collageTone(['#1c2433', '#4a5363', '#72777d']);
  assert.ok(hsl(dark.base).l < 0.25, `暗图底色 ${dark.base} 明度 ${hsl(dark.base).l.toFixed(2)} 太亮了`);
});

test('有色画面跟着主色相走：蓝海不会被染成土黄', () => {
  // 「蓝海 + 大片沙滩」那张，沙滩面积大但接近中性，s³ 投票才会让海站出来。
  const tone = collageTone(['#3a6ba6', '#94b3c8', '#cbb89a']);
  const hue = hsl(tone.panel).h;
  assert.ok(hue > 180 && hue < 240, `面板色相 ${hue.toFixed(0)} 不在蓝区`);
});

test('hint 指定的那一档原样用，不被阶梯逻辑覆盖', () => {
  const tone = collageTone(['#3a6ba6'], { panel: '#ff0000', hue: 120 });
  assert.equal(tone.panel, '#ff0000');
  assert.ok(hsl(tone.base).h > 100 && hsl(tone.base).h < 140, 'hint.hue 没生效');
});

test('取不到色时退回中性灰，而不是暖砂色', () => {
  // 暖砂色会让整套版式看着像棕色的，和画面完全不像——灰至少诚实。
  const tone = collageTone([]);
  assert.ok(hsl(tone.base).s < 0.02, `空输入底色 ${tone.base} 有色相`);
});

test('非法的颜色串不抛错', () => {
  const tone = collageTone(['不是颜色', '', '#zzz']);
  assert.match(tone.base, /^#[0-9a-f]{6}$/i);
});
