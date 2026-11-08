/**
 * 玉石第三版：把暗区做成「树根」——细长、有主干有分支、铺得均匀。
 *
 * 用户 m09596 原话：「把重点的颜色分散的均匀一些，而且做成细长的样子
 * 而不是点，就好像树根，有各种枝杈」。
 *
 * 现在的做法（折叠等值线 `pow(|sin(v·rings·π)|, sharp)`）出来的是
 * **一圈一圈闭合的等值线**，挤在一起就成了圆斑，而且暗区只集中在几处。
 *
 * 换一个思路：直接取**噪声的中值等值带**。
 *   暗度 = exp(−((v − 0.5) / w)²)
 * 噪声值等于 0.5 的那些点本身连成一条条蜿蜒的曲线（地形图上的等高线），
 * 它天然细长、天然分叉、且铺满整个平面——正好是树根要的形状。
 * `w` 控制丝的粗细，它不再是「几环」，而是「一条带」。
 *
 * 多尺度叠加：低频那条是主干（宽、慢弯），高频那条是分支（细、快抖），
 * 两者用加权平均拼起来，粗细与主次自然区分开。
 *
 * 本探针只注入 markup，不动源码。跑法：
 *   node_modules/electron/dist/electron.exe tools/probe/stone-root.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait } = require('./harness.cjs');

const OPEN = `(() => {
  const button = document.querySelector('button[aria-label="配色"]');
  if (button && !document.querySelector('.tone-stones')) button.click();
  return { menu: !!document.querySelector('.tone-stones') };
})()`;

const PICK_JADE = `(() => {
  const button = [...document.querySelectorAll('.tone-stones button')].find(n => n.textContent.includes('玉石'));
  if (!button) return { error: 'no jade button' };
  button.click();
  return { ok: true };
})()`;

/**
 * 一条丝：噪声 → 去色 → 中值等值带。
 *
 * `val = hi − (hi − lo) · exp(−((x − 0.5) / w)²)`
 * 在 x = 0.5 处取到 `lo`（最暗），离得越远越亮，`w` 越大带越宽。
 */
function bandTable(lo, hi, width, samples = 160) {
  const values = [];
  for (let i = 0; i < samples; i += 1) {
    const x = i / (samples - 1);
    const d = (x - 0.5) / width;
    values.push((hi - (hi - lo) * Math.exp(-d * d)).toFixed(4));
  }
  return values.join(' ');
}

/** 一层噪声 + 它的等值带。`warp` 是共用位移场，揉弯之后线才不像等高线。 */
function layer(name, cfg) {
  const table = bandTable(cfg.lo, cfg.hi, cfg.width);
  return (
    `<feTurbulence type="fractalNoise" baseFrequency="${cfg.freq}" numOctaves="${cfg.octaves ?? 2}" seed="${cfg.seed}" result="${name}n"/>` +
    `<feColorMatrix in="${name}n" type="saturate" values="0" result="${name}g"/>` +
    `<feComponentTransfer in="${name}g" result="${name}t">` +
    `<feFuncR type="table" tableValues="${table}"/>` +
    `<feFuncG type="table" tableValues="${table}"/>` +
    `<feFuncB type="table" tableValues="${table}"/>` +
    `<feFuncA type="linear" slope="0" intercept="1"/>` +
    `</feComponentTransfer>`
  );
}

const AMOUNT = 1.6;
/**
 * `mix` 层的均值，**换管线就要重新量**。
 *
 * 折叠版（`foldTable`）实测 0.73；这一版换成中值等值带（`bandTable`）之后
 * 均值变成 0.63，一开始沿用了 0.73，于是整轮输出被压暗 10~20 个亮度
 * （`root-y3 mean 108.6` vs 参考 130），我还以为要抬 `lo` 才发现是常量错了。
 *
 * 反推公式：`mixMean = CENTER + (out/source − 1) / amount`。
 * 验的时候用 `stone-mixrange.cjs` 直接截 mix 层量更稳。
 */
const CENTER = 0.63;

