/**
 * 石纹第三轮：先修测量口径，再按正确频率找。
 *
 * ## 测量为什么重做
 * 上一版靠「剔除金色像素」去掉字母，但字母边缘的抗锯齿残留大量中间色，
 * 于是 sd 主要由**字母边缘**贡献。证据：mist-a/b/c 肉眼几乎是均匀灰片，
 * 量出来 sd 却 24，和浪脊版持平。
 * 现在改为**截图前把字母藏起来**（`visibility: hidden`），样本里没有字母，
 * 再用粗化块均值 sd（`tools/measure/tag-stats2.cjs`）统计，和参考图同一口径。
 *
 * ## 频率为什么重估
 * 参考图靶子（700px 放大片，`tag-ref.png`）的块均值 sd：
 *   块 2% 宽 → 13.94 ｜ 4% → 13.0 ｜ 8% → 11.23 ｜ 16% → 8.72
 * 平滑下降 ⇒ 起伏跨大尺度，但**不是无限大**：到 16% 仍明显，
 * 说明团块结构约在胶囊宽的 5%~20%，换算成 152px 的胶囊就是 8~30px。
 * `feTurbulence` 的 `baseFrequency` 是周期倒数（用户空间 px），
 * 所以团块 8~30px 对应 baseFrequency **0.033 ~ 0.125**。
 * 之前用的 0.004（周期 250px）做成了一整块渐变，0.9 又细得像颗粒 —— 两头都不对。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-mist3.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');
const stats2 = require('../measure/tag-stats2.cjs');

const TARGET = stats2.reference();
const TARGET_SD = stats2.canonical(TARGET).sd;

/**
 * 候选。`lift` 是给噪声先做一次对比拉伸，把值域拉开——
 * soft-light 对接近 0.5 的像素几乎不做改动，fractalNoise 的输出
 * 恰恰挤在中间，这就是前一轮 mist-a/b/c 看着「几乎没纹理」的原因。
 */
const CANDIDATES = [
  { name: 'sea', note: '现状：20deg 条带 + 低频位移（对照）', custom: 'current' },
  { name: 't1', note: 'turbulence 0.018 · 团块约 55px · 轻拉伸', freq: '0.018', octaves: 3, blur: 2.0, opacity: 0.5, lift: 1.8, type: 'turbulence' },
  { name: 't2', note: 'turbulence 0.030 · 团块约 33px · 轻拉伸', freq: '0.030', octaves: 3, blur: 2.5, opacity: 0.5, lift: 1.8, type: 'turbulence' },
  { name: 't3', note: 'turbulence 0.045 · 团块约 22px · 轻拉伸', freq: '0.045', octaves: 4, blur: 2.0, opacity: 0.45, lift: 1.8, type: 'turbulence' },
  { name: 't4', note: 'fractalNoise 0.030 · 团块约 33px · 强拉伸', freq: '0.030', octaves: 3, blur: 2.5, opacity: 0.9, lift: 3.2 },
  { name: 't5', note: 'turbulence 0.022 · 团块约 45px · 更大模糊', freq: '0.022', octaves: 2, blur: 4.0, opacity: 0.55, lift: 1.8, type: 'turbulence' },
];

function markupOf(c) {
  const type = c.type || 'fractalNoise';
  // 先拉伸对比（围绕 0.5），再钉死 alpha。
  // 拉伸必须在 saturate 之后：sat 把三通道拉成同一个值，此时再拉才对。
  const lift = c.lift
    ? `<feComponentTransfer in="gray" result="gray">` +
      `<feFuncR type="linear" slope="${c.lift}" intercept="${(0.5 - 0.5 * c.lift).toFixed(3)}"/>` +
      `<feFuncG type="linear" slope="${c.lift}" intercept="${(0.5 - 0.5 * c.lift).toFixed(3)}"/>` +
      `<feFuncB type="linear" slope="${c.lift}" intercept="${(0.5 - 0.5 * c.lift).toFixed(3)}"/>` +
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer>`
    : '<feComponentTransfer in="gray" result="gray"><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>';

  return `<feTurbulence type="${type}" baseFrequency="${c.freq}" numOctaves="${c.octaves}" seed="23" result="cloud"/>` +
    '<feColorMatrix in="cloud" type="saturate" values="0" result="gray"/>' +
    lift +
    `<feGaussianBlur in="gray" stdDeviation="${c.blur}"/>`;
}

/** 截图用的区域：胶囊外扩 6px。 */
const AREA = `(() => {
  const r = document.querySelector('.tpl-tag').getBoundingClientRect();
  return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6,
           width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
})()`;

/** 藏字母与四颗星：它们不属于纹理，留着会污染统计。 */
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
    const file = path.join(__dirname, `mist3-${i}-${CANDIDATES[i].name}.png`);
    fs.writeFileSync(file, img.toPNG());
    shots.push(img);
    const s = stats2.texture(file);
    const sd = stats2.canonical(s).sd;
    const coarse = s.rows[s.rows.length - 1].sd;
    rows.push({
      case: CANDIDATES[i].name, ...state,
      sd2pct: sd, sd16pct: coarse,
      delta: +(sd - TARGET_SD).toFixed(2),
      falloff: +(sd - coarse).toFixed(2),
    });
  }

  const strip = concat(shots);
  const file = path.join(__dirname, 'mist3-sweep.png');
  fs.writeFileSync(file, strip.toPNG());

  await probe.run(hideLetters(false));

  report({
    target: { sd2pct: TARGET_SD, falloff: +(stats2.canonical(TARGET).sd - TARGET.rows[TARGET.rows.length - 1].sd).toFixed(2) },
    rows: rows.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta)),
    strip: file,
  });
});
