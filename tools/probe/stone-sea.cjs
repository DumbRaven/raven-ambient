/**
 * 浪脊改成等值带之后，重新找它的参数。
 *
 * 为什么必须重扫：`center` / `amount` 是按**纹理实际分布**标定的，
 * 玉石的（0.562 / 0.072）换到浪脊上完全不适用——实测浪脊纹理
 * mean 0.848 / sd 0.024，用同一个 center 0.54 会让
 * `lit = 1.6*(0.848-0.54)+1 = 1.49`，整块被钳在 1，屏幕上是白的。
 *
 * 所以这里对每个候选做三件事（全部在同一个窗口里，不改源码）：
 *   1. 截断管线，量纹理自己的 mean / sd；
 *   2. 用 center = mean、amount = 1 跑一遍，量输出 sd（即「每单位 amount 的对比度」）；
 *   3. 由目标 sd 反解 amount，填进去再截一次图。
 *
 * 跑法：node_modules/electron/dist/electron.exe tools/probe/stone-sea.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { launch, report, guard, wait } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..', '..');

/** 目标：参考图那块胶囊的对比度（`tag-stats.cjs` 口径，0~255 亮度）。 */
const TARGET_SD = 12.2;

/**
 * 第二轮：s5（0.004/0.018、width 0.12）已经出横向波浪、对比度也对上了
 * （final mean 125.2 / sd 10.86，玉石是 125.2 / 11.40），
 * 但看图偏细碎，像水面涟漪而不是「一层压一层的浪脊」。
 *
 * 只动两件事：把带宽加大（层更厚）、把主干模糊加大（边缘更晕）。
 * 频率锁在 s5，波纹走向不变。
 */
const CANDIDATES = [
  { name: 't1 s5 原样', fx: '0.004', fy: '0.018', width: 0.12, blur: [2.8, 0.9, 0.45] },
  { name: 't2 更厚', fx: '0.004', fy: '0.018', width: 0.18, blur: [3.2, 1.0, 0.5] },
  { name: 't3 更厚更晕', fx: '0.004', fy: '0.018', width: 0.18, blur: [4.0, 1.3, 0.6] },
  { name: 't4 低频长浪', fx: '0.003', fy: '0.012', width: 0.20, blur: [3.6, 1.2, 0.55] },
  { name: 't5 中频厚浪', fx: '0.005', fy: '0.020', width: 0.16, blur: [3.2, 1.0, 0.5] },
  { name: 't6 很厚', fx: '0.004', fy: '0.016', width: 0.26, blur: [4.2, 1.4, 0.7] },
];

/**
 * 按候选拼出完整管线（与 marble.ts 的 bandMarkup 同构，只是参数可换）。
 * 之所以不复用源码那份：那边参数写死在 SEA_SPEC / JADE_SPEC 里，
 * 这里要扫的是「参数本身」，得能改。
 */
