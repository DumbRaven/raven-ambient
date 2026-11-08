/**
 * 石纹滤镜管线的断言。
 *
 * 这个串写错了**不会报错**：id 对不上时 CSS 里那个 url(#tpl-marble) 静默变成 none，
 * 屏幕上只是「胶囊表面平平的」；滤波器顺序写反也只是「看着不像石头」。
 * 所以这里对管线本身做结构性断言——这些性质一旦被改坏，图一定会变，
 * 但光看代码看不出来，所以固化成测试。
 *
 * 两种石头各测各的：它们的性质有几条是**反的**（比如频率方向、模糊量级），
 * 混在一起写会看不出是哪一种坏了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARBLE_FILTER_ID, findStoneStyle, isStoneStyle, marbleFilterMarkup, stoneStyles } from '../src/marble.ts';

const sea = marbleFilterMarkup('sea');
const jade = marbleFilterMarkup('jade');

test('滤镜 id 与 CSS 里引用的那个一致', () => {
  assert.equal(MARBLE_FILTER_ID, 'tpl-marble');
  assert.ok(sea.includes(`id="${MARBLE_FILTER_ID}"`));
  // 两种石头共用同一个 id：换风格时是整只宿主被替换，不是两条规则并存。
  assert.ok(jade.includes(`id="${MARBLE_FILTER_ID}"`));
});

test('浪脊：先位移再模糊再提对比——顺序错了就揉不出石纹', () => {
  // 位移必须在模糊之前：先糊一遍再位移，脉络边缘会被拉成糊条。
  const bend = sea.indexOf('feDisplacementMap');
  const blur = sea.indexOf('feGaussianBlur');
  const contrast = sea.indexOf('feComponentTransfer');
  assert.ok(bend > 0 && blur > bend && contrast > blur, `顺序不对: bend=${bend} blur=${blur} contrast=${contrast}`);
});

test('浪脊：位移场低频、横向拉长——高频会把条纹打回噪点', () => {
  const warp = sea.match(/baseFrequency="([\d.]+) ([\d.]+)" numOctaves="(\d+)"/);
  assert.ok(warp, '找不到位移场的湍流参数');
  const [, fx, fy, octaves] = warp;
  assert.ok(Number(fx) < Number(fy), '横向频率应低于纵向，条纹才被左右挤成脉络');
  assert.ok(Number(octaves) <= 4, 'octaves 多了就退回细碎噪点，这是当初换管线的理由');
});

test('浪脊：位移区域放宽过，否则四周会被裁掉一圈', () => {
  assert.match(sea, /x="-\d+%"/);
  assert.match(sea, /width="1[0-9]{2}%"/);
});

test('浪脊：细颗粒走 saturate 0 去色，柔光叠在脉络上', () => {
  assert.ok(sea.includes('type="saturate" values="0"'), '颗粒没去色会带出一层彩色噪点');
  assert.ok(sea.includes('mode="soft-light"'), '颗粒应以柔光叠上去，直接叠加会把脉络压死');
});

test('玉石：两层噪声 → 去色 → 抬底裁顶 → 相加，细层还要揉弯', () => {
  // 顺序：先出噪声，再揉弯（只有细层），最后拉亮度。
  // 反过来的话位移会作用在已经钳到 0/1 的图上，等于把边界撕碎。
  const fineNoise = jade.indexOf('baseFrequency="0.022 0.0152"');
  const bend = jade.indexOf('feDisplacementMap');
  const soft = jade.indexOf('feGaussianBlur');
  const bigNoise = jade.indexOf('baseFrequency="0.005"');
  const sum = jade.indexOf('operator="arithmetic"');
  assert.ok(fineNoise > 0, '找不到细纹理层');
  assert.ok(bend > fineNoise, '揉弯应在细纹理之后');
  assert.ok(soft > bend, '模糊应在揉弯之后：先糊再位移会把脉络拉成糊条');
  assert.ok(bigNoise > soft, '大块层应在细纹理层之后');
  assert.ok(sum > bigNoise, '两层相加必须在两层都算完之后');
});

test('玉石：必须用 fractalNoise，不能用 turbulence', () => {
  // turbulence 在每层取**绝对值**，出来的是一道道等值线（丝、细胞、闭合圈）。
  // 参考图放大 6 倍看是没有边界线的灰雾，用 turbulence 怎么调都是满屏斑驳。
  assert.ok(!jade.includes('type="turbulence"'), 'turbulence 出的是脊线，不是雾');
  assert.match(jade, /<feTurbulence type="fractalNoise"/);
  // octaves 只取 2：多了立刻碎成颗粒。
  for (const match of jade.matchAll(/numOctaves="(\d+)"/g)) {
    assert.ok(Number(match[1]) <= 2, `octaves ${match[1]} 太多，会碎成颗粒`);
  }
});

test('玉石：不能出现 operator="over" 或 "in" —— 两个都静默出错', () => {
  // over 会把整张灰度图盖上去，得到一层不透明灰，CSS 底色完全看不见；
  // in 会用 SourceGraphic 的 alpha 当遮罩，::before 一旦是透明底，
  // 整张纹理被乘成 0——现象是「换个底色纹理忽然不见」，而且不报错。
  assert.ok(!jade.includes('operator="over"'), 'over 会盖住底色');
  assert.ok(!jade.includes('operator="in"'), 'in 会按 alpha 把纹理乘成 0');
  assert.ok(!/<feComposite[^>]*operator="(?!arithmetic)/.test(jade), '合成只允许用 arithmetic');
});

test('玉石：两层都要钉死 alpha，否则整块半透明只剩灰雾', () => {
  // feTurbulence 的 alpha 通道也是噪声。不钉成 1，叠上去几乎看不见纹理。
  const pinned = jade.match(/<feFuncA type="linear" slope="0" intercept="1"\/>/g) ?? [];
  assert.equal(pinned.length, 2, '两层各需要一次 alpha 钉死');
});

test('玉石：中心亮度不改变整体明暗', () => {
  // 每层的 intercept 都等于 CENTER - room/2，所以纹理围绕 0.487（裸玻璃实测亮度
  // 124/255）上下浮动，均值不动。改 slope 却不改 intercept 会把胶囊整体提亮/压暗。
  // 排除 alpha 那一行（slope="0" intercept="1"），它不以 0.487 为中心。
  const transfers = [...jade.matchAll(/slope="([\d.]+)" intercept="(-?[\d.]+)"/g)]
    .filter(([, slope]) => Number(slope) !== 0);
  assert.ok(transfers.length >= 2, '找不到两层各自的亮度映射');
  for (const [, slope, intercept] of transfers) {
    const center = Number(slope) / 2 + Number(intercept);
    assert.ok(Math.abs(center - 0.487) < 0.002, `中心落在 ${center.toFixed(3)}，应为 0.487`);
  }
});

test('玉石：细纹理的横向频率是纵向的约 1.45 倍（参考图纵向拉长）', () => {
  const fine = jade.match(/baseFrequency="([\d.]+) ([\d.]+)"/);
  assert.ok(fine, '找不到细纹理的频率');
  const [, fx, fy] = fine;
  // texture-scale.cjs 量出参考图的相关半衰 x 6.73 / y 9.77 ⇒ 各向异性 1.41。
  const ratio = Number(fx) / Number(fy);
  assert.ok(Math.abs(ratio - 1.45) < 0.05, `纵横比 ${ratio.toFixed(2)}，应接近 1.45`);
  // 0.022 横向 ⇒ 周期约 45px，团块横跨胶囊约三分之一。
  // 试过 0.062（周期 16px）：实机放到原尺寸是一粒一粒的霜花，不是雾。
  assert.ok(Number(fx) >= 0.014 && Number(fx) <= 0.034, `横向频率 ${fx} 不在团块合适的区间`);
});

test('玉石：模糊只磨硬边，不能把结构糊平', () => {
  const blur = jade.match(/stdDeviation="([\d.]+)"/);
  assert.ok(blur, '找不到模糊参数');
  const value = Number(blur[1]);
  // 加到 1.4 以上整块会糊成一片均匀浅灰（stone-jade35.cjs 六档全平）。
  // 完全没有模糊又留等值面的硬边，像霜花。
  assert.ok(value > 0.3 && value <= 1.2, `stdDeviation 应落在 0.3~1.2，实际 ${value}`);
});

test('玉石：大块层周期比胶囊还宽，只负责整片明暗', () => {
  const match = jade.match(/baseFrequency="0\.00(\d+)"/);
  assert.ok(match, '找不到大块层的频率');
  const freq = Number(`0.00${match[1]}`);
  assert.ok(freq > 0 && freq <= 0.01, '大块层频率太高就变成第二层细纹，不是明暗过渡');
});

test('玉石：两层按 0.45 加权相加，权重和必须为 1', () => {
  const sum = jade.match(/operator="arithmetic" k1="0" k2="([\d.]+)" k3="([\d.]+)" k4="0"/);
  assert.ok(sum, '找不到相加参数');
  const [, k2, k3] = sum;
  assert.ok(Math.abs(Number(k2) + Number(k3) - 1) < 1e-6, '权重和不为 1 会改变整体亮度');
  assert.ok(Number(k3) > 0.2 && Number(k3) < 0.7, `大块权重 ${k3} 应在 0.2~0.7，否则要么看不出明暗要么盖掉细纹`);
});

test('玉石：走 sRGB 插值，否则拉对比之后颜色会偏', () => {
  assert.ok(jade.includes('color-interpolation-filters="sRGB"'));
});

test('玉石：不读 SourceGraphic，整张纹理是凭空生成的', () => {
  // 一旦引用 SourceGraphic，纹理就会随底色变——那是海浪版的做法。
  assert.ok(!jade.includes('SourceGraphic'));
});

test('风格表里的每一项都能生成滤镜，非法值收敛成浪脊', () => {
  assert.deepEqual(stoneStyles.map(style => style.id), ['sea', 'jade']);
  for (const style of stoneStyles) {
    assert.ok(marbleFilterMarkup(style.id).includes(`id="${MARBLE_FILTER_ID}"`));
    // 副标题不能为空：面板靠它说明这一项是什么，界面上没有第二处解释。
    assert.ok(style.name.length > 0 && style.hint.length > 0);
  }
  assert.equal(findStoneStyle('jade'), 'jade');
  assert.equal(findStoneStyle('cloud'), 'sea', '旧的云雾值要收敛回默认，不能留在类型外');
  assert.equal(findStoneStyle(undefined), 'sea');
  assert.equal(findStoneStyle(42), 'sea');
  assert.ok(isStoneStyle('sea') && !isStoneStyle('sea '));
});
