/**
 * 石纹第六轮：加对比、收模糊，并且**不加颗粒**。
 *
 * 三联图（`tag-compare.png`）的判读才是决定性的：
 *   左 参考图 —— 大团块明暗、中等对比、**完全没有颗粒**
 *   中 现状   —— 除浪脊外还有一层可见细颗粒（`src/marble.ts` 里 0.9 频率那层）
 *   右 上一轮候选 —— 太软太平，像一块塑料
 *
 * 所以这一轮只做三件事：`opacity` 往上抬（对比）、`blur` 往下收（保住团块边界）、
 * **不加任何高频颗粒**。统计靶子仍是 `tag-stats2.cjs`：sd2pct 13.94 / sd16pct 8.72。
 *
 * 输出 `mist6-sweep.png` 时把参考图裁片放在**第一格**，方便直接肉眼对齐。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-mist6.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait } = require('./harness.cjs');
const stats2 = require('../measure/tag-stats2.cjs');

const TARGET = stats2.reference();
const TARGET_SD = stats2.canonical(TARGET).sd;
const TARGET_COARSE = TARGET.rows[TARGET.rows.length - 1].sd;

const CANDIDATES = [
  { name: 'sea', note: '现状：20deg 条带 + 低频位移（对照）', custom: 'current' },
  { name: 'm1', note: '中团 · 模糊 2.0 · 幅度 0.45', freq: '0.012', octaves: 5, blur: 2.0, lift: 1.6, opacity: 0.45 },
  { name: 'm2', note: '中团 · 模糊 1.2 · 幅度 0.55', freq: '0.012', octaves: 5, blur: 1.2, lift: 1.6, opacity: 0.55 },
  { name: 'm3', note: '大团 · 模糊 2.5 · 幅度 0.55', freq: '0.008', octaves: 4, blur: 2.5, lift: 1.5, opacity: 0.55 },
  { name: 'm4', note: '小团 · 模糊 1.5 · 幅度 0.50', freq: '0.020', octaves: 4, blur: 1.5, lift: 1.6, opacity: 0.50 },
  { name: 'm5', note: '中团 · 强拉伸 · 低幅度', freq: '0.012', octaves: 5, blur: 2.0, lift: 2.2, opacity: 0.35 },
  { name: 'm6', note: '极大团 · 模糊 4.0 · 高幅度', freq: '0.005', octaves: 3, blur: 4.0, lift: 1.4, opacity: 0.60 },
];

function markupOf(c) {
  const intercept = (0.5 - 0.5 * c.lift).toFixed(3);
  return `<feTurbulence type="fractalNoise" baseFrequency="${c.freq}" numOctaves="${c.octaves}" seed="23" result="cloud"/>` +
    '<feColorMatrix in="cloud" type="saturate" values="0" result="gray"/>' +
    '<feComponentTransfer in="gray" result="lifted">' +
    `<feFuncR type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    `<feFuncG type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    `<feFuncB type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    // alpha 必须钉死，否则 turbelence 自带的 alpha 噪声会让整块半透明。
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

/** execFileSync 逐参数传，路径不带引号（带了会报 Unrecognized option）。 */
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
  await probe.run(hideLetters(true));
  await wait(120);

  const shots = [];
  const files = [];
  const rows = [];
  for (let i = 0; i < CANDIDATES.length; i++) {
    const state = await probe.run(apply(i));
    await wait(320);
    const img = await probe.win.webContents.capturePage(area);
    const file = path.join(__dirname, `mist6-${i}-${CANDIDATES[i].name}.png`);
    fs.writeFileSync(file, img.toPNG());
    files.push(file);
    shots.push(img);
    const s = stats2.texture(file);
    const sd = stats2.canonical(s).sd;
    const coarse = s.rows[s.rows.length - 1].sd;
    rows.push({
      case: CANDIDATES[i].name, ...state,
      sd2pct: sd, sd16pct: coarse,
      deltaSd: +(sd - TARGET_SD).toFixed(2),
      deltaCoarse: +(coarse - TARGET_COARSE).toFixed(2),
    });
  }

  await probe.run(hideLetters(false));

  // 带字母的真实观感：再各截一张（字母放回去）
  const plain = [];
  for (let i = 0; i < CANDIDATES.length; i++) {
    await probe.run(apply(i));
    await wait(260);
    const img = await probe.win.webContents.capturePage(area);
    const file = path.join(__dirname, `mist6-letter-${i}-${CANDIDATES[i].name}.png`);
    fs.writeFileSync(file, img.toPNG());
    plain.push(file);
  }
  await probe.run(`(() => { document.getElementById('try-filter')?.remove();
                            document.getElementById('try-style')?.remove(); })()`);

  const refFile = path.join(__dirname, '..', 'measure', 'tag-ref.png');
  const sweep = path.join(__dirname, 'mist6-sweep.png');
  hstack([refFile, ...files], 420, sweep);
  const letters = path.join(__dirname, 'mist6-letter-sweep.png');
  hstack([refFile, ...plain], 420, letters);

  report({
    target: { sd2pct: TARGET_SD, sd16pct: TARGET_COARSE },
    rows: rows.sort((a, b) => (Math.abs(a.deltaSd) + Math.abs(a.deltaCoarse)) - (Math.abs(b.deltaSd) + Math.abs(b.deltaCoarse))),
    sweep, letters,
  });
});