/** 拼一整只滤镜。`layers` 是 [{freq,seed,width,lo,hi,blur}]，按权重平均。 */
function markup(candidate, center = CENTER) {
  const parts = [];
  candidate.layers.forEach((cfg, index) => parts.push(layer(`L${index}`, cfg)));

  // 位移场：两条带共用，否则主干与分支朝不同方向弯，像两层贴在一起。
  if (candidate.warp) {
    parts.push(
      `<feTurbulence type="fractalNoise" baseFrequency="${candidate.warp.freq}" numOctaves="2" seed="${candidate.warp.seed}" result="wn"/>` +
        `<feColorMatrix in="wn" type="saturate" values="0" result="wg"/>`,
    );
    candidate.layers.forEach((_, index) => {
      parts.push(
        `<feDisplacementMap in="L${index}t" in2="wg" scale="${candidate.warp.scale}" xChannelSelector="R" yChannelSelector="G" result="L${index}b"/>`,
      );
    });
  } else {
    candidate.layers.forEach((_, index) => {
      parts.push(`<feOffset in="L${index}t" dx="0" dy="0" result="L${index}b"/>`);
    });
  }

  // 模糊：磨掉台阶，让边缘晕开（参考图的丝就是晕的）。
  const tails = [];
  candidate.layers.forEach((cfg, index) => {
    const blur = cfg.blur ?? 0;
    if (blur > 0) {
      parts.push(`<feGaussianBlur in="L${index}b" stdDeviation="${blur}" result="L${index}f"/>`);
      tails.push(`L${index}f`);
    } else {
      tails.push(`L${index}b`);
    }
  });

  // 加权平均：权重和 = 1，均值才不跟着权重跑。
  const weights = candidate.layers.map(cfg => cfg.weight ?? 1 / candidate.layers.length);
  const total = weights.reduce((a, v) => a + v, 0);
  let mix = tails[0];
  if (tails.length > 1) {
    // 多于两层时按 k2/k3 两两合成：先 L0+L1，再把结果与 L2 合。
    for (let i = 1; i < tails.length; i += 1) {
      const out = i === tails.length - 1 ? 'mix' : `m${i}`;
      const a = weights.slice(0, i).reduce((s, v) => s + v, 0) / total;
      const b = weights[i] / total;
      parts.push(
        `<feComposite in="${mix}" in2="${tails[i]}" operator="arithmetic" k1="0" k2="${a.toFixed(3)}" k3="${b.toFixed(3)}" k4="0" result="${out}"/>`,
      );
      mix = out;
    }
  } else {
    parts.push(`<feOffset in="${mix}" dx="0" dy="0" result="mix"/>`);
  }

  // 收尾：中性灰当亮度系数，与 CSS 那层底色相乘——颜色始终等于面板色。
  parts.push(
    `<feComponentTransfer in="mix" result="lit">` +
      `<feFuncR type="linear" slope="${AMOUNT}" intercept="${(1 - AMOUNT * center).toFixed(3)}"/>` +
      `<feFuncG type="linear" slope="${AMOUNT}" intercept="${(1 - AMOUNT * center).toFixed(3)}"/>` +
      `<feFuncB type="linear" slope="${AMOUNT}" intercept="${(1 - AMOUNT * center).toFixed(3)}"/>` +
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer>`,
    `<feComposite in="SourceGraphic" in2="lit" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="out"/>`,
  );

  return (
    `<svg width="300" height="300"><filter id="tpl-marble" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    parts.join('') +
    `</filter></svg>`
  );
}

/**
 * 自动标定 `CENTER`，把均值钉到参考图那档。
 *
 * 为什么不能写死：`mix` 层的均值取决于 `lo/hi` 与各层权重，
 * 每换一组候选它就会动（折叠版 0.73、等值带版 0.63、压过 `lo` 之后又更低）。
 * 手工试的结果就是「改一档形状就得重新猜一次常量」，
 * 然后看到 mean 偏了就以为是 `lo` 的锅——这轮已经栽过一次。
 *
 * 关系是线性的：`outMean(C) = srcMean·(amount·mixMean + 1 − amount·C)`。
 * 渲染两档不同的 C、量出两个均值，联立就能解出 `srcMean` 与 `mixMean`，
 * 再反解「均值等于参考图」的那个 C。**形状在这两步里完全不变**，
 * 变的只有乘法的整体增益。
 */
