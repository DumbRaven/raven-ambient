/**
 * 石纹第四轮：**fractalNoise 团块 + 大模糊**，不要脉络。
 *
 * 上一轮（`tag-mist3.cjs`）的判读：
 *   - `turbulence` 出来的全是**脉络 / 裂纹**（细胞状），不是参考图那种「雾」。
 *     原因是 turbulence 本身有脊线结构，频率一抬就变成网状。
 *   - `fractalNoise` 强拉伸（t4，lift 3.2）像**霉斑**：团块硬、边缘生噪点。
 *   - 现状 sea（20deg 条带）sd2pct 19.88，比参考靶子 13.94 高 6 个点。
 *
 * 所以这一轮：`fractalNoise` + **较大的 blur** 把团块边缘化开，
 * 用温和的 lift（1.2~1.8）和更低 opacity 把幅度压到靶子附近。
 * 量化标准沿用 `tools/measure/tag-stats2.cjs`：块 2% 宽 sd 打到约 13.9，
 * 且粗化到 16% 仍保留一半以上（参考是 13.94 → 8.72，掉 5.22）。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-mist4.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');
const stats2 = require('../measure/tag-stats2.cjs');

const TARGET = stats2.reference();
const TARGET_SD = stats2.canonical(TARGET).sd;
const TARGET_COARSE = TARGET.rows[TARGET.rows.length - 1].sd;

/**
 * 候选。`blur` 是 stdDeviation，单位是用户空间 px；
 * `lift` 是围绕 0.5 的对比拉伸倍数（soft-light 对 0.5 附近几乎无感，必须先拉）。
 */
const CANDIDATES = [
  { name: 'sea', note: '现状：20deg 条带 + 低频位移（对照）', custom: 'current' },
  { name: 'f1', note: '雾 A：团块约 125px，柔和', freq: '0.008', octaves: 4, blur: 3.0, lift: 1.4, opacity: 0.42 },
  { name: 'f2', note: '雾 B：同频，模糊更大', freq: '0.008', octaves: 4, blur: 5.5, lift: 1.4, opacity: 0.42 },
  { name: 'f3', note: '雾 C：团块约 83px，层次更多', freq: '0.012', octaves: 5, blur: 4.0, lift: 1.6, opacity: 0.38 },
  { name: 'f4', note: '雾 D：团块约 200px，大团慢雾', freq: '0.005', octaves: 3, blur: 6.0, lift: 1.3, opacity: 0.50 },
  { name: 'f5', note: '雾 E：团块约 67px，细一点的雾', freq: '0.015', octaves: 4, blur: 3.0, lift: 1.3, opacity: 0.35 },
  { name: 'f6', note: '雾 F：极柔（多倍频 + 极大模糊）', freq: '0.008', octaves: 6, blur: 9.0, lift: 1.8, opacity: 0.45 },
];

function markupOf(c) {
  const type = c.type || 'fractalNoise';
  const intercept = (0.5 - 0.5 * c.lift).toFixed(3);
  return `<feTurbulence type="${type}" baseFrequency="${c.freq}" numOctaves="${c.octaves}" seed="23" result="cloud"/>` +
    '<feColorMatrix in="cloud" type="saturate" values="0" result="gray"/>' +
    `<feComponentTransfer in="gray" result="lifted">` +
    `<feFuncR type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    `<feFuncG type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    `<feFuncB type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    // alpha 必须钉死：turbulence 的 alpha 也带噪声，不钉的话整块半透明，
    // 叠上去只剩一层灰雾（第一轮就栽在这里）。
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
    const file = path.join(__dirname, `mist4-${i}-${CANDIDATES[i].name}.png`);
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
  const file = path.join(__dirname, 'mist4-sweep.png');
  fs.writeFileSync(file, strip.toPNG());

  await probe.run(hideLetters(false));

  report({
    target: { sd2pct: TARGET_SD, sd16pct: TARGET_COARSE },
    rows: rows.sort((a, b) => (Math.abs(a.deltaSd) + Math.abs(a.deltaCoarse)) - (Math.abs(b.deltaSd) + Math.abs(b.deltaCoarse))),
    strip: file,
  });
});
