/**
 * 石纹第七轮：按**实测尺度与各向异性**反推参数。
 *
 * ## 上一轮为什么还是不像
 * 前六轮用的 baseFrequency 是 0.005~0.020，也就是周期 50~200px；
 * 而参考图实测的相关长度（相关系数降到 0.5 的距离）只有 **x 5.8px / y 8.2px**
 * （`F:\Vibe-bold\.tools\tag-direction.cjs`，已在 700px 放大片上量过，
 *   按 5 倍放大折算回原尺寸）。团块直径也就 12~20px。
 * 用周期 100px 的噪声去模拟 15px 的团块，当然怎么调 opacity 都不像——
 * 那是在「一整块渐变上撒灰」，不是「小团块明暗」。
 *
 * ## 各向异性
 * 同一份测量里 lag=32 时 x 相关 0.452、y 相关 0.574，纵向掉得慢
 * ⇒ 纹理沿**纵向**被拉长 1.41 倍。所以 baseFrequency 要用两个不同的值：
 * fy = fx / 1.41，这样纵向周期更长、团块更高瘦，与胶囊的竖长条形态一致。
 *
 * ## 参数换算
 * 要让相关半衰距离 ≈ 6px，fractalNoise 的基础周期取 12~16px，
 * 即 fx ≈ 0.07~0.085。叠加 2~3 个八度补细节，blur 控制在 0.6~1.4
 * （再大就把团块边界糊掉，变成上一轮的塑料感）。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-mist7.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait } = require('./harness.cjs');
const stats2 = require('../measure/tag-stats2.cjs');

const TARGET = stats2.reference();
const TARGET_SD = stats2.canonical(TARGET).sd;
const TARGET_COARSE = TARGET.rows[TARGET.rows.length - 1].sd;

/**
 * 候选。`fx` 是横向频率，纵向固定取 fx / 1.41（实测的拉长比）。
 * `lift` 是围绕 0.5 的对比拉伸，`opacity` 是 soft-light 的总幅度阀。
 */
const STRETCH = 1.41;

const CANDIDATES = [
  { name: 'sea', note: '现状：20deg 条带 + 低频位移（对照）', custom: 'current' },
  { name: 's1', note: '团块 14px · 2 八度 · 轻模糊', fx: 0.070, octaves: 2, blur: 0.8, lift: 1.5, opacity: 0.55 },
  { name: 's2', note: '团块 12px · 3 八度 · 轻模糊', fx: 0.085, octaves: 3, blur: 1.0, lift: 1.5, opacity: 0.55 },
  { name: 's3', note: '团块 17px · 2 八度 · 中模糊', fx: 0.060, octaves: 2, blur: 1.4, lift: 1.5, opacity: 0.60 },
  { name: 's4', note: '团块 12px · 3 八度 · 低幅度', fx: 0.085, octaves: 3, blur: 1.0, lift: 1.4, opacity: 0.42 },
  { name: 's5', note: '团块 20px · 4 八度 · 中模糊', fx: 0.050, octaves: 4, blur: 1.6, lift: 1.5, opacity: 0.60 },
  { name: 's6', note: '团块 12px · 3 八度 · 高幅度', fx: 0.085, octaves: 3, blur: 1.0, lift: 1.8, opacity: 0.70 },
];

