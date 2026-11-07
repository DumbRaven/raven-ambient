/**
 * 大理石滤镜管线的断言。
 *
 * 这个串写错了**不会报错**：id 对不上时 CSS 里那个 url(#tpl-marble) 静默变成 none，
 * 屏幕上只是"胶囊表面平平的"；滤波器顺序写反也只是"看着不像石头"。
 * 所以这里对管线本身做结构性断言——这些性质一旦被改坏，图一定会变，
 * 但光看代码看不出来，所以固化成测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARBLE_FILTER_ID, marbleFilterMarkup } from '../src/marble.ts';

const markup = marbleFilterMarkup();

test('滤镜 id 与 CSS 里引用的那个一致', () => {
  assert.equal(MARBLE_FILTER_ID, 'tpl-marble');
  assert.ok(markup.includes(`id="${MARBLE_FILTER_ID}"`));
});

test('先位移再模糊再提对比——顺序错了就揉不出石纹', () => {
  // 位移必须在模糊之前：先糊一遍再位移，脉络边缘会被拉成糊条。
  const bend = markup.indexOf('feDisplacementMap');
  const blur = markup.indexOf('feGaussianBlur');
  const contrast = markup.indexOf('feComponentTransfer');
  assert.ok(bend > 0 && blur > bend && contrast > blur, `顺序不对: bend=${bend} blur=${blur} contrast=${contrast}`);
});

test('位移场是低频、横向拉长的——高频会把条纹打回噪点', () => {
  const warp = markup.match(/baseFrequency="([\d.]+) ([\d.]+)" numOctaves="(\d+)"/);
  assert.ok(warp, '找不到位移场的湍流参数');
  const [, fx, fy, octaves] = warp;
  assert.ok(Number(fx) < Number(fy), '横向频率应低于纵向，条纹才被左右挤成脉络');
  assert.ok(Number(octaves) <= 4, 'octaves 多了就退回细碎噪点，这是当初换管线的理由');
});

test('位移区域放宽过，否则四周会被裁掉一圈', () => {
  assert.match(markup, /x="-\d+%"/);
  assert.match(markup, /width="1[0-9]{2}%"/);
});

test('细颗粒走 saturate 0 去色，并且是叠在脉络上的 low 幅度', () => {
  assert.ok(markup.includes('type="saturate" values="0"'), '颗粒没去色会带出一层彩色噪点');
  assert.ok(markup.includes('mode="soft-light"'), '颗粒应以柔光叠上去，直接叠加会把脉络压死');
});
