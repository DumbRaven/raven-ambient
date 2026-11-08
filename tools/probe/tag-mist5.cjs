/**
 * 石纹第五轮：在 `f4`（大团慢雾）与 `f3`（稍细有层次）两个形态上扫幅度。
 *
 * 上一轮 `tag-mist4.cjs` 的结论：
 *   f4 freq 0.005 / oct 3 / blur 6.0 / lift 1.3 / opacity 0.5 → sd2pct 19.37
 *   f3 freq 0.012 / oct 5 / blur 4.0 / lift 1.6 / opacity 0.38 → sd2pct 19.83
 *   参考靶子 → sd2pct 13.94、sd16pct 8.72
 * 形态已经对了（柔和团块，不再是脉络），就差把对比幅度压下来。
 *
 * soft-light 对 0.5 灰几乎无改动、偏离处近似线性，所以幅度 ≈ opacity × lift，
 * 最低有效档在 0.15 附近（再低就看不见了）。这一轮扫这个区间。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-mist5.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');
const stats2 = require('../measure/tag-stats2.cjs');

const TARGET = stats2.reference();
const TARGET_SD = stats2.canonical(TARGET).sd;
const TARGET_COARSE = TARGET.rows[TARGET.rows.length - 1].sd;

/** 两个形态 × 三档幅度。形态参数照抄 `tag-mist4.cjs` 里胜出的那两档。 */
const SHAPES = {
  big: { freq: '0.005', octaves: 3, blur: 6.0, lift: 1.3 },
  mid: { freq: '0.012', octaves: 5, blur: 4.0, lift: 1.6 },
};

const CANDIDATES = [
  { name: 'sea', note: '现状：20deg 条带 + 低频位移（对照）', custom: 'current' },
  { name: 'big-30', note: '大团雾 · 幅度 0.30', shape: 'big', opacity: 0.30 },
  { name: 'big-22', note: '大团雾 · 幅度 0.22', shape: 'big', opacity: 0.22 },
  { name: 'big-15', note: '大团雾 · 幅度 0.15', shape: 'big', opacity: 0.15 },
  { name: 'mid-28', note: '中团雾 · 幅度 0.28', shape: 'mid', opacity: 0.28 },
  { name: 'mid-20', note: '中团雾 · 幅度 0.20', shape: 'mid', opacity: 0.20 },
  { name: 'mid-12', note: '中团雾 · 幅度 0.12', shape: 'mid', opacity: 0.12 },
];

function markupOf(c) {
  const s = SHAPES[c.shape];
  const intercept = (0.5 - 0.5 * s.lift).toFixed(3);
  return `<feTurbulence type="fractalNoise" baseFrequency="${s.freq}" numOctaves="${s.octaves}" seed="23" result="cloud"/>` +
    '<feColorMatrix in="cloud" type="saturate" values="0" result="gray"/>' +
    '<feComponentTransfer in="gray" result="lifted">' +
    `<feFuncR type="linear" slope="${s.lift}" intercept="${intercept}"/>` +
    `<feFuncG type="linear" slope="${s.lift}" intercept="${intercept}"/>` +
    `<feFuncB type="linear" slope="${s.lift}" intercept="${intercept}"/>` +
    '<feFuncA type="linear" slope="0" intercept="1"/>' +
    '</feComponentTransfer>' +
    `<feGaussianBlur in="lifted" stdDeviation="${s.blur}"/>`;
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

function concat(images, gap = 8) {
  const { nativeImage } = require('electron');
  const width = images.reduce((a, i) => a + i.getSize().width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map(i => i.getSize().height));
  const out = Buffer.alloc(width * height * 4, 255);
  let x = 0;
  for (const img of images) {
    const { width: w, height: h } = img.getSize();
    const src = img.toBitmap();
    for (let row = 0; row < h; row++) {
      src.copy(out, ((row * width) + x) * 4, row * w * 4, (row + 1) * w * 4);
    }
    x += w + gap;
  }
  return nativeImage.createFromBitmap(out, { width, height });
}

guard(async () => {
  const probe = await launch({ expand: true });
  await wait(500);
  const area = await probe.run(AREA);
  await probe.run(hideLetters(true));
  await wait(120);

  const shots = [];
  const rows = [];
  for (let i = 0; i < CANDIDATES.length; i++) {
    const state = await probe.run(apply(i));
    await wait(320);
    const img = await probe.win.webContents.capturePage(area);
    const file = path.join(__dirname, `mist5-${i}-${CANDIDATES[i].name}.png`);
    fs.writeFileSync(file, img.toPNG());
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

  const strip = concat(shots);
  const file = path.join(__dirname, 'mist5-sweep.png');
  fs.writeFileSync(file, strip.toPNG());

  await probe.run(hideLetters(false));

  report({
    target: { sd2pct: TARGET_SD, sd16pct: TARGET_COARSE },
    rows: rows.sort((a, b) => (Math.abs(a.deltaSd) + Math.abs(a.deltaCoarse)) - (Math.abs(b.deltaSd) + Math.abs(b.deltaCoarse))),
    strip: file,
  });
});
