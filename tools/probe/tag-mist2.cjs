/**
 * 低频云雾版石纹：按测量反推参数，不是靠眼睛调。
 *
 * 参考图那块的实测结论（tools/measure/tag-ref.png，剔除金色字母后）：
 *   mean 127.8  sd 12.9  range95 41  lag1 相邻像素相关 0.941
 *   粗化到 4px 块 sd 12.4、8px 12.4、16px 8.9 —— 起伏**跨越大尺度**才没掉
 *   线性趋势只解释 6.8% 方差（r² 0.068）—— 不是单纯的斜向渐变
 *
 * 而现在的浪脊版：sd 23.4、range95 99、相邻相关低得多（中频）。
 * 所以差别不在「有没有纹理」，在**频率**：ref 是大团块的慢变化。
 *
 * 这一轮只变「噪声频率 + 混合方式」，幅度统一用 opacity 收：
 * 目标是 sd 落在 12~16（ref 12.9，纯底色 11.1）。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-mist2.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');
const { load, lum } = require('../measure/pixels.cjs');

const TARGET = { mean: 127.8, sd: 12.9, range95: 41 };

/**
 * 每个候选：噪声频率 / 层数 / 模糊 / 混合模式 / 透明度。
 *
 * 混合用 soft-light 而不是 overlay：soft-light 对 0.5 灰几乎不做改动，
 * 偏离 0.5 的部分提亮或压暗，曲线比 overlay 平缓，正适合这种「极轻的雾」。
 * 所以底图给 0.5 灰（#808080），噪声围绕它上下浮动。
 */
const CANDIDATES = [
  { name: 'sea', note: '现状：20deg 条带 + 低频位移（对照）', custom: 'current' },
  {
    name: 'mist-a', note: '云雾 A：0.003 单频 + 轻柔',
    freq: '0.003', octaves: 2, blur: 1.0, seed: 23, opacity: 0.55,
  },
  {
    name: 'mist-b', note: '云雾 B：横纵不同频（3:5），带一点流向',
    freq: '0.0022 0.0038', octaves: 3, blur: 1.4, seed: 23, opacity: 0.5,
  },
  {
    name: 'mist-c', note: '云雾 C：更低频、更大团',
    freq: '0.0016', octaves: 2, blur: 2.2, seed: 23, opacity: 0.6,
  },
  {
    name: 'mist-d', note: '云雾 D：turbulence（有脉络感）而非 fractalNoise（团块）',
    freq: '0.004', octaves: 2, blur: 1.0, seed: 23, opacity: 0.5, type: 'turbulence',
  },
  {
    name: 'mist-e', note: '云雾 E：B 的基础上压低幅度',
    freq: '0.0022 0.0038', octaves: 3, blur: 1.4, seed: 23, opacity: 0.35,
  },
];

function markupOf(c) {
  const type = c.type || 'fractalNoise';
  return `<feTurbulence type="${type}" baseFrequency="${c.freq}" numOctaves="${c.octaves}" seed="${c.seed}" result="cloud"/>` +
    '<feColorMatrix in="cloud" type="saturate" values="0" result="cloud"/>' +
    `<feGaussianBlur in="cloud" stdDeviation="${c.blur}" result="soft"/>` +
    // 只把 alpha 钉死；RGB 保持噪声原样（围绕 0.5 浮动），
    // 这样 soft-light 才有「提亮 + 压暗」两个方向。
    '<feComponentTransfer in="soft"><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>';
}

const AREA = `(() => {
  const r = document.querySelector('.tpl-tag').getBoundingClientRect();
  return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6,
           width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
})()`;

function apply(index) {
  const c = CANDIDATES[index];
  // 现状那档不动任何东西，只是把之前注入的清掉
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
    const old = document.getElementById('try-filter');
    if (old) old.remove();
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
    return { mode: c.name, filter: before.filter, blend: before.mixBlendMode, opacity: before.opacity };
  } catch (e) { return { error: e.message }; } })()`.replace("c.name", JSON.stringify(c.name));
}

function statsOf(file, size) {
  const img = load(file, { x: 10, y: 10, w: size.width - 20, h: size.height - 20 });
  const vals = [];
  for (let y = 0; y < img.H; y++) {
    for (let x = 0; x < img.W; x++) {
      const [r, g, b] = img.px(x, y);
      if (r > 110 && g > 85 && b < r - 45) continue;
      vals.push(lum(r, g, b));
    }
  }
  vals.sort((a, b) => a - b);
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const q = (p) => vals[Math.round(p * (n - 1))];
  return {
    mean: +mean.toFixed(1),
    sd: +sd.toFixed(1),
    range95: +(q(0.95) - q(0.05)).toFixed(0),
    p50: +q(0.5).toFixed(0),
  };
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

  const shots = [];
  const rows = [];
  for (let i = 0; i < CANDIDATES.length; i++) {
    const state = await probe.run(apply(i));
    await wait(320);
    const img = await probe.win.webContents.capturePage(area);
    const file = path.join(__dirname, `mist2-${i}-${CANDIDATES[i].name}.png`);
    fs.writeFileSync(file, img.toPNG());
    shots.push(img);
    const s = statsOf(file, img.getSize());
    const d = Math.hypot((s.mean - TARGET.mean) / 20, (s.sd - TARGET.sd) / 4, (s.range95 - TARGET.range95) / 20);
    rows.push({ case: CANDIDATES[i].name, ...state, ...s, distance: +d.toFixed(3) });
  }

  const strip = concat(shots);
  const file = path.join(__dirname, 'mist2-sweep.png');
  fs.writeFileSync(file, strip.toPNG());

  report({ target: TARGET, rows: rows.sort((a, b) => a.distance - b.distance), strip: file });
});
