/**
 * 玉石第 69 轮：把极性翻过来——参考图是「亮底 + 暗斑」，我做成了「暗底 + 亮斑」。
 *
 * 怎么发现的：`tools/measure/hist-round.cjs`（按胶囊自身圆角造掩膜，两边同一口径）。
 *
 *   参考图   峰在 136（亮端），向左拖尾到 96~112   skew −0.55   mean 133.2  sd 9.7
 *   我做的   峰在 112~120（偏暗），向右拖尾到 144~152   skew +0.90   mean 127.3  sd 9.8
 *
 * sd 几乎一样（9.7 vs 9.8），差别只在**哪一边有尾巴**。之前所有轮次都在这条反了的
 * 路上调形状，所以怎么调都「看着平」——亮斑散在暗底上，眼睛读不出「玉」。
 *
 * 改法：
 *   1. 背景层与纹路层都用「大部分像素落在 `hi`（亮），少数峰落在 `lo`（暗）」的
 *      折叠表——这一点原本就是对的，问题出在**遮罩把两者搅成了中间调**。
 *   2. 去掉遮罩 lerp，改成**加权平均**（`k2=w, k3=1-w`）：两层都偏亮时，
 *      混合结果也偏亮，只在丝与暗斑处下拉，直方图自然变成「单峰 + 左拖尾」。
 *   3. 收尾的 `gain/offset` 把 0.53 对准 136/255。
 *
 * 跑法（源码不用改）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/stone-jade69.cjs --no-sandbox
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

const CENTER = 0.625;
const squeeze = (lo, hi, k) => [CENTER + (lo - CENTER) * k, CENTER + (hi - CENTER) * k];

const foldTable = (rings, sharp, lo, hi) => {
  const n = Math.max(128, 48 * rings + 1);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const v = i / (n - 1);
    const peak = Math.abs(Math.sin(v * rings * Math.PI)) ** sharp;
    out.push((hi - peak * (hi - lo)).toFixed(4));
  }
  return out.join(' ');
};

/** 蓝红差 ≈ 0.10。 */
const TINT = [-0.050, -0.008, 0.057];