const TARGET_MEAN = 130.1; // tools/measure/tag-raw.png 的 tag-stats mean
const CANDIDATES = [
  {
    name: 'c1 基线',
    layers: [
      { freq: '0.007', seed: 23, width: 0.15, lo: 0.08, hi: 0.90, blur: 2.8, weight: 0.46 },
      { freq: '0.030', seed: 67, width: 0.022, lo: 0.3, hi: 0.90, blur: 0.85, weight: 0.30 },
      { freq: '0.070', seed: 91, width: 0.009, lo: 0.38, hi: 0.90, blur: 0.4, weight: 0.24 },
    ],
    warp: { freq: '0.007', seed: 31, scale: 66 },
  },
  {
    name: 'c2 暗端0.04',
    layers: [
      { freq: '0.007', seed: 23, width: 0.15, lo: 0.04, hi: 0.90, blur: 2.8, weight: 0.46 },
      { freq: '0.030', seed: 67, width: 0.022, lo: 0.26, hi: 0.90, blur: 0.85, weight: 0.30 },
      { freq: '0.070', seed: 91, width: 0.009, lo: 0.34, hi: 0.90, blur: 0.4, weight: 0.24 },
    ],
    warp: { freq: '0.007', seed: 31, scale: 66 },
  },
  {
    name: 'c3 暗端0.00',
    layers: [
      { freq: '0.007', seed: 23, width: 0.15, lo: 0, hi: 0.90, blur: 2.8, weight: 0.46 },
      { freq: '0.030', seed: 67, width: 0.022, lo: 0.22, hi: 0.90, blur: 0.85, weight: 0.30 },
      { freq: '0.070', seed: 91, width: 0.009, lo: 0.3, hi: 0.90, blur: 0.4, weight: 0.24 },
    ],
    warp: { freq: '0.007', seed: 31, scale: 66 },
  },
  {
    name: 'c4 加宽1.6x',
    layers: [
      { freq: '0.007', seed: 23, width: 0.24, lo: 0.08, hi: 0.90, blur: 2.8, weight: 0.46 },
      { freq: '0.030', seed: 67, width: 0.035, lo: 0.3, hi: 0.90, blur: 0.85, weight: 0.30 },
      { freq: '0.070', seed: 91, width: 0.014, lo: 0.38, hi: 0.90, blur: 0.4, weight: 0.24 },
    ],
    warp: { freq: '0.007', seed: 31, scale: 66 },
  },
  {
    name: 'c5 加宽2.2x',
    layers: [
      { freq: '0.007', seed: 23, width: 0.33, lo: 0.08, hi: 0.90, blur: 2.8, weight: 0.46 },
      { freq: '0.030', seed: 67, width: 0.048, lo: 0.3, hi: 0.90, blur: 0.85, weight: 0.30 },
      { freq: '0.070', seed: 91, width: 0.019, lo: 0.38, hi: 0.90, blur: 0.4, weight: 0.24 },
    ],
    warp: { freq: '0.007', seed: 31, scale: 66 },
  },
  {
    name: 'c6 折中',
    layers: [
      { freq: '0.007', seed: 23, width: 0.22, lo: 0.04, hi: 0.90, blur: 2.8, weight: 0.46 },
      { freq: '0.030', seed: 67, width: 0.032, lo: 0.26, hi: 0.90, blur: 0.85, weight: 0.30 },
      { freq: '0.070', seed: 91, width: 0.013, lo: 0.34, hi: 0.90, blur: 0.4, weight: 0.24 },
    ],
    warp: { freq: '0.007', seed: 31, scale: 66 },
  },
];

