/**
 * 石纹滤镜管线的断言。
 *
 * 这个串写错了**不会报错**：id 对不上时 CSS 里那个 url(#tpl-marble) 静默变成 none，
 * 屏幕上只是「胶囊表面平平的」；滤波器顺序写反也只是「看着不像石头」。
 * 所以这里对管线本身做结构性断言——这些性质一旦被改坏，图一定会变，
 * 但光看代码看不出来，所以固化成测试。
 *
 * 两种石头各测各的：它们的性质有几条是**反的**（比如频率方向、有没有折叠），
 * 混在一起写会看不出是哪一种坏了。
 *
 * **测试守的是「结构」，不是「像不像」**。像不像只能看图（探针截图与
 * `tools/measure/tag-raw.png` 并排）；这里守的是那些一旦改坏就会
 * 静默变味的性质：算子用错、alpha 没钉、折叠没了、收尾被挪走。
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

test('玉石：三条丝都靠 type="table" 的等值带映射出来，不是靠调对比', () => {
  // 中值等值带是一条高斯形状的映射表：`val = hi − (hi − lo)·exp(−((x−0.5)/width)²)`。
  // 噪声值落在 0.5 附近的那一层会连成蜿蜒曲线——这才是「丝」，
  // 靠 feComponentTransfer 的线性 slope 只能改对比，永远出不来线条。
  const tables = [...jade.matchAll(/<feFuncR type="table" tableValues="([^"]+)"/g)];
  assert.equal(tables.length, 3, `三条丝各有一张映射表，实际 ${tables.length}`);
  for (const [, table] of tables) {
    const values = table.trim().split(/\s+/).map(Number);
    // 采样点少了曲线是折线，暗带边会出现台阶。
    assert.ok(values.length >= 96, `映射表至少 96 个采样点，实际 ${values.length}`);
    // 高斯碗底：最暗（最小值）应落在中段，而不是表头表尾——
    // 落在表头说明映射方向写反了，出来会是「亮丝」而不是「暗丝」。
    const minIndex = values.indexOf(Math.min(...values));
    const position = minIndex / (values.length - 1);
    assert.ok(position > 0.35 && position < 0.65, `最暗处应在中段，实际在 ${position.toFixed(2)}`);
    // 两端必须比谷底亮：这是「带」而不是「一片暗」。
    assert.ok(values[0] > Math.min(...values) + 0.2, '表头应比谷底亮 0.2 以上');
    assert.ok(values[values.length - 1] > Math.min(...values) + 0.2, '表尾应比谷底亮 0.2 以上');
  }
});

test('玉石：三条丝用三套种子，否则只是同一条线画三遍', () => {
  const seeds = [...jade.matchAll(/<feTurbulence type="fractalNoise" baseFrequency="[\d. ]+" numOctaves="\d+" seed="(\d+)"/g)]
    .map(([, seed]) => seed);
  assert.equal(new Set(seeds).size, seeds.length, `种子不能重复：${seeds.join(',')}`);
});

test('玉石：三条丝共用同一个位移场，否则主支朝不同方向弯', () => {
  // 每条丝各自揉弯会得到三张方向不同的纹理，叠起来像三层玻璃贴在一起。
  const warps = jade.match(/<feTurbulence type="fractalNoise" baseFrequency="0.007" numOctaves="2" seed="31" result="wn"\/>/);
  assert.ok(warps, '找不到共用的位移场');

  const bends = [...jade.matchAll(/<feDisplacementMap in="(v\d)t" in2="wg" scale="66"/g)];
  assert.equal(bends.length, 3, `三条丝都要被同一场揉弯，实际 ${bends.length}`);
  // in2 必须都是 wg：如果哪条改成别的场，方向就会分家。
  const fields = new Set([...jade.matchAll(/<feDisplacementMap in="v\d[tb]" in2="([^"]+)"/g)].map(m => m[1]));
  assert.equal(fields.size, 1, `位移场必须只有一个，实际 ${[...fields].join(',')}`);
});

test('玉石：不能出现 operator="over" 或 "in" —— 两个都静默出错', () => {
  // over 会把整张灰度图盖上去（底色看不见），in 会拿 SourceGraphic 的 alpha
  // 当遮罩（底色透明时纹理整张被乘成 0）。两者都不报错。
  assert.ok(!/operator="over"/.test(jade), 'over 会盖住底色');
  assert.ok(!/operator="in"/.test(jade), 'in 会用 alpha 当遮罩');
});

test('玉石：三个尺度加权平均拼，权重和必须是 1', () => {
  // 纯乘积会把均值一起砍半，整块发闷；lerp 需要一个遮罩决定「哪儿画纹」，
  // 而参考图是到处都有纹、只是浓淡不同——所以只能是加权平均。
  //
  // 注意末尾那级「亮度系数 × 底色」**确实**是纯乘积（k1=1），
  // 但乘的是底色不是两张灰度图，所以这里只查 k2/k3 非零的那两处。
  const mixes = [...jade.matchAll(/operator="arithmetic" k1="0" k2="([\d.]+)" k3="([\d.]+)" k4="0"[^>]*result="(\w+)"/g)];
  assert.equal(mixes.length, 2, `三条丝要两两合成两次，实际 ${mixes.length}`);

  // 只有**最后一级**（result="mix"）的权重和必须是 1。
  // 第一级只是把主干与中枝先合起来（0.46 + 0.30 = 0.76），
  // 细枝的 0.24 要等第二级才加进去——那时两者的和正好是 1，
  // 说明「三层权重归一」这件事得到了保证。
  const last = mixes.find(([, , , name]) => name === 'mix');
  assert.ok(last, '找不到最后一级合成');
  const lastSum = Number(last[1]) + Number(last[2]);
  assert.ok(Math.abs(lastSum - 1) < 0.001, `最后一级权重和应为 1，实际 ${lastSum.toFixed(3)}`);

  // 中间合成里不许出现纯乘积。
  const beforeMix = jade.slice(0, jade.indexOf('result="mix"'));
  assert.ok(!/operator="arithmetic" k1="1"/.test(beforeMix), '中间层不允许纯乘积连乘');
});

test('玉石：每一层都要钉死 alpha，否则整块半透明只剩灰雾', () => {
  // feTurbulence 的 alpha 通道也是噪声。
  const pinned = jade.match(/<feFuncA type="linear" slope="0" intercept="1"\/>/g) ?? [];
  assert.ok(pinned.length >= 4, `三条丝 + 亮度映射都要钉，实际 ${pinned.length}`);
});

test('玉石：三条丝的粗细要拉开——这是「树根」与「龟裂」的分界', () => {
  // 用户 m09592：「做成细长的样子而不是点，就好像树根，有各种枝杈」。
  // 三层如果一样宽，出来就是干裂的泥地；主干必须明显更宽、更细的枝去补边缘。
  const freqs = [...jade.matchAll(/baseFrequency="([\d.]+)" numOctaves="2" seed="\d+" result="v\dn"/g)]
    .map(([, freq]) => Number(freq));
  assert.equal(freqs.length, 3, `三条丝，实际 ${freqs.length}`);

  // 频率差：主干与细枝至少差 5 倍，否则三个尺度挤在一起看不出主次。
  assert.ok(freqs[2] / freqs[0] >= 5, `细枝与主干频率至少差 5 倍，实际 ${(freqs[2] / freqs[0]).toFixed(1)}`);
  // 主干周期要够长：0.007 对应 ≈140px，比胶囊还宽一点，才出「贯穿整条」的主干。
  assert.ok(freqs[0] <= 0.012, `主干频率 ${freqs[0]} 太高，主干会被切成短段`);
  // 细枝频率要够高：0.07 对应 ≈14px，才有细根末梢的密度。
  assert.ok(freqs[2] >= 0.045, `细枝频率 ${freqs[2]} 太低，边缘会空`);

  // 宽度也要递减：这是「有粗有细」最直接的表达。
  const tables = [...jade.matchAll(/<feFuncR type="table" tableValues="([^"]+)"/g)]
    .map(([, table]) => table.trim().split(/\s+/).map(Number));
  const darkShare = tables.map(values => {
    const min = Math.min(...values);
    return values.filter(value => value < min + (Math.max(...values) - min) * 0.5).length / values.length;
  });
  assert.ok(darkShare[0] > darkShare[2], `主干暗带应比细枝宽：${darkShare.map(v => v.toFixed(3)).join(' / ')}`);
});

test('玉石：主干那层的模糊要够大，暗带边缘才是晕开的', () => {
  // 参考图的丝边缘是半透明晕开的，不是切出来的。
  // 主干 2.8、中枝 0.85、细枝 0.4——越粗的层越要糊一点，否则像刻上去的。
  const blurs = [...jade.matchAll(/<feGaussianBlur in="v\db" stdDeviation="([\d.]+)"/g)].map(([, std]) => Number(std));
  assert.equal(blurs.length, 3, `三条丝各一次模糊，实际 ${blurs.length}`);
  assert.ok(blurs[0] >= 1.8, `主干模糊 ${blurs[0]} 太小，暗带边缘会硬`);
  assert.ok(blurs[0] > blurs[1] && blurs[1] > blurs[2], `模糊应逐层递减：${blurs.join(' / ')}`);
});

test('玉石：走 sRGB 插值，否则拉对比之后颜色会偏', () => {
  assert.ok(jade.includes('color-interpolation-filters="sRGB"'));
});

test('玉石：末尾把中性灰当成亮度系数，与底色相乘', () => {
  // 前几层算出来的是**中性灰**（三通道相同），最后一步把它当成
  // 「亮度乘数」盖到底色上：`底色 × (amount·(mix − center) + 1)`。
  //
  // 为什么必须是乘、不是覆盖：用户 m09087 指出
  // 「胶囊本身是没有色彩的，他是根据面板的颜色来变色的」。
  // 覆盖就是给胶囊刷一层死灰，面板换暖色它也不动（实测 dR=dG=dB=0）。
  const tail = jade.match(/<feComposite in="SourceGraphic" in2="lit" operator="arithmetic" (.+?) result="out"\/>/);
  assert.ok(tail, '末尾必须把亮度系数与 SourceGraphic 相乘');
  const numbers = new Map(
    [...tail[1].matchAll(/(k\d)="(-?[\d.]+)"/g)].map(([, key, value]) => [key, Number(value)]),
  );
  assert.equal(numbers.get('k1'), 1, '乘积项必须是 k1，否则底色不会被纹理调制');
  for (const key of ['k2', 'k3', 'k4']) {
    assert.equal(numbers.get(key), 0, `${key} 应为 0，颜色只能来自底色`);
  }

  // 映射到亮度系数的那一级：三通道必须完全一致——纹理无色。
  const lit = jade.match(/<feComponentTransfer in="mix" result="lit">([\s\S]*?)<\/feComponentTransfer>/);
  assert.ok(lit, '找不到把 mix 映射成亮度系数的那一级');
  const linear = [...lit[1].matchAll(/<feFunc[RGB] type="linear" slope="([\d.]+)" intercept="(-?[\d.]+)"/g)]
    .map(([, slope, intercept]) => [Number(slope), Number(intercept)]);
  assert.equal(linear.length, 3, '三通道都要映射');
  assert.equal(new Set(linear.map(([slope]) => slope)).size, 1, '三通道 slope 必须相同');
  assert.equal(new Set(linear.map(([, intercept]) => intercept)).size, 1, '三通道 intercept 必须相同');

  const [slope, intercept] = linear[0];
  assert.ok(slope > 0.5 && slope < 3, `amount ${slope} 应在 0.5~3（太小看不见纹，太大整块发黑）`);

  // 乘 1 的位置（即 center）必须落在纹理的实测均值附近，不能是 0.5。
  // 写成 0.5 会让均值越过 1 被钳住——那时调 amount 只改被钳面积，
  // 对比度纹丝不动，现象是「怎么调都一样糊」。
  const center = (1 - intercept) / slope;
  assert.ok(center > 0.4 && center < 0.75, `center ${center.toFixed(3)} 应在 0.4~0.75`);

  assert.ok(jade.indexOf('result="lit"') > jade.indexOf('result="mix"'), '映射应在 mix 之后');
});

test('玉石：读 SourceGraphic —— 纹理没有自己的颜色，只调制底色的明暗', () => {
  // 与浪脊版相反：浪脊是「凭空生成一张石纹图」，玉石是「给底色加减明暗」。
  // 这条断言是用户 m09087 那次纠正的守门人：
  // 谁把 SourceGraphic 从管线里拿掉，胶囊就会退回「自带颜色」，
  // 换配色时它不跟着变——而且不会有任何报错。
  assert.ok(jade.includes('SourceGraphic'), '玉石必须读取底色，否则颜色跟面板脱钩');
  // 反过来：不许出现任何写死颜色的地方（feFlood / 带色相的 feColorMatrix）。
  assert.ok(!/feFlood/.test(jade), '纹理里不许有实色');
  assert.ok(!/feColorMatrix[^>]*type="matrix"/.test(jade), '偏色不能写进滤镜，要由底色透上来');
});

test('风格表里的每一项都能生成滤镜，非法值收敛成浪脊', () => {
  assert.deepEqual(stoneStyles.map(style => style.id), ['sea', 'jade']);
  for (const style of stoneStyles) {
    assert.ok(style.name.length > 0, `${style.id} 要有名字`);
    // 副标题是选项自己的说明——按「界面不加解释」，说明贴在选项上，不另立一段。
    assert.ok(style.hint.length > 0, `${style.id} 要有副标题`);
    const markup = marbleFilterMarkup(style.id);
    assert.ok(markup.includes(`id="${MARBLE_FILTER_ID}"`), `${style.id} 的滤镜 id 对不上`);
    assert.ok(markup.startsWith('<svg') && markup.endsWith('</svg>'), `${style.id} 的标记不完整`);
  }
  assert.equal(findStoneStyle('cloud'), 'sea', '废弃的 cloud 要收敛回默认');
  assert.equal(findStoneStyle(undefined), 'sea');
  assert.equal(findStoneStyle(42), 'sea');
  assert.ok(isStoneStyle('jade') && isStoneStyle('sea'));
  assert.ok(!isStoneStyle('cloud'));
});
