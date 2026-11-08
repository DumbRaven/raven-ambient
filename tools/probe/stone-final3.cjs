/**
 * 石纹的实机复验：**不注入任何 markup**，只点胶囊切风格、量、截图。
 *
 * 和 stone-root.cjs / stone-jade32.cjs 的区别：那些是自己拼一份滤镜串塞进页面，
 * 所以只证明了「那套参数好看」，证明不了「源码里写的就是那套」。
 * 这里让页面自己挂 marble.ts 生成的滤镜，量的就是出厂状态。
 *
 * 切换入口是胶囊本身（用户 m09905：直接点胶囊换，不在调色板里）。
 * 所以这里点的是 `.tpl-tag`——它现在是个 <button>。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/stone-final3.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait } = require('./harness.cjs');

const CLICK_TAG = `(() => {
  const tag = document.querySelector('.tpl-tag');
  if (!tag) return { error: 'no tag' };
  tag.click();
  return { ok: true };
})()`;

const READ = `(() => {
  const root = document.querySelector('.template-collage');
  const tag = document.querySelector('.tpl-tag');
  if (!root || !tag) return { error: 'missing nodes' };
  const before = getComputedStyle(tag, '::before');
  const after = getComputedStyle(tag, '::after');
  const host = document.getElementById('tpl-marble')?.parentElement;
  const filter = host?.querySelector('filter');
  return {
    stone: root.getAttribute('data-stone'),
    beforeFilter: before.filter,
    beforeBackground: before.backgroundColor,
    beforeBlend: before.mixBlendMode,
    beforeOpacity: before.opacity,
    afterOpacity: after.opacity,
    hosts: document.querySelectorAll('[data-tpl-marble]').length,
    hostStyle: host?.getAttribute('data-tpl-marble') ?? null,
    filterId: filter?.id ?? null,
    freqs: [...(filter?.querySelectorAll('feTurbulence') ?? [])].map(n => n.getAttribute('baseFrequency')),
    turbTypes: [...(filter?.querySelectorAll('feTurbulence') ?? [])].map(n => n.getAttribute('type')),
    composites: [...(filter?.querySelectorAll('feComposite') ?? [])].map(n => n.getAttribute('operator')),
  };
})()`;

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

  await wait(240);

  const rect = await run('rect', `(() => {
    const r = document.querySelector('.tpl-tag').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);
  const [x, y, w, h] = rect ?? [0, 0, 0, 0];
  const pad = 4;

  const shots = [];
  // 点两下：先看初始那种，再点一次换到另一种。顺序由 stoneStyles 决定。
  const at = name => (name === 'sea' ? '浪脊' : '玉石');

  /** 连拍到稳定。换完滤镜要等重绘，第一帧常常还是换之前那张。 */
  const settledImage = async area => {
    let prev = await probe.win.webContents.capturePage(area);
    for (let i = 0; i < 14; i += 1) {
      await wait(150);
      const now = await probe.win.webContents.capturePage(area);
      const a = prev.toBitmap();
      const b = now.toBitmap();
      let diff = 0;
      const step = Math.max(4, Math.floor(a.length / 4000)) * 4;
      for (let j = 0; j < a.length; j += step) diff += Math.abs(a[j] - b[j]);
      if (diff < 400) return now;
      prev = now;
    }
    return prev;
  };

  for (const i of [0, 1]) {
    if (i > 0) {
      await run('click', CLICK_TAG);
      await wait(520);
    }
    const read = await run(`read-${i}`, READ);
    const stone = read?.stone ?? 'unknown';
    const image = await settledImage({
      x: Math.max(0, x - pad), y: Math.max(0, y - pad),
      width: w + pad * 2, height: h + pad * 2,
    });
    const out = path.join(__dirname, `j33-${String(i).padStart(2, '0')}-${stone}.png`);
    fs.writeFileSync(out, image.toPNG());
    shots.push({ label: at(stone), stone, read, file: out });
  }

  const ref = path.join(__dirname, '..', 'measure', 'tag-raw.png');
  const all = [ref, ...shots.map(s => s.file)];
  const row = path.join(__dirname, 'j33-row.png');
  const H = 560;
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...all.flatMap(f => ['-i', f]),
    '-filter_complex',
    all.map((_, i) => `[${i}:v]scale=-2:${H}:flags=lanczos[v${i}]`).join(';') +
      ';' + all.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${all.length}`,
    '-frames:v', '1', row,
  ]);

  report({ steps, rect, shots, row });
});
