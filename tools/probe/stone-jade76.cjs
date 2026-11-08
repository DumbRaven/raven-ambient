/**
 * 玉石第 75 轮：结构定在 j74 的 x4/x6，只扫亮度。
 *
 * j74 已经证明结构对了（判据是 `tools/measure/blobs.cjs` 的暗区连通性）：
 *
 *   参考图   large 0.908  blobs 30  直径 p50 2.5 p75 4.2 p95 33.8
 *   j76-x4   large 0.887  blobs 30  直径 p50 3.4 p75 7.9 p95 30.0
 *   j76-x6   large 0.900  blobs 26  直径 p50 3.2 p75 12.3 p95 24.7
 *
 * 剩下唯一没对上的是**均值**：x4 是 124.9、x6 是 119.8，参考图 133.2。
 * 所以这一轮只动末尾的 `offset`（每 0.012 抬 3 个亮度），结构一律照抄。
 *
 * 跑法（源码不用改）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/stone-jade75.cjs --no-sandbox
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

const foldTable = (rings, sharp, lo, hi) => {
  const n = Math.max(160, 64 * rings + 1);
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

const BASE = { bgLo: 0.66, bgHi: 0.90, bgSharp: 5, gain: 0.62, offset: 0.045 };

const CANDIDATES = [
  {
    name: 'g1',
    ...BASE,
    gain: 0.46,
    offset: 0.1927,
    main: {"freq":"0.018 0.025","seed":23,"rings":1,"sharp":4.5,"lo":0.05,"hi":0.94},
    sub: {"freq":"0.080 0.108","seed":67,"rings":1,"sharp":14,"lo":0.28,"hi":0.92},
    mainBlur: 1.8, subBlur: 0.55, veinW: 0.78,
    warp: '0.011 0.008', warpSeed: 31, warpScale: 62,
  },
  {
    name: 'g2',
    ...BASE,
    gain: 0.48,
    offset: 0.1783,
    main: {"freq":"0.018 0.025","seed":23,"rings":1,"sharp":4.5,"lo":0.05,"hi":0.94},
    sub: {"freq":"0.080 0.108","seed":67,"rings":1,"sharp":14,"lo":0.28,"hi":0.92},
    mainBlur: 1.8, subBlur: 0.55, veinW: 0.78,
    warp: '0.011 0.008', warpSeed: 31, warpScale: 62,
  },
  {
    name: 'g3',
    ...BASE,
    gain: 0.5,
    offset: 0.164,
    main: {"freq":"0.018 0.025","seed":23,"rings":1,"sharp":4.5,"lo":0.05,"hi":0.94},
    sub: {"freq":"0.080 0.108","seed":67,"rings":1,"sharp":14,"lo":0.28,"hi":0.92},
    mainBlur: 1.8, subBlur: 0.55, veinW: 0.78,
    warp: '0.011 0.008', warpSeed: 31, warpScale: 62,
  },
  {
    name: 'g4',
    ...BASE,
    gain: 0.52,
    offset: 0.1497,
    main: {"freq":"0.018 0.025","seed":23,"rings":1,"sharp":4.5,"lo":0.05,"hi":0.94},
    sub: {"freq":"0.080 0.108","seed":67,"rings":1,"sharp":14,"lo":0.28,"hi":0.92},
    mainBlur: 1.8, subBlur: 0.55, veinW: 0.78,
    warp: '0.011 0.008', warpSeed: 31, warpScale: 62,
  },
  {
    name: 'g5',
    ...BASE,
    gain: 0.54,
    offset: 0.1353,
    main: {"freq":"0.018 0.025","seed":23,"rings":1,"sharp":4.5,"lo":0.05,"hi":0.94},
    sub: {"freq":"0.080 0.108","seed":67,"rings":1,"sharp":14,"lo":0.28,"hi":0.92},
    mainBlur: 1.8, subBlur: 0.55, veinW: 0.78,
    warp: '0.011 0.008', warpSeed: 31, warpScale: 62,
  },
  {
    name: 'g6',
    ...BASE,
    gain: 0.56,
    offset: 0.121,
    main: {"freq":"0.018 0.025","seed":23,"rings":1,"sharp":4.5,"lo":0.05,"hi":0.94},
    sub: {"freq":"0.080 0.108","seed":67,"rings":1,"sharp":14,"lo":0.28,"hi":0.92},
    mainBlur: 1.8, subBlur: 0.55, veinW: 0.78,
    warp: '0.011 0.008', warpSeed: 31, warpScale: 62,
  },
];

function build(c) {
  const vein = (name, cfg) => {
    const table = foldTable(cfg.rings, cfg.sharp, cfg.lo, cfg.hi);
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
  const bgTable = foldTable(1, c.bgSharp, c.bgLo, c.bgHi);
  const rgb = TINT.map(v => (c.offset + v).toFixed(3));
  const tail =
    `<feColorMatrix type="matrix" result="out" values="` +
    `${c.gain.toFixed(3)} 0 0 0 ${rgb[0]} ` +
    `0 ${c.gain.toFixed(3)} 0 0 ${rgb[1]} ` +
    `0 0 ${c.gain.toFixed(3)} 0 ${rgb[2]} ` +
    `0 0 0 1 0"></feColorMatrix>`;

  return (
    `<svg width="300" height="300"><filter id="tpl-marble" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">` +
    vein('vm', c.main) +
    vein('vs', c.sub) +
    `<feTurbulence type="fractalNoise" baseFrequency="${c.warp}" numOctaves="2" seed="${c.warpSeed}" result="wn"/>` +
    '<feColorMatrix in="wn" type="saturate" values="0" result="wg"/>' +
    `<feDisplacementMap in="vmc" in2="wg" scale="${c.warpScale}" xChannelSelector="R" yChannelSelector="G" result="vmb"/>` +
    `<feDisplacementMap in="vsc" in2="wg" scale="${c.warpScale}" xChannelSelector="R" yChannelSelector="G" result="vsb"/>` +
    `<feGaussianBlur in="vmb" stdDeviation="${c.mainBlur}" result="vmf"/>` +
    `<feGaussianBlur in="vsb" stdDeviation="${c.subBlur}" result="vsf"/>` +
    `<feComposite in="vmf" in2="vsf" operator="arithmetic" k1="0" k2="${c.veinW.toFixed(2)}" k3="${(1 - c.veinW).toFixed(2)}" k4="0" result="vv"/>` +
    '<feTurbulence type="turbulence" baseFrequency="0.006 0.0044" numOctaves="2" seed="41" result="bn"/>' +
    '<feColorMatrix in="bn" type="saturate" values="0" result="bg"/>' +
    `<feComponentTransfer in="bg" result="bgt">` +
    `<feFuncR type="table" tableValues="${bgTable}"/>` +
    `<feFuncG type="table" tableValues="${bgTable}"/>` +
    `<feFuncB type="table" tableValues="${bgTable}"/>` +
    `<feFuncA type="linear" slope="0" intercept="1"/>` +
    `</feComponentTransfer>` +
    '<feGaussianBlur in="bgt" stdDeviation="2.2" result="bc"/>' +
    `<feComposite in="vv" in2="bc" operator="arithmetic" k1="0" k2="0.42" k3="0.58" k4="0" result="mix"/>` +
    tail +
    '</filter></svg>'
  );
}

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
    const out = path.join(__dirname, `j76-${String(i).padStart(2, '0')}-${c.name}.png`);
    fs.writeFileSync(out, image.toPNG());
    shots.push({ name: c.name, file: out });
  }

  const ref = path.join(__dirname, '..', 'measure', 'tag-raw.png');
  const all = [ref, ...shots.map(s => s.file)];
  const row = path.join(__dirname, 'j76-row.png');
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
