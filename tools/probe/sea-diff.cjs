/**
 * 为什么「探针里好好的浪脊」一装进源码就变成一张白板。
 *
 * 现象：`stone-sea.cjs` 扫出来 t2 是 `tex mean 127 / final sd 11.2`，
 * 但同一组参数写进 `SEA_SPEC` 之后，实机 `tag-stats` 量到
 * `mean 205.5 / sd 4.55` —— 亮成一片。
 *
 * 这个探针把**两份 markup 放在同一个窗口里量**：
 *   a. 源码 `marbleFilterMarkup('sea')` 生成的；
 *   b. `stone-sea.cjs` 里 `buildMarkup` 按同一组参数重建的。
 * 两份都以「只输出纹理」的形式装上去，直接比 mean / sd。
 * 一样 → 之前那轮数字是旧的；不一样 → 重建那份有偏差，得修探针。
 *
 * 跑法：node_modules/electron/dist/electron.exe tools/probe/sea-diff.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launch, report, guard, wait } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..', '..');

/** 与 `stone-sea.cjs` 的 t2 完全一致。 */
const T2 = { fx: '0.004', fy: '0.018', width: 0.18, blur: [3.2, 1.0, 0.5] };

function rebuilt(cand) {
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
  return (
    `<svg width="300" height="300"><filter id="tpl-marble" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    layers.map((cfg, i) => one(`v${i}`, cfg)).join('') +
    `<feTurbulence type="fractalNoise" baseFrequency="${cand.fx} ${cand.fy}" numOctaves="2" seed="31" result="wn"/>` +
    '<feColorMatrix in="wn" type="saturate" values="0" result="wg"/>' +
    layers.map((_, i) => `<feDisplacementMap in="v${i}t" in2="wg" scale="58" xChannelSelector="R" yChannelSelector="G" result="v${i}b"/>`).join('') +
    layers.map((cfg, i) => `<feGaussianBlur in="v${i}b" stdDeviation="${cfg.blur}" result="v${i}f"/>`).join('') +
    '<feComposite in="v0f" in2="v1f" operator="arithmetic" k1="0" k2="0.46" k3="0.32" k4="0" result="s1"/>' +
    '<feComposite in="s1" in2="v2f" operator="arithmetic" k1="0" k2="0.78" k3="0.22" k4="0" result="mix"/>' +
    '</filter></svg>'
  );
}

const truncate = markup =>
  markup
    .replace(/<feComponentTransfer in="mix"[\s\S]*?<\/feComponentTransfer>/, '')
    .replace(/<feComposite in="SourceGraphic"[^>]*\/>/, '')
    .replace('result="mix"', 'result="out"');

guard(async () => {
  const { marbleFilterMarkup } = await import(pathToFileURL(path.join(ROOT, 'src', 'marble.ts')).href);
  const fromSource = truncate(marbleFilterMarkup('sea'));
  const fromProbe = rebuilt(T2);

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
      if (red - blue > 26 && red > 96) continue;
      values.push(0.299 * red + 0.587 * green + 0.114 * blue);
    }
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    return { mean: +mean.toFixed(2), sd: +sd.toFixed(2), n };
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
    await wait(400);
  };

  const out = [];
  for (const [label, markup] of [['source', fromSource], ['rebuilt', fromProbe]]) {
    await apply(markup);
    const file = path.join(__dirname, `sea-diff-${label}.png`);
    fs.writeFileSync(file, (await probe.win.webContents.capturePage({ x, y, width: w, height: h })).toPNG());
    out.push({ label, ...(await sample()), file });
  }

  report({ rect, samples: out, sameString: fromSource === fromProbe, lens: [fromSource.length, fromProbe.length] });
});