function markupOf(c) {
  const intercept = (0.5 - 0.5 * c.lift).toFixed(3);
  const fy = (c.fx / STRETCH).toFixed(4);
  return `<feTurbulence type="fractalNoise" baseFrequency="${c.fx} ${fy}" numOctaves="${c.octaves}" seed="23" result="cloud"/>` +
    '<feColorMatrix in="cloud" type="saturate" values="0" result="gray"/>' +
    '<feComponentTransfer in="gray" result="lifted">' +
    `<feFuncR type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    `<feFuncG type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    `<feFuncB type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    // alpha 必须钉死：feTurbulence 的 alpha 也带噪声，不钉整块会半透明。
    '<feFuncA type="linear" slope="0" intercept="1"/>' +
    '</feComponentTransfer>' +
    `<feGaussianBlur in="lifted" stdDeviation="${c.blur}"/>`;
}

const AREA = `(() => {
  const r = document.querySelector('.tpl-tag').getBoundingClientRect();
  return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6,
           width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
})()`;

function hideLetters(hide) {
  const css = '.tpl-tag .tpl-badge, .tpl-tag .tpl-star { visibility: hidden !important; }';
  return `(() => { try {
    let s = document.getElementById('hide-letters');
    if (${hide}) {
      if (!s) { s = document.createElement('style'); s.id = 'hide-letters'; document.head.appendChild(s); }
      s.textContent = ${JSON.stringify(css)};
    } else if (s) { s.remove(); }
    return { hidden: ${hide} };
  } catch (e) { return { error: e.message }; } })()`;
}

function apply(index) {
  const c = CANDIDATES[index];
  if (c.custom === 'current') {
    return `(() => { try {
      document.getElementById('try-filter')?.remove();
      document.getElementById('try-style')?.remove();
      return { mode: 'current', filter: getComputedStyle(document.querySelector('.tpl-tag'), '::before').filter };
    } catch (e) { return { error: e.message }; } })()`;
  }

  const markup = markupOf(c).replace(/\s+/g, ' ').trim();
  const css = `.template-collage .tpl-tag::before {
      background: #808080;
      filter: url(#tpl-mist-try);
      mix-blend-mode: soft-light;
      opacity: ${c.opacity};
    }`.replace(/\s+/g, ' ').trim();

  return `(() => { try {
    document.getElementById('try-filter')?.remove();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'try-filter';
    svg.setAttribute('width', '300');
    svg.setAttribute('height', '300');
    svg.innerHTML = '<filter id="tpl-mist-try" x="-40%" y="-40%" width="180%" height="180%">${markup}</filter>';
    document.body.appendChild(svg);
    let style = document.getElementById('try-style');
    if (!style) { style = document.createElement('style'); style.id = 'try-style'; document.head.appendChild(style); }
    style.textContent = ${JSON.stringify(css)};
    const before = getComputedStyle(document.querySelector('.tpl-tag'), '::before');
    return { mode: ${JSON.stringify(c.name)}, filter: before.filter, blend: before.mixBlendMode, opacity: before.opacity };
  } catch (e) { return { error: e.message }; } })()`;
}

/** execFileSync 逐参数传，路径不加引号（加了会报 Unrecognized option）。 */
function hstack(files, height, out) {
  const inputs = files.flatMap(f => ['-i', f]);
  const filters = files.map((_, i) => `[${i}:v]scale=-1:${height}:flags=lanczos[s${i}]`).join(';');
  const labels = files.map((_, i) => `[s${i}]`).join('');
  const graph = `${filters};${labels}hstack=inputs=${files.length}[out]`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', out]);
}

guard(async () => {
  const probe = await launch({ expand: true });
  await wait(500);
  const area = await probe.run(AREA);

  const rows = [];
  const plain = [];
  for (let i = 0; i < CANDIDATES.length; i++) {
    const state = await probe.run(apply(i));
    await wait(320);
    const img = await probe.win.webContents.capturePage(area);
    const file = path.join(__dirname, `mist7-${i}-${CANDIDATES[i].name}.png`);
    fs.writeFileSync(file, img.toPNG());
    plain.push(file);

    // 另截一张藏字母的用于统计（同一状态，字母只是 visibility）
    await probe.run(hideLetters(true));
    await wait(120);
    const bare = path.join(__dirname, `mist7-bare-${i}-${CANDIDATES[i].name}.png`);
    fs.writeFileSync(bare, (await probe.win.webContents.capturePage(area)).toPNG());
    await probe.run(hideLetters(false));
    await wait(60);

    const s = stats2.texture(bare);
    const sd = stats2.canonical(s).sd;
    const coarse = s.rows[s.rows.length - 1].sd;
    rows.push({
      case: CANDIDATES[i].name, ...state,
      sd2pct: sd, sd16pct: coarse,
      deltaSd: +(sd - TARGET_SD).toFixed(2),
      deltaCoarse: +(coarse - TARGET_COARSE).toFixed(2),
    });
  }

  await probe.run(`(() => { document.getElementById('try-filter')?.remove();
                            document.getElementById('try-style')?.remove(); })()`);

  const refFile = path.join(__dirname, '..', 'measure', 'tag-ref.png');
  const letters = path.join(__dirname, 'mist7-letter-sweep.png');
  hstack([refFile, ...plain], 420, letters);

  report({
    target: { sd2pct: TARGET_SD, sd16pct: TARGET_COARSE },
    rows: rows.sort((a, b) => (Math.abs(a.deltaSd) + Math.abs(a.deltaCoarse)) - (Math.abs(b.deltaSd) + Math.abs(b.deltaCoarse))),
    letters,
  });
});
