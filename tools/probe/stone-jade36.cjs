/**
 * 玉石第三十六轮：把上一轮磨掉的对比度找回来。
 *
 * 【j35 错在哪】为了「让边界软下来」把 `stdDeviation` 加到 1.4~2.8，
 * 同时 `opacity` 只有 0.26~0.34。结果七格并排一看，
 * r1~r6 全成了**一片均匀的浅灰蓝**，比参考图（最左）还平——
 * 参考图的团块**大但清楚**，不是「糊成一片」。
 *
 * 【修正方向】
 *   - 频率保持 0.025~0.030（团块横跨胶囊 1/4 左右，与参考图同量级）。
 *   - 模糊退到 0.5~0.9：只磨掉等值面的硬边，不改结构。
 *   - `opacity` 提到 0.35~0.60：上一轮的错是把「淡」当成了「柔」。
 *     参考图那块是**能看清明暗的**，只是没有边界线。
 *
 * 自检（`templateMatches`）沿用上一轮的结构签名比对：先确认页面里那份
 * 与本地模板结构一致，再动任何一格；对不上就不截图，直接报错。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/stone-jade36.cjs --no-sandbox
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

const CENTER = 0.487;

function jadeMarkup(id, { freq, oct, blur, bigFreq, bigRoom }) {
  const layer = (name, opts) => {
    const { freq: f, octaves, seed, room, warp, warpSeed } = opts;
    const intercept = (CENTER - room / 2).toFixed(3);
    const bend = warp > 0
      ? `<feTurbulence type="fractalNoise" baseFrequency="0.01 0.0069" numOctaves="2" seed="${warpSeed}" result="${name}wn"/>` +
        `<feColorMatrix in="${name}wn" type="saturate" values="0" result="${name}wg"/>` +
        `<feDisplacementMap in="${name}g" in2="${name}wg" scale="${warp}" xChannelSelector="R" yChannelSelector="G" result="${name}b"/>`
      : `<feOffset in="${name}g" dx="0" dy="0" result="${name}b"/>`;
    const soft = blur > 0 ? `<feGaussianBlur in="${name}b" stdDeviation="${blur}" result="${name}s"/>` : '';
    const tail = blur > 0 ? `${name}s` : `${name}b`;
    return (
      `<feTurbulence type="fractalNoise" baseFrequency="${f}" numOctaves="${octaves}" seed="${seed}" result="${name}n"/>` +
      `<feColorMatrix in="${name}n" type="saturate" values="0" result="${name}g"/>` +
      bend +
      soft +
      `<feComponentTransfer in="${tail}" result="${name}">` +
      `<feFuncR type="linear" slope="${room}" intercept="${intercept}"/>` +
      `<feFuncG type="linear" slope="${room}" intercept="${intercept}"/>` +
      `<feFuncB type="linear" slope="${room}" intercept="${intercept}"/>` +
      `<feFuncA type="linear" slope="0" intercept="1"/>` +
      `</feComponentTransfer>`
    );
  };
  return (
    `<svg width="300" height="300"><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    layer('fine', { freq, octaves: oct, seed: 23, room: 1.6, warp: 22, warpSeed: 31 }) +
    layer('big', { freq: bigFreq, octaves: 2, seed: 41, room: bigRoom, warp: 0, warpSeed: 0 }) +
    '<feComposite in="fine" in2="big" operator="arithmetic" k1="0" k2="0.55" k3="0.45" k4="0"/>' +
    '</filter></svg>'
  );
}

const BASE = { freq: '0.062 0.0428', oct: 2, blur: 0, bigFreq: '0.007', bigRoom: 1.2 };

const CANDIDATES = [
  { name: 'now', custom: true },
  { name: 's1', freq: '0.026 0.0179', oct: 2, blur: 0.6, bigFreq: '0.006', bigRoom: 1.6, opacity: 0.36 },
  { name: 's2', freq: '0.026 0.0179', oct: 2, blur: 0.8, bigFreq: '0.006', bigRoom: 1.8, opacity: 0.44 },
  { name: 's3', freq: '0.030 0.0207', oct: 2, blur: 0.6, bigFreq: '0.006', bigRoom: 1.6, opacity: 0.44 },
  { name: 's4', freq: '0.026 0.0179', oct: 2, blur: 0.6, bigFreq: '0.006', bigRoom: 1.8, opacity: 0.52 },
  { name: 's5', freq: '0.022 0.0152', oct: 2, blur: 0.9, bigFreq: '0.005', bigRoom: 2.0, opacity: 0.48 },
  { name: 's6', freq: '0.030 0.0207', oct: 2, blur: 0.7, bigFreq: '0.006', bigRoom: 1.6, opacity: 0.38 },
];

function applyScript(c) {
  const markup = c.custom ? null : jadeMarkup('tpl-marble', c);
  return `(() => {
    const host = document.querySelector('[data-tpl-marble]');
    if (!host) return { error: 'no host' };
    ${markup === null ? '' : `host.innerHTML = ${JSON.stringify(markup)};`}
    let st = document.getElementById('stone-try');
    if (!st) { st = document.createElement('style'); st.id = 'stone-try'; document.head.appendChild(st); }
    st.textContent = ${markup === null ? "''" : JSON.stringify(
      `.template-collage[data-stone="jade"] .tpl-tag::before { opacity: ${c.opacity} !important; }`,
    )};
    const before = getComputedStyle(document.querySelector('.tpl-tag'), '::before');
    const filter = host.querySelector('filter');
    return {
      opacity: before.opacity,
      freqs: [...(filter?.querySelectorAll('feTurbulence') ?? [])].map(n => n.getAttribute('baseFrequency')),
      blurs: [...(filter?.querySelectorAll('feGaussianBlur') ?? [])].map(n => n.getAttribute('stdDeviation')),
    };
  })()`;
}

const sig = html => {
  const out = [];
  for (const match of String(html).matchAll(/<(fe[A-Za-z]+)([^>]*?)\/?>/g)) {
    const attrs = [...match[2].matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)]
      .map(([, k, v]) => `${k}=${v}`)
      .sort()
      .join(' ');
    out.push(`${match[1]} ${attrs}`);
  }
  return out;
};

const SELFTEST = `(() => {
  const host = document.querySelector('[data-tpl-marble]');
  return { html: host?.innerHTML ?? '' };
})()`;

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });
  const steps = [];
  const run = async (label, script) => {
    try {
      return await probe.run(script);
    } catch (e) {
      steps.push({ label, ok: false, error: String(e.message || e).slice(0, 200) });
      return null;
    }
  };

  await run('open', OPEN);
  await wait(240);
  await run('pick', PICK_JADE);
  await wait(520);

  const live = await run('selftest', SELFTEST);
  const liveSig = sig(live?.html);
  const mineSig = sig(jadeMarkup('tpl-marble', BASE));
  const templateMatches = liveSig.length === mineSig.length && liveSig.every((line, i) => line === mineSig[i]);
  if (!templateMatches) {
    const firstDiff = liveSig.findIndex((line, i) => line !== mineSig[i]);
    report({ phase: 'selftest-failed', liveCount: liveSig.length, mineCount: mineSig.length,
      firstDiff: firstDiff < 0 ? 'length' : { index: firstDiff, live: liveSig[firstDiff], mine: mineSig[firstDiff] } });
    return;
  }

  const rect = await run('rect', `(() => {
    const r = document.querySelector('.tpl-tag').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);
  const [x, y, w, h] = rect ?? [0, 0, 0, 0];
  const pad = 4;

  const shots = [];
  for (const [i, c] of CANDIDATES.entries()) {
    const read = await run(`apply-${c.name}`, applyScript(c));
    await wait(380);
    const image = await probe.win.webContents.capturePage({
      x: Math.max(0, x - pad), y: Math.max(0, y - pad),
      width: w + pad * 2, height: h + pad * 2,
    });
    const out = path.join(__dirname, `j36-${String(i).padStart(2, '0')}-${c.name}.png`);
    fs.writeFileSync(out, image.toPNG());
    shots.push({ candidate: c.name, read, file: out });
  }

  const ref = path.join(__dirname, '..', 'measure', 'tag-raw.png');
  const all = [ref, ...shots.map(s => s.file)];
  const row = path.join(__dirname, 'j36-row.png');
  const H = 900;
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...all.flatMap(f => ['-i', f]),
    '-filter_complex',
    all.map((_, i) => `[${i}:v]scale=-2:${H}:flags=lanczos[v${i}]`).join(';') +
      ';' + all.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${all.length}`,
    '-frames:v', '1', row,
  ]);

  report({ templateMatches, rect, row, shots });
});
