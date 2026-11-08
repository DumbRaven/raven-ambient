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

test('玉石：纹路靠折叠（type="table"）出来，不是靠调对比', () => {
  // 这是整段弯路里最关键的一条：feTurbulence 的线性缩放只能改振幅，
  // 各向异性只把脊压扁（出来是拉丝金属）。要纹路必须把噪声值反复折叠，
  // 每跨一个 1/rings 就是一条线。没有 tableValues 就退回到「雾 / 斑点」。
  const tables = jade.match(/type="table" tableValues="/g) ?? [];
  assert.ok(tables.length >= 2, `至少两层折叠，实际 ${tables.length}`);
  // 纯色映射表只有两个端点（反相用），真正折叠的那几张必须是多值表。
  const values = [...jade.matchAll(/tableValues="([^"]+)"/g)].map(([, raw]) => raw.trim().split(/\s+/).length);
  assert.ok(values.some(count => count > 8), `折叠表的点数太少，折不出来：${values.join(',')}`);
});

test('玉石：主纹与支纹要两套种子，否则只有一层线', () => {
  // 只放一层时线条整齐得像揉皱的锡纸；两层不同种子、粗细不同才有「有主有支」。
  const seeds = [...jade.matchAll(/numOctaves="2" seed="(\d+)"/g)].map(([, seed]) => seed);
  assert.ok(new Set(seeds).size >= 2, `种子要各不相同，实际 ${seeds.join(',')}`);
});

test('玉石：两层共用同一个位移场，否则主支朝不同方向弯', () => {
  // 两个 feDisplacementMap 的 in2 必须指向同一个结果名。
  const maps = [...jade.matchAll(/<feDisplacementMap in="(\w+)" in2="(\w+)"/g)];
  assert.equal(maps.length, 2, '主纹与支纹各一次位移');
  assert.equal(maps[0][2], maps[1][2], '两层必须共用同一个位移场');
});

test('玉石：不能出现 operator="over" 或 "in" —— 两个都静默出错', () => {
  // over 会把整张灰度图盖上去，得到一层不透明灰，CSS 底色完全看不见；
  // in 会用 SourceGraphic 的 alpha 当遮罩，::before 一旦是透明底，
  // 整张纹理被乘成 0——现象是「换个底色纹理忽然不见」，而且不报错。
  assert.ok(!jade.includes('operator="over"'), 'over 会盖住底色');
  assert.ok(!jade.includes('operator="in"'), 'in 会按 alpha 把纹理乘成 0');
  assert.ok(!/<feComposite[^>]*operator="(?!arithmetic)/.test(jade), '合成只允许用 arithmetic');
});

test('玉石：纹路与背景用加权平均拼，不能用纯乘积', () => {
  // 纯乘积（k1=1 的连乘）会把均值一起砍半，整块发闷（j44 实测 mean 掉到 96.8~106）。
  // 也不是 lerp：lerp 需要一个遮罩决定「哪儿显示纹、哪儿显示底」，
  // 而参考图是**到处都有纹**，只是浓淡不同——加权平均才对。
  //
  // 注意末尾那级「亮度系数 × 底色」**确实**是纯乘积（k1=1），
  // 但那是乘在底色上的，不是把两张灰度图连乘——所以这里只查 k2/k3 非零的那两处。
  const mixes = [...jade.matchAll(/operator="arithmetic" k1="0" k2="([\d.]+)" k3="([\d.]+)" k4="0"/g)];
  assert.equal(mixes.length, 2, `要有主支合成与纹底合成两处，实际 ${mixes.length}`);
  // 权重和必须为 1，否则整体亮度会跟着权重跑。
  for (const [, k2, k3] of mixes) {
    assert.ok(Math.abs(Number(k2) + Number(k3) - 1) < 0.001, `权重和应为 1，实际 ${k2}+${k3}`);
  }
  // 中间合成里不许出现纯乘积（末尾那一级单独由下面的测试守）。
  const grays = jade.slice(0, jade.indexOf('result="mix"'));
  assert.ok(!/operator="arithmetic" k1="1"/.test(grays), '中间层不允许纯乘积连乘');
});

test('玉石：每一层都要钉死 alpha，否则整块半透明只剩灰雾', () => {
  // feTurbulence 的 alpha 通道也是噪声。不钉成 1，叠上去几乎看不见纹理。
  // 三层：主纹、支纹、背景。
  const pinned = jade.match(/<feFuncA type="linear" slope="0" intercept="1"\/>/g) ?? [];
  assert.ok(pinned.length >= 3, `每层（两纹路 + 背景）都要钉，实际 ${pinned.length}`);
});

test('玉石：两层纹路的频率不同，粗细才有分别', () => {
  // 只取主纹（`vmn`）与支纹（`vsn`）。背景层（`bn`）的周期是给「大片明暗」用的，
  // 比胶囊还宽，混进来会把下界撑破——它由下一条测试单独守。
  const freqs = [...jade.matchAll(/type="turbulence" baseFrequency="([\d.]+) [\d.]+" numOctaves="2" seed="\d+" result="v[ms]n"/g)]
    .map(([, fx]) => Number(fx));
  assert.ok(freqs.length >= 2, `需要两层纹路，实际 ${freqs.length}`);
  // 主纹周期比支纹长（频率更低），否则两层一样粗，读起来只有一层。
  assert.ok(Math.max(...freqs) / Math.min(...freqs) >= 1.5, `两层频率太接近：${freqs.join(', ')}`);
  for (const fx of freqs) {
    // 主纹 0.018 周期 ≈ 56px（暗区主体），细纹 0.080 ≈ 12px（只做边缘）。
    // 高于 0.12 会碎成霜花，低于 0.012 只剩渐变。
    assert.ok(fx >= 0.012 && fx <= 0.12, `横向频率 ${fx} 不在合适区间`);
  }
});

test('玉石：主纹的模糊要够大，暗团边缘才是晕开的', () => {
  // 这条与浪脊版**正好相反**：浪脊要磨掉等值面的硬边但不能糊平，
  // 玉石要的恰恰是**边缘晕开**——参考图的暗团没有清晰边界。
  // 实测主纹 1.8 时暗区连通性 large 0.871（参考 0.908）；降到 1.0 以下
  // 暗团会有硬边，看着像霉斑。
  const blurs = [...jade.matchAll(/in="v[ms]b" stdDeviation="([\d.]+)"/g)].map(([, value]) => Number(value));
  assert.equal(blurs.length, 2, '主纹与支纹各一次模糊');
  const [main, sub] = blurs;
  // 主纹必须比细纹糊得多：细纹的职责是留碎边，主纹的职责是铺大团。
  assert.ok(main > sub, `主纹模糊应大于细纹，实际 ${main} vs ${sub}`);
  assert.ok(main >= 1.2 && main <= 3, `主纹 stdDeviation ${main} 应落在 1.2~3`);
  assert.ok(sub > 0.2 && sub <= 1.2, `细纹 stdDeviation ${sub} 应落在 0.2~1.2`);
});

test('玉石：背景层的周期比胶囊还宽，只负责整片明暗', () => {
  // 深斑层频率 0.006 横向 ⇒ 周期 ≈ 167px，比胶囊宽，这样才出「大片」而不是「斑点」。
  const bg = jade.match(/baseFrequency="0\.00(\d+) 0\.00(\d+)"/);
  assert.ok(bg, '找不到背景层的频率');
  const freq = Number(`0.00${bg[1]}`);
  assert.ok(freq > 0 && freq <= 0.01, `背景层频率 ${freq} 太高就变成第二层细纹`);
});

test('玉石：走 sRGB 插值，否则拉对比之后颜色会偏', () => {
  assert.ok(jade.includes('color-interpolation-filters="sRGB"'));
});

test('玉石：末尾把中性灰当成亮度系数，与底色相乘', () => {
  // 前几层算出来的是**中性灰**（三通道相同），最后一步把它当成
  // 「亮度乘数」盖到底色上：`底色 × (1 ± amount/2)`。
  //
  // 为什么必须是乘、不是覆盖：用户 m09087 指出
  // 「胶囊本身是没有色彩的，他是根据面板的颜色来变色的」。
  // 覆盖就是给胶囊刷一层死灰，面板换暖色它也不动（实测 dR=dG=dB=0）。
  // 相乘只缩放亮度、不改色相，胶囊的颜色于是恒等于底色——
  // 而底色是 CSS 用 `hsl(from var(--tpl-panel) h s calc(l * 1.6))` 现算的。
  const tail = jade.match(/<feComposite in="SourceGraphic" in2="lit" operator="arithmetic" (.+?) result="out"\/>/);
  assert.ok(tail, '末尾必须把亮度系数与 SourceGraphic 相乘');
  const numbers = new Map(
    [...tail[1].matchAll(/(k\d)="(-?[\d.]+)"/g)].map(([, key, value]) => [key, Number(value)]),
  );
  assert.equal(numbers.get('k1'), 1, '乘积项必须是 k1，否则底色不会被纹理调制');
  for (const key of ['k2', 'k3', 'k4']) {
    assert.equal(numberOf(numbers.get(key)), 0, `${key} 应为 0，颜色只能来自底色`);
  }

  // 映射到亮度系数的那一级：三通道必须完全一致——纹理无色，
  // 一旦三通道不同，胶囊就又自带了颜色。
  const lit = jade.match(/<feComponentTransfer in="mix" result="lit">([\s\S]*?)<\/feComponentTransfer>/);
  assert.ok(lit, '找不到把 mix 映射成亮度系数的那一级');
  const funcs = [...lit[1].matchAll(/<feFunc[RGB] type="linear" slope="([\d.]+)" intercept="(-?[\d.]+)"/g)];
  assert.equal(funcs.length, 3, '三通道都要映射');
  const slopes = funcs.map(([, v]) => Number(v));
  assert.equal(new Set(slopes).size, 1, `三通道 slope 必须相同：${slopes.join(',')}`);
  assert.ok(slopes[0] > 0.3 && slopes[0] < 2.5, `amount ${slopes[0]} 应在 0.3~2.5（太小看不见纹，太大整块发黑）`);

  // **映射中心必须对准纹理的真实均值**。
  //
  // 这条是踩了坑之后补的：取值域中心 0.5 时，纹理实际均值是 0.73，
  // 算出来 `0.34·0.73 + 0.83 = 1.08`，一大片被钳在 1 ——
  // 调 amount 只改「被钳面积」，sd 从 0.7 到 0.8 几乎不动，
  // 只有 skew 在翻。找了很久「为什么怎么调都不动」，根因就是这一条。
  //
  // 判据：解出「输出 = 1」那个输入值（也就是乘 1 的位置），它必须落在中灰以上。
  // 落在 0.5 附近说明有人又把中心当成「中灰」写死了。
  // 注意解的是 `slope·x + intercept = 1`，不是 `= x`——后者求的是「输出等于输入」，
  // 在这个映射里恒等于 0.28，跟中心没关系（第一次就写错了这一条）。
  const intercepts = funcs.map(([, , v]) => Number(v));
  assert.equal(new Set(intercepts).size, 1, `三通道 intercept 必须相同：${intercepts.join(',')}`);
  const center = (1 - intercepts[0]) / slopes[0];
  assert.ok(center > 0.6 && center < 0.85, `乘 1 的位置应在 0.6~0.85（纹理实测均值约 0.73），实际 ${center.toFixed(3)}`);

  // 收尾必须是管线最后一段。
  assert.ok(jade.indexOf('result="lit"') > jade.indexOf('result="mix"'), '映射应在 mix 之后');
});

function numberOf(value) {
  return value === undefined ? Number.NaN : Number(value);
}

test('玉石：读 SourceGraphic —— 纹理没有自己的颜色，只调制底色的明暗', () => {
  // 与浪脊版相反：浪脊是「凭空生成一张石纹图」，玉石是「给底色加减明暗」。
  // 这条断言是用户 m09087 那次纠正的守门人：
  // 谁把 SourceGraphic 从管线里拿掉，胶囊就会退回「自带颜色」，
  // 换配色时它不跟着变——而且不会有任何报错。
  assert.ok(jade.includes('SourceGraphic'), '玉石必须读取底色，否则颜色跟面板脱钩');
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
