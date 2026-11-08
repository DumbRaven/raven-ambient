/**
 * 玉石第 74 轮：把「麻点」变成「大团」，判据是暗区连通块。
 *
 * 上一轮（j73）三项统计全部命中参考图：
 *
 *   参考图  mean 133.2  sd 9.7  skew −0.55
 *   j73-w1  mean 133.3  sd 9.4  skew −0.44
 *
 * 并排看却完全不同：参考图是**几大片晕开的暗团**，w1 是**几百个麻点**。
 * 直方图只统计「多少像素多亮」，完全不关心「它们挨不挨着」，
 * 所以「一片 100px 的暗团」和「100 个 10px 的点」在它眼里一模一样。
 *
 * 新判据 `tools/measure/blobs.cjs`（阈值取图中位数，4 邻接连通域）：
 *
 *   参考图  暗区 0.498  ≥12px 大块占暗区 **0.908**  块数 30  直径 p95 **33.8**
 *   j73-w1  暗区 0.504  ≥12px 大块占暗区 **0.742**  块数 46  直径 p95 **15.9**
 *
 * 结论：暗部要**连成长条大团**，不能靠 `sharp` 做窄点。
 * `sharp` 越高、点越窄，连通性越差——j71/j72 那条把 skew 调对的路，
 * 正是让暗部碎掉的原因。这一轮反过来：
 *
 *   ① 主纹频率降到 0.016~0.022（周期 45~63px），`sharp` 只到 3~4，
 *      让它出**宽而连续的暗带**；
 *   ② 位移场加强（`scale 45~60`）并把它的频率提到 0.010~0.014，
 *      把暗带揉成不规则的长团，而不是规整的等值线；
 *   ③ 细层保留但权重压低（`veinW` 里细层占 0.2~0.3），只贡献边缘的碎边，
 *      不参与「暗区主体」。
 *
 * 跑法（源码不用改）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/stone-jade74.cjs --no-sandbox
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
    name: 'x1', ...BASE,
    main: { freq: '0.020 0.028', seed: 23, rings: 1, sharp: 3.0, lo: 0.10, hi: 0.92 },
    sub: { freq: '0.070 0.095', seed: 67, rings: 1, sharp: 12, lo: 0.30, hi: 0.90 },
    mainBlur: 1.4, subBlur: 0.6, veinW: 0.74,
    warp: '0.012 0.008', warpSeed: 31, warpScale: 55,
  },
  {
    name: 'x2', ...BASE,
    main: { freq: '0.016 0.022', seed: 23, rings: 1, sharp: 3.5, lo: 0.06, hi: 0.92 },
    sub: { freq: '0.070 0.095', seed: 67, rings: 1, sharp: 12, lo: 0.30, hi: 0.90 },
    mainBlur: 1.6, subBlur: 0.6, veinW: 0.76,
    warp: '0.010 0.007', warpSeed: 31, warpScale: 60,
  },
  {
    name: 'x3', ...BASE,
    main: { freq: '0.022 0.030', seed: 11, rings: 1, sharp: 4.0, lo: 0.08, hi: 0.93 },
    sub: { freq: '0.064 0.088', seed: 67, rings: 1, sharp: 12, lo: 0.30, hi: 0.90 },
    mainBlur: 1.3, subBlur: 0.6, veinW: 0.72,
    warp: '0.014 0.010', warpSeed: 55, warpScale: 50,
  },
  {
    name: 'x4', ...BASE,
    main: { freq: '0.018 0.025', seed: 23, rings: 1, sharp: 4.5, lo: 0.05, hi: 0.94 },
    sub: { freq: '0.080 0.108', seed: 67, rings: 1, sharp: 14, lo: 0.28, hi: 0.92 },
    mainBlur: 1.8, subBlur: 0.55, veinW: 0.78,
    warp: '0.011 0.008', warpSeed: 31, warpScale: 62,
  },
  {
    name: 'x5', ...BASE,
    main: { freq: '0.014 0.019', seed: 23, rings: 1, sharp: 3.0, lo: 0.08, hi: 0.92 },
    sub: { freq: '0.060 0.082', seed: 67, rings: 1, sharp: 12, lo: 0.32, hi: 0.90 },
    mainBlur: 1.7, subBlur: 0.7, veinW: 0.74,
    warp: '0.009 0.006', warpSeed: 31, warpScale: 58,
  },
  {
    name: 'x6', ...BASE,
    main: { freq: '0.019 0.026', seed: 29, rings: 1, sharp: 3.6, lo: 0.07, hi: 0.93 },
    sub: { freq: '0.072 0.098', seed: 47, rings: 1, sharp: 13, lo: 0.30, hi: 0.91 },
    mainBlur: 1.5, subBlur: 0.6, veinW: 0.75,
    warp: '0.012 0.009', warpSeed: 71, warpScale: 56,
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
    const out = path.join(__dirname, `j74-${String(i).padStart(2, '0')}-${c.name}.png`);
    fs.writeFileSync(out, image.toPNG());
    shots.push({ name: c.name, file: out });
  }

  const ref = path.join(__dirname, '..', 'measure', 'tag-raw.png');
  const all = [ref, ...shots.map(s => s.file)];
  const row = path.join(__dirname, 'j74-row.png');
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
