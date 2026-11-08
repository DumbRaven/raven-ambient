/**
 * 石纹第八轮：只看**归一化衰减曲线**，不比 sd 绝对值。
 *
 * ## 为什么绝对值不可比（前七轮一直踩的坑）
 * 参考图 `tools/measure/tag-ref.png` 是 140×309 的裁片**放大到 700×1545** 的，
 * 放大（lanczos）等于做了一次低通：细颗粒被抹掉，大团块保留。
 * 我们的截图是原生尺寸（152px 宽），细颗粒一个不落。
 * 于是同一个「块均值 sd」在两边的含义完全不同，绝对值天然差一截，
 * 拿它当目标会永远「太强」，一路压 opacity 压到看不见纹理为止。
 *
 * 真正可比的是**衰减曲线的形状**：把四个尺度的 sd 都除以 2% 尺度的 sd。
 * 参考靶子（`tag-stats2.cjs` 量的）：
 *   13.94 / 13.0 / 11.23 / 8.72  →  shape [1, 0.932, 0.806, 0.626]
 * 这个比值说明：粗化到 16% 宽仍保留六成起伏 ⇒ 大团块占主导。
 *
 * ## 本轮区间
 * 参考图在 152px 宽的胶囊里大约能看到 3~4 个团块 ⇒ 团块周期 40~50px
 * ⇒ baseFrequency ≈ 0.020~0.025。前面扫过 0.005（一整块渐变）和
 * 0.085（十几粒小点），都在这区间之外。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-mist8.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait } = require('./harness.cjs');
const stats2 = require('../measure/tag-stats2.cjs');

const TARGET = stats2.reference();
/** 参考图的衰减形状（各尺度 sd / 2% 尺度 sd）。 */
const TARGET_SHAPE = TARGET.rows.map(r => +(r.sd / TARGET.rows[0].sd).toFixed(3));

/** 实测的各向异性：纵向周期是横向的 1.41 倍。 */
const STRETCH = 1.41;

const CANDIDATES = [
  { name: 'sea', note: '现状：20deg 条带 + 低频位移（对照）', custom: 'current' },
  { name: 'a1', note: '团块 50px · 3 八度 · 模糊 1.6', fx: 0.020, octaves: 3, blur: 1.6, lift: 1.5, opacity: 0.60 },
  { name: 'a2', note: '团块 50px · 3 八度 · 模糊 2.6', fx: 0.020, octaves: 3, blur: 2.6, lift: 1.5, opacity: 0.65 },
  { name: 'a3', note: '团块 40px · 4 八度 · 模糊 2.0', fx: 0.025, octaves: 4, blur: 2.0, lift: 1.5, opacity: 0.62 },
  { name: 'a4', note: '团块 40px · 2 八度 · 模糊 2.0', fx: 0.025, octaves: 2, blur: 2.0, lift: 1.5, opacity: 0.62 },
  { name: 'a5', note: '团块 33px · 3 八度 · 模糊 1.8', fx: 0.030, octaves: 3, blur: 1.8, lift: 1.5, opacity: 0.60 },
  { name: 'a6', note: '团块 50px · 3 八度 · 模糊 4.0', fx: 0.020, octaves: 3, blur: 4.0, lift: 1.5, opacity: 0.70 },
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
    // alpha 钉死：feTurbulence 的 alpha 也带噪声，不钉整块会半透明。
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
    const plainFile = path.join(__dirname, `mist8-${i}-${CANDIDATES[i].name}.png`);
    fs.writeFileSync(plainFile, (await probe.win.webContents.capturePage(area)).toPNG());
    plain.push(plainFile);

    await probe.run(hideLetters(true));
    await wait(120);
    const bare = path.join(__dirname, `mist8-bare-${i}-${CANDIDATES[i].name}.png`);
    fs.writeFileSync(bare, (await probe.win.webContents.capturePage(area)).toPNG());
    await probe.run(hideLetters(false));
    await wait(60);

    const s = stats2.texture(bare);
    const shape = s.rows.map(r => +(r.sd / s.rows[0].sd).toFixed(3));
    // 形状误差：四个尺度上的平均绝对差。绝对值不参与评分（见文件头）。
    const shapeError = +(shape.reduce((a, v, k) => a + Math.abs(v - TARGET_SHAPE[k]), 0) / shape.length).toFixed(4);
    rows.push({ case: CANDIDATES[i].name, ...state, sd2pct: stats2.canonical(s).sd, shape, shapeError });
  }

  await probe.run(`(() => { document.getElementById('try-filter')?.remove();
                            document.getElementById('try-style')?.remove(); })()`);

  const refFile = path.join(__dirname, '..', 'measure', 'tag-ref.png');
  const letters = path.join(__dirname, 'mist8-letter-sweep.png');
  hstack([refFile, ...plain], 420, letters);

  report({
    targetShape: TARGET_SHAPE,
    rows: rows.sort((a, b) => a.shapeError - b.shapeError),
    letters,
  });
});