/** 让页面里的滤镜宿主换成这一份，并把底色定成「面板提亮」。 */
const applyScript = flat => `(() => {
  document.querySelectorAll('[data-tpl-marble]').forEach(n => n.remove());
  const host = document.createElement('div');
  host.setAttribute('data-tpl-marble', 'try');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0';
  host.innerHTML = ${JSON.stringify(flat)};
  document.body.appendChild(host);

  let style = document.getElementById('root-try');
  if (!style) {
    style = document.createElement('style');
    style.id = 'root-try';
    document.head.appendChild(style);
  }
  style.textContent = '.template-collage[data-stone="jade"] .tpl-tag::before {'
    + ' background: hsl(from var(--tpl-panel) h s calc(l * 1.6)) !important;'
    + ' mix-blend-mode: normal !important; opacity: 1 !important; }';
  return { host: document.querySelectorAll('[data-tpl-marble]').length };
})()`;

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });
  const run = code => probe.run(code);

  await run(OPEN);
  await wait(240);
  await run(PICK_JADE);
  await wait(520);

  const rect = await run(`(() => {
    const r = document.querySelector('.tpl-tag').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);
  const [x, y, w, h] = rect ?? [0, 0, 0, 0];
  const pad = 4;

  /** 把某份 markup 装上屏、截一张、返回文件路径。 */
  /**
   * 把一份 markup 装上屏、截一张、返回图片。
   * 传字符串就直接用（截断版走这条路），传候选对象才现场生成。
   */
  const render = async (candidateOrMarkup, center) => {
    const raw = typeof candidateOrMarkup === 'string' ? candidateOrMarkup : markup(candidateOrMarkup, center);
    const markupText = raw.replace(/\s+/g, ' ').trim();
    await run(applyScript(markupText));
    await wait(260);
    const image = await probe.win.webContents.capturePage({
      x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: w + pad * 2, height: h + pad * 2,
    });
    return image;
  };

  /** 直接从截图量中段窄带的平均亮度（与 tag-stats.cjs 同口径）。 */
  const meanOf = image => {
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();
    const x0 = Math.round(width * 0.25), x1 = Math.round(width * 0.75);
    const y0 = Math.round(height * 0.20), y1 = Math.round(height * 0.80);
    let sum = 0, n = 0;
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) {
        const i = (yy * width + xx) * 4;
        const blue = bitmap[i], green = bitmap[i + 1], red = bitmap[i + 2];
        if (red - blue > 26 && red > 96) continue; // 金色字母
        sum += 0.299 * red + 0.587 * green + 0.114 * blue;
        n += 1;
      }
    }
    return n ? sum / n : NaN;
  };

  /**
   * 求「均值等于参考图」的那个中心。
   *
   * 走过两条弯路，都记在这里免得再走：
   *
   *   1. 「渲染两档 C、两点定直线」反解 → 解出负的 `src`。
   *      因为滤镜输出在 0 与 1 处会被钳住，`outMean(C)` 只在中间一段线性，
   *      拿两端去拟合必然荒谬。
   *   2. 「从 computed style 读底色亮度」→ 读出 0.002（几乎全黑）。
   *      `getComputedStyle(tag, '::before').backgroundColor` 在 `hsl(from …)`
   *      这种相对颜色语法上给不出解析后的值。
   *
   * 最终做法：**一次渲染就能解**，因为 mixMean 可以单独量、关系是一次的：
   *   `out = src·(amount·mixMean + 1 − amount·C)`
   * 代入一次实测的 out(C0) 解出 src，再反解令 out = TARGET 的 C。
   */
  const calibrate = async candidate => {
    const C0 = 0.625;
    const full = markup(candidate, C0);
    // 截断版：去掉把 mix 映射成亮度系数那一级、以及与底色相乘那一级，
    // 让 mix 自己当输出。此时屏幕上看到的就是「纹理分布」本身。
    const mixOnly = full
      .replace(/<feComponentTransfer in="mix"[\s\S]*?<\/feComponentTransfer>/, '')
      .replace(/<feComposite in="SourceGraphic"[^>]*\/>/, '')
      .replace('result="mix"', 'result="out"');
    const mixMean = meanOf(await render(mixOnly)) / 255;

    const outMean = meanOf(await render(candidate, C0));
    const gain = AMOUNT * mixMean + 1 - AMOUNT * C0;
    const src = outMean / gain;
    const center = (AMOUNT * mixMean + 1 - TARGET_MEAN / src) / AMOUNT;

    return {
      mixMean: +mixMean.toFixed(3),
      src: +(src / 255).toFixed(3),
      outAt0625: +outMean.toFixed(1),
      center: +center.toFixed(3),
    };
  };

  const shots = [];
  const calibration = [];
  for (const [index, candidate] of CANDIDATES.entries()) {
    const fit = await calibrate(candidate);
    calibration.push({ name: candidate.name, ...fit });
    const image = await render(candidate, fit.center);
    const file = path.join(__dirname, `root-${index}.png`);
    fs.writeFileSync(file, image.toPNG());
    shots.push({ name: candidate.name, file, center: fit.center, mean: +meanOf(image).toFixed(1) });
  }

  // 拼条：参考图放最左，方便同尺度对比。
  const row = path.join(__dirname, 'root-row.png');
  const H = 640;
  const inputs = [path.join(__dirname, '..', 'measure', 'tag-raw.png'), ...shots.map(s => s.file)];
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...inputs.flatMap(f => ['-i', f]),
    '-filter_complex',
    inputs.map((_, i) => `[${i}:v]scale=-2:${H}:flags=lanczos[v${i}]`).join(';') +
      ';' + inputs.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${inputs.length}`,
    '-frames:v', '1', row,
  ]);

  report({ rect, shots, row, calibration });
});
