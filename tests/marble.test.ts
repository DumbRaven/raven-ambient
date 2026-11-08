/**
 * 石纹滤镜管线的断言。
 *
 * 这个串写错了**不会报错**：id 对不上时 CSS 里那个 url(#tpl-marble) 静默变成 none，
 * 屏幕上只是"胶囊表面平平的"；滤波器顺序写反也只是"看着不像石头"。
 * 所以这里对管线本身做结构性断言——这些性质一旦被改坏，图一定会变，
 * 但光看代码看不出来，所以固化成测试。
 *
 * 两种石头各测各的：它们的性质有几条是**反的**（比如频率方向），
 * 混在一起写会看不出是哪一种坏了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARBLE_FILTER_ID, findStoneStyle, isStoneStyle, marbleFilterMarkup, stoneStyles } from '../src/marble.ts';

const sea = marbleFilterMarkup('sea');
const cloud = marbleFilterMarkup('cloud');

test('滤镜 id 与 CSS 里引用的那个一致', () => {
  assert.equal(MARBLE_FILTER_ID, 'tpl-marble');
  assert.ok(sea.includes(`id="${MARBLE_FILTER_ID}"`));
  // 两种石头共用同一个 id：换风格时是整只宿主被替换，不是两条规则并存。
  assert.ok(cloud.includes(`id="${MARBLE_FILTER_ID}"`));
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

test('云雾：团块噪声 → 去色 → 拉对比 → 模糊', () => {
  const noise = cloud.indexOf('feTurbulence');
  const gray = cloud.indexOf('type="saturate"');
  const lift = cloud.indexOf('feComponentTransfer');
  const blur = cloud.indexOf('feGaussianBlur');
  assert.ok(noise > 0 && gray > noise && lift > gray && blur > lift, `顺序不对: ${noise}/${gray}/${lift}/${blur}`);
  // 云雾不读 SourceGraphic：它不要位移，整块是凭空生成的。
  assert.ok(!cloud.includes('feDisplacementMap'), '云雾不该再揉弯——那是浪脊的做法');
});

test('云雾：alpha 必须钉死，否则整块半透明只剩灰雾', () => {
  // feTurbulence 的 alpha 通道也是噪声。不钉成 1，柔光叠上去几乎看不见纹理。
  assert.match(cloud, /<feFuncA type="linear" slope="0" intercept="1"\/>/);
});

test('云雾：团块沿纵向拉长（与浪脊的方向相反）', () => {
  const noise = cloud.match(/baseFrequency="([\d.]+) ([\d.]+)" numOctaves="(\d+)"/);
  assert.ok(noise, '找不到团块噪声的参数');
  const [, fx, fy, octaves] = noise;
  // 横向频率更高 ⇒ 横向变化更快 ⇒ 团块在纵向被拉长。
  // 这个 1.41 是量参考图得来的（相关半衰距离 y/x），不是随便写的。
  assert.ok(Number(fx) > Number(fy), '云雾的横向频率应高于纵向，团块才是竖着拉长的');
  assert.ok(Number(octaves) <= 4, 'octaves 多了又变成细碎噪点');
  assert.ok(Math.abs(Number(fx) / Number(fy) - 1.41) < 0.15, `拉长比例应接近量出来的 1.41，实际 ${fx}/${fy}`);
});

test('云雾：模糊能化开八度的棱角，但没糊到没有边界', () => {
  const blur = cloud.match(/stdDeviation="([\d.]+)"/);
  assert.ok(blur, '找不到模糊参数');
  const value = Number(blur[1]);
  // 小于 1.2 会露出细颗粒（读作斑驳），大于 3 团块边界消失（读作塑料）。
  assert.ok(value >= 1.2 && value <= 3, `stdDeviation 应落在 1.2~3，实际 ${value}`);
});

test('风格表里的每一项都能生成滤镜，非法值收敛成浪脊', () => {
  assert.deepEqual(stoneStyles.map(style => style.id), ['sea', 'cloud']);
  for (const style of stoneStyles) {
    assert.ok(marbleFilterMarkup(style.id).includes(`id="${MARBLE_FILTER_ID}"`));
    // 副标题不能为空：面板靠它说明这一项是什么，界面上没有第二处解释。
    assert.ok(style.name.length > 0 && style.hint.length > 0);
  }
  assert.equal(findStoneStyle('cloud'), 'cloud');
  assert.equal(findStoneStyle('marble'), 'sea');
  assert.equal(findStoneStyle(undefined), 'sea');
  assert.equal(findStoneStyle(42), 'sea');
  assert.ok(isStoneStyle('sea') && !isStoneStyle('sea '));
});
