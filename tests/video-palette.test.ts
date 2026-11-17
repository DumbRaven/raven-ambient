/**
 * 视频与封面共用的取色：`pickPalette`。
 *
 * 这份测试是补债。`src/video-palette.ts` 里那句「要统一的话，得先给视频抽色
 * 加一条锁住输出的测试」写了很久，一直没加，于是那条「有意留着」的
 * 字符编码去重判据留到了用户 m04694 报「挑一个里面只有一块可点」那天。
 *
 * 锁的是三件事：
 *
 *   1. **深色画面也能分出多个色**。这是原来的病根：`#1a1314` / `#281811` /
 *      `#2f2929` 这种同色相、明度差 1~3% 的近邻，字符编码差只有 1~3，
 *      永远过不了 34 那道坎，整张画面只取回 1 个色，「挑一个」就只剩一块。
 *   2. **浅色画面不要被拆成四个几乎一样的白**。
 *   3. **纯黑纯白与半透明不参与**，这是两边一直一致的口径。
 *
 * 用一个假 context 就够——`pickPalette` 只调 `getImageData`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPalette, toRgb } from '../src/vinyl.ts';

/** 造一个 size×size 的假 canvas context，像素由 `paint(x, y)` 决定。 */
function context(size: number, paint: (x: number, y: number) => [number, number, number, number] | null) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = paint(x, y);
      if (!px) continue;
      const at = (y * size + x) * 4;
      data[at] = px[0]; data[at + 1] = px[1]; data[at + 2] = px[2]; data[at + 3] = px[3];
    }
  }
  return { getImageData: () => ({ data }) } as unknown as CanvasRenderingContext2D;
}

/** 把 size×size 切成横条，每条一种颜色。 */
function stripes(size: number, colors: [number, number, number][]) {
  const band = Math.ceil(size / colors.length);
  return context(size, (_x, y) => {
    const [r, g, b] = colors[Math.min(colors.length - 1, Math.floor(y / band))];
    return [r, g, b, 255];
  });
}

function rgbOf(hex: string) {
  return toRgb(hex);
}

/** 两个颜色的真实 RGB 距离——判「分得开」用它，不要用字符串编码差。 */
function gap(a: string, b: string) {
  const [r1, g1, b1] = rgbOf(a), [r2, g2, b2] = rgbOf(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

test('深色画面也能分出多个色：同色相明度差 1~3% 的近邻不能互相顶掉', () => {
  // 真实案例：Raining Apartment 那一帧的四个桶。
  // 旧判据（字符编码差）在同一份输入上只放得出 **1 个**色——整张画面就剩一块可点，
  // 那正是用户 m04694 报的现象。
  //
  // 预期写 >= 2 而不是 >= 3，是有意的，别改回去：
  // 这四条带子是按排序后贪心挑的，`#4d2c17` 进来之后 `#1a1314` 与 `#281811`
  // 互为近邻（色距 42.5 / 15.2），34 这道门槛下第三个挑不出来。
  // 真实 164 个视频的实测分布是：出 1 个 **0**、出 2 个 4、出 3 个 18、出 4 个 142
  // ——所以「至少 2 个」正好是这条判据能兑现的承诺，写 3 会是一条永远红的测试。
  const near = [
    [0x1a, 0x13, 0x14],
    [0x28, 0x18, 0x11],
    [0x2f, 0x29, 0x29],
    [0x4d, 0x2c, 0x17],
  ] as [number, number, number][];
  const picked = pickPalette(stripes(36, near), 36);
  assert.ok(picked.length >= 2, `深色近邻应当能分出至少 2 个色，实际只剩 ${picked.length} 个：${picked.join(' ')}`);
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      assert.ok(gap(picked[i], picked[j]) > 30, `返回的两个色离得太近：${picked[i]} 与 ${picked[j]}`);
    }
  }
});

test('浅色画面不要拆成四个几乎一样的白', () => {
  const bright = [
    [0xf2, 0xef, 0xea],
    [0xee, 0xea, 0xe6],
    [0xf5, 0xf2, 0xee],
    [0xe8, 0xe4, 0xdf],
  ] as [number, number, number][];
  const picked = pickPalette(stripes(36, bright), 36);
  assert.ok(picked.length <= 2, `一片差不多的暖白只该取回 1~2 个色，实际 ${picked.length} 个：${picked.join(' ')}`);
});

test('四个真不一样的颜色能全取回来', () => {
  const four = [
    [0x8c, 0x1a, 0x1a],
    [0x1a, 0x6b, 0x2e],
    [0x1d, 0x3f, 0xa0],
    [0xd4, 0xa0, 0x40],
  ] as [number, number, number][];
  const picked = pickPalette(stripes(36, four), 36);
  assert.equal(picked.length, 4, `四个明显不同的色应当全部取回，实际 ${picked.join(' ')}`);
});

test('纯黑、纯白、半透明都不参与取色', () => {
  const half = context(36, (x, y) => {
    if (x < 9) return [0, 0, 0, 255];        // 纯黑
    if (x < 18) return [255, 255, 255, 255]; // 纯白
    if (x < 27) return [200, 30, 30, 40];    // 半透明红，alpha 太低
    return [40, 90, 160, 255];               // 唯一有效色
  });
  const picked = pickPalette(half, 36);
  assert.equal(picked.length, 1, `只该留下那一个有效色，实际 ${picked.join(' ')}`);
  const [r, g, b] = rgbOf(picked[0]);
  assert.ok(b > r && b > g, `留下的应当是那个蓝色，实际 ${picked[0]}`);
});

test('上限是四个色', () => {
  const many = Array.from({ length: 12 }, (_, i) => [i * 21, 255 - i * 21, (i * 47) % 256] as [number, number, number]);
  const picked = pickPalette(stripes(36, many), 36);
  assert.ok(picked.length <= 4, `最多 4 个，实际 ${picked.length} 个`);
});

test('黑画面取不到色，返回空数组而不是抛错', () => {
  const black = context(36, () => [0, 0, 0, 255]);
  assert.deepEqual(pickPalette(black, 36), []);
});

test('同样是深色近邻，返回值必须稳定（同一输入两次一样）', () => {
  const near = [
    [0x1a, 0x13, 0x14],
    [0x28, 0x18, 0x11],
    [0x2f, 0x29, 0x29],
  ] as [number, number, number][];
  const once = pickPalette(stripes(36, near), 36);
  const twice = pickPalette(stripes(36, near), 36);
  assert.deepEqual(once, twice, '同一张图两次取色必须完全一样，否则缓存和基线都没法对');
});