function build(c) {
  const vein = (name, cfg, k) => {
    const [lo, hi] = squeeze(cfg.lo, cfg.hi, k);
    const table = foldTable(cfg.rings, cfg.sharp, lo, hi);
    return (
      `<feTurbulence type="turbulence" baseFrequency="${cfg.freq}" numOctaves="2" seed="${cfg.seed}" result="${name}n"></feTurbulence>` +
      `<feColorMatrix in="${name}n" type="saturate" values="0" result="${name}g"></feColorMatrix>` +
      `<feComponentTransfer in="${name}g" result="${name}c">` +
      `<feFuncR type="table" tableValues="${table}"/>` +
      `<feFuncG type="table" tableValues="${table}"/>` +
      `<feFuncB type="table" tableValues="${table}"/>` +
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer>`
    );
  };
  const bgTable = foldTable(1, 4.0, c.bgLo, c.bgHi);
  const rgb = TINT.map(v => (c.offset + v).toFixed(3));
  const tail =
    `<feColorMatrix type="matrix" result="out" values="` +
    `${c.gain.toFixed(3)} 0 0 0 ${rgb[0]} ` +
    `0 ${c.gain.toFixed(3)} 0 0 ${rgb[1]} ` +
    `0 0 ${c.gain.toFixed(3)} 0 ${rgb[2]} ` +
    `0 0 0 1 0"></feColorMatrix>`;

  return (
    `<svg width="300" height="300"><filter id="tpl-marble" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">` +
    vein('vm', c.main, c.veinK) +
    vein('vs', c.sub, c.veinK) +
    '<feTurbulence type="fractalNoise" baseFrequency="0.006 0.004" numOctaves="2" seed="31" result="wn"/>' +
    '<feColorMatrix in="wn" type="saturate" values="0" result="wg"/>' +
    '<feDisplacementMap in="vmc" in2="wg" scale="20" xChannelSelector="R" yChannelSelector="G" result="vmb"/>' +
    '<feDisplacementMap in="vsc" in2="wg" scale="20" xChannelSelector="R" yChannelSelector="G" result="vsb"/>' +
    `<feGaussianBlur in="vmb" stdDeviation="${c.mainBlur}" result="vmf"/>` +
    `<feGaussianBlur in="vsb" stdDeviation="${c.subBlur}" result="vsf"/>` +
    '<feComposite in="vmf" in2="vsf" operator="arithmetic" k1="0" k2="0.62" k3="0.38" k4="0" result="vv"/>' +
    '<feTurbulence type="turbulence" baseFrequency="0.006 0.0044" numOctaves="2" seed="41" result="bn"/>' +
    '<feColorMatrix in="bn" type="saturate" values="0" result="bg"/>' +
    `<feComponentTransfer in="bg" result="bgt">` +
    `<feFuncR type="table" tableValues="${bgTable}"/>` +
    `<feFuncG type="table" tableValues="${bgTable}"/>` +
    `<feFuncB type="table" tableValues="${bgTable}"/>` +
    `<feFuncA type="linear" slope="0" intercept="1"/>` +
    `</feComponentTransfer>` +
    '<feGaussianBlur in="bgt" stdDeviation="2.2" result="bc"/>' +
    // 加权平均：两层都偏亮，只在丝与暗斑处下拉 → 单峰 + 左拖尾。
    `<feComposite in="vv" in2="bc" operator="arithmetic" k1="0" k2="${c.veinW.toFixed(2)}" k3="${(1 - c.veinW).toFixed(2)}" k4="0" result="mix"/>` +
    tail +
    '</filter></svg>'
  );
}

/**
 * `bgHi` 定「亮底有多亮」、`bgLo` 定「暗斑有多深」；`sharp 4` 让暗斑占比小。
 * `veinK` 是丝相对底色的落差，`veinW` 是丝在最终画面里的权重。
 */
const CANDIDATES = [
  {
    name: 's1',
    main: { freq: '0.038 0.052', seed: 23, rings: 1, sharp: 1.4, lo: 0.52, hi: 0.94 },
    sub: { freq: '0.064 0.088', seed: 67, rings: 1, sharp: 1.7, lo: 0.60, hi: 0.90 },
    mainBlur: 1.1, subBlur: 0.8, veinK: 1.0, veinW: 0.40,
    bgLo: 0.34, bgHi: 0.94, gain: 0.520, offset: 0.230,
  },
  {
    name: 's2',
    main: { freq: '0.038 0.052', seed: 23, rings: 1, sharp: 1.4, lo: 0.46, hi: 0.96 },
    sub: { freq: '0.064 0.088', seed: 67, rings: 1, sharp: 1.7, lo: 0.56, hi: 0.92 },
    mainBlur: 1.1, subBlur: 0.8, veinK: 1.0, veinW: 0.45,
    bgLo: 0.24, bgHi: 0.96, gain: 0.520, offset: 0.230,
  },
  {
    name: 's3',
    main: { freq: '0.038 0.052', seed: 23, rings: 1, sharp: 1.5, lo: 0.50, hi: 0.95 },
    sub: { freq: '0.064 0.088', seed: 67, rings: 1, sharp: 1.8, lo: 0.58, hi: 0.91 },
    mainBlur: 1.0, subBlur: 0.7, veinK: 0.9, veinW: 0.35,
    bgLo: 0.18, bgHi: 0.95, gain: 0.540, offset: 0.220,
  },
  {
    name: 's4',
    main: { freq: '0.030 0.041', seed: 23, rings: 1, sharp: 1.6, lo: 0.48, hi: 0.96 },
    sub: { freq: '0.052 0.072', seed: 67, rings: 1, sharp: 1.9, lo: 0.56, hi: 0.92 },
    mainBlur: 1.2, subBlur: 0.9, veinK: 1.0, veinW: 0.42,
    bgLo: 0.26, bgHi: 0.96, gain: 0.500, offset: 0.245,
  },
  {
    name: 's5',
    main: { freq: '0.044 0.060', seed: 23, rings: 1, sharp: 1.4, lo: 0.54, hi: 0.95 },
    sub: { freq: '0.072 0.099', seed: 67, rings: 1, sharp: 1.7, lo: 0.62, hi: 0.91 },
    mainBlur: 1.0, subBlur: 0.7, veinK: 0.9, veinW: 0.38,
    bgLo: 0.30, bgHi: 0.95, gain: 0.540, offset: 0.215,
  },
  {
    name: 's6',
    main: { freq: '0.038 0.052', seed: 23, rings: 1, sharp: 1.4, lo: 0.50, hi: 0.94 },
    sub: { freq: '0.064 0.088', seed: 67, rings: 1, sharp: 1.7, lo: 0.58, hi: 0.90 },
    mainBlur: 1.1, subBlur: 0.8, veinK: 1.0, veinW: 0.30,
    bgLo: 0.30, bgHi: 0.94, gain: 0.560, offset: 0.205,
  },
];

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });
  const steps = [];
  const run = async (label, script) => {
    try {
      const value = await probe.run(script);
      steps.push({ label, ok: true });
      return value;
    } catch (e) {
      steps.push({ label, ok: false, error: String(e.message || e).slice(0, 200) });
      return null;
    }
  };

  await run('open', OPEN);
  await wait(240);
  await run('pick', PICK_JADE);
  await wait(520);

  const rect = await run('rect', `(() => {
    const r = document.querySelector('.tpl-tag').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);
  const [x, y, w, h] = rect ?? [0, 0, 0, 0];
  const pad = 4;

  const shots = [];
  for (const [i, c] of CANDIDATES.entries()) {
    const markup = build(c);
    await run(`apply-${c.name}`, `(() => {
      const host = document.querySelector('[data-tpl-marble]');
      if (host) host.innerHTML = ${JSON.stringify(markup)};
      let st = document.getElementById('stone-try');
      if (!st) { st = document.createElement('style'); st.id = 'stone-try'; document.head.appendChild(st); }
      st.textContent = '.template-collage[data-stone="jade"] .tpl-tag::before { opacity: 1 !important; }';
      return true;
    })()`);
    await wait(340);
    const image = await probe.win.webContents.capturePage({
      x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: w + pad * 2, height: h + pad * 2,
    });
    const out = path.join(__dirname, `j69-${String(i).padStart(2, '0')}-${c.name}.png`);
    fs.writeFileSync(out, image.toPNG());
    shots.push({ name: c.name, file: out });
  }

  const ref = path.join(__dirname, '..', 'measure', 'tag-raw.png');
  const all = [ref, ...shots.map(s => s.file)];
  const row = path.join(__dirname, 'j69-row.png');
  const H = 900;
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...all.flatMap(f => ['-i', f]),
    '-filter_complex',
    all.map((_, i) => `[${i}:v]scale=-2:${H}:flags=lanczos[v${i}]`).join(';') +
      ';' + all.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${all.length}`,
    '-frames:v', '1', row,
  ]);

  report({ steps, shots, row });
});