function buildMarkup(id, cand, { center, amount }) {
  const band = (lo, hi, width, samples = 160) => {
    const out = [];
    for (let i = 0; i < samples; i += 1) {
      const unit = i / (samples - 1);
      const offset = (unit - 0.5) / width;
      out.push((hi - (hi - lo) * Math.exp(-offset * offset)).toFixed(4));
    }
    return out.join(' ');
  };

  const layers = [
    { freq: `${cand.fx} ${cand.fy}`, seed: 23, width: cand.width, lo: 0.0, hi: 0.9, blur: cand.blur[0], weight: 0.46 },
    { freq: `${cand.fx * 2.2} ${cand.fy * 2.2}`, seed: 67, width: cand.width * 0.19, lo: 0.22, hi: 0.9, blur: cand.blur[1], weight: 0.32 },
    { freq: `${cand.fx * 3.8} ${cand.fy * 3.8}`, seed: 91, width: cand.width * 0.075, lo: 0.30, hi: 0.9, blur: cand.blur[2], weight: 0.22 },
  ];

  const one = (name, cfg) =>
    `<feTurbulence type="fractalNoise" baseFrequency="${cfg.freq}" numOctaves="2" seed="${cfg.seed}" result="${name}n"/>` +
    `<feColorMatrix in="${name}n" type="saturate" values="0" result="${name}g"/>` +
    `<feComponentTransfer in="${name}g" result="${name}t">` +
    `<feFuncR type="table" tableValues="${band(cfg.lo, cfg.hi, cfg.width)}"/>` +
    `<feFuncG type="table" tableValues="${band(cfg.lo, cfg.hi, cfg.width)}"/>` +
    `<feFuncB type="table" tableValues="${band(cfg.lo, cfg.hi, cfg.width)}"/>` +
    `<feFuncA type="linear" slope="0" intercept="1"/>` +
    `</feComponentTransfer>`;

  const lit = (1 - amount * center).toFixed(3);
  return (
    `<svg width="300" height="300"><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    layers.map((cfg, i) => one(`v${i}`, cfg)).join('') +
    `<feTurbulence type="fractalNoise" baseFrequency="${cand.fx} ${cand.fy}" numOctaves="2" seed="31" result="wn"/>` +
    '<feColorMatrix in="wn" type="saturate" values="0" result="wg"/>' +
    layers.map((_, i) => `<feDisplacementMap in="v${i}t" in2="wg" scale="58" xChannelSelector="R" yChannelSelector="G" result="v${i}b"/>`).join('') +
    layers.map((cfg, i) => `<feGaussianBlur in="v${i}b" stdDeviation="${cfg.blur}" result="v${i}f"/>`).join('') +
    '<feComposite in="v0f" in2="v1f" operator="arithmetic" k1="0" k2="0.46" k3="0.32" k4="0" result="s1"/>' +
    '<feComposite in="s1" in2="v2f" operator="arithmetic" k1="0" k2="0.78" k3="0.22" k4="0" result="mix"/>' +
    '<feComponentTransfer in="mix" result="lit">' +
    `<feFuncR type="linear" slope="${amount}" intercept="${lit}"/>` +
    `<feFuncG type="linear" slope="${amount}" intercept="${lit}"/>` +
    `<feFuncB type="linear" slope="${amount}" intercept="${lit}"/>` +
    '<feFuncA type="linear" slope="0" intercept="1"/>' +
    '</feComponentTransfer>' +
    '<feComposite in="SourceGraphic" in2="lit" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="out"/>' +
    '</filter></svg>'
  );
}

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });
  const run = code => probe.run(code);

  const rect = await run(`(() => {
    const r = document.querySelector('.tpl-tag').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);
  const [x, y, w, h] = rect ?? [0, 0, 0, 0];

  const sample = async () => {
    const image = await probe.win.webContents.capturePage({
      x: Math.round(x + w * 0.25), y: Math.round(y + h * 0.2),
      width: Math.max(1, Math.round(w * 0.5)), height: Math.max(1, Math.round(h * 0.6)),
    });
    const bitmap = image.toBitmap();
    const values = [];
    for (let i = 0; i < bitmap.length; i += 4) {
      const red = bitmap[i + 2], green = bitmap[i + 1], blue = bitmap[i];
      if (red - blue > 26 && red > 96) continue; // 金色字母
      values.push(0.299 * red + 0.587 * green + 0.114 * blue);
    }
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    return { mean: +mean.toFixed(2), sd: +sd.toFixed(2) };
  };

  /**
   * 连拍直到连续两帧一样。
   *
   * **这一条是被坑出来的**：换完滤镜要先等一次重绘，第一次 `capturePage`
   * 常常抓到的是**上一帧**——也就是「还没换过去」的那张图。现象极容易误读：
   * 第一档读到了 APP 自己的输出（亮白），我当成「这一档的纹理就是这么亮」，
   * 于是后面每一档的 center 都按错位一档的值算。
   */
  const settle = async (label = '') => {
    let prev = await sample();
    for (let i = 0; i < 12; i += 1) {
      await wait(160);
      const now = await sample();
      if (Math.abs(now.mean - prev.mean) < 0.4 && Math.abs(now.sd - prev.sd) < 0.4) return now;
      prev = now;
    }
    return prev;
  };

  const apply = async markup => {
    const flat = markup.replace(/\s+/g, ' ').trim();
    await run(`(() => {
      document.querySelectorAll('[data-tpl-marble]').forEach(n => n.remove());
      const host = document.createElement('div');
      host.setAttribute('data-tpl-marble', 'try');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0';
      host.innerHTML = ${JSON.stringify(flat)};
      document.body.appendChild(host);
    })()`);
    await wait(200);
  };

  /** 先把管线截断成「只输出纹理」。 */
  const truncate = markup =>
    markup
      .replace(/<feComponentTransfer in="mix"[\s\S]*?<\/feComponentTransfer>/, '')
      .replace(/<feComposite in="SourceGraphic"[^>]*\/>/, '')
      .replace('result="mix"', 'result="out"');

  const rows = [];
  for (const cand of CANDIDATES) {
    // 1. 纹理自身的分布
    await apply(truncate(buildMarkup('tpl-marble', cand, { center: 0.5, amount: 1 })));
    const tex = await settle();
    const center = +(tex.mean / 255).toFixed(3);

    // 2. amount = 1 时的输出对比度 ⇒ 每单位 amount 的增益
    await apply(buildMarkup('tpl-marble', cand, { center, amount: 1 }));
    const unit = await settle();
    const amount = +(TARGET_SD / Math.max(0.1, unit.sd)).toFixed(2);

    // 3. 反解出来的 amount 跑一次，确认
    await apply(buildMarkup('tpl-marble', cand, { center, amount }));
    const final = await settle();

    rows.push({ ...cand, tex, center, amount, unitSd: unit.sd, final });
    rows[rows.length - 1].file = path.join(__dirname, `sea-${cand.name.slice(0, 2)}.png`);
    fs.writeFileSync(
      rows[rows.length - 1].file,
      (await probe.win.webContents.capturePage({ x, y, width: w, height: h })).toPNG(),
    );
  }

  const row = path.join(__dirname, 'sea-row.png');
  const files = rows.map(r => r.file);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...files.flatMap(f => ['-i', f]),
    '-filter_complex',
    files.map((_, i) => `[${i}:v]scale=-2:520:flags=lanczos[v${i}]`).join(';') +
      ';' + files.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${files.length}`,
    '-frames:v', '1', row,
  ]);

  report({ rect, rows, row });
});
