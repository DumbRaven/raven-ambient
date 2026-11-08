/**
 * 玉石第三十三轮：**源码管线不动**，只扫 CSS 的 `opacity`。
 *
 * 为什么还要扫：`stone-final3.cjs` 的实机截图里，玉石那一格明显比参考图
 * 平、也淡——`stone-jade32.cjs` 里 q3（0.18）看着接近，是因为那张横条
 * 每格只有 291px 宽，缩得快，把「淡」也一起缩掉了。实机放到原尺寸，
 * 差异就露出来了。
 *
 * 这一轮不再自己拼滤镜串：直接让页面挂 marble.ts 生成的那个，
 * 只覆写 `.template-collage[data-stone="jade"] .tpl-tag::before` 的 opacity。
 * 这样量到的就是「改一个数能不能到」。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/stone-jade33.cjs --no-sandbox
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

// 只动 opacity，其它一律不碰。
const overrideFor = opacity => `(() => {
  let st = document.getElementById('stone-try');
  if (!st) { st = document.createElement('style'); st.id = 'stone-try'; document.head.appendChild(st); }
  st.textContent = ${JSON.stringify(
    '.template-collage[data-stone="jade"] .tpl-tag::before { opacity: OPACITY !important; }',
  )}.replace('OPACITY', ${JSON.stringify(String(opacity))});
  const before = getComputedStyle(document.querySelector('.tpl-tag'), '::before');
  return { opacity: before.opacity, blend: before.mixBlendMode, filter: before.filter };
})()`;

const CLEAR = `(() => {
  const st = document.getElementById('stone-try');
  if (st) st.remove();
  const before = getComputedStyle(document.querySelector('.tpl-tag'), '::before');
  return { opacity: before.opacity };
})()`;

const CANDIDATES = [0.18, 0.26, 0.34, 0.42, 0.52];

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
  for (const [i, opacity] of CANDIDATES.entries()) {
    const read = await run(`apply-${opacity}`, overrideFor(opacity));
    await wait(300);
    const image = await probe.win.webContents.capturePage({
      x: Math.max(0, x - pad), y: Math.max(0, y - pad),
      width: w + pad * 2, height: h + pad * 2,
    });
    const out = path.join(__dirname, `j34-${String(i).padStart(2, '0')}-${opacity}.png`);
    fs.writeFileSync(out, image.toPNG());
    shots.push({ opacity, read, file: out });
  }
  await run('clear', CLEAR);

  const ref = path.join(__dirname, '..', 'measure', 'tag-raw.png');
  const all = [ref, ...shots.map(s => s.file)];
  const row = path.join(__dirname, 'j34-row.png');
  const H = 900;
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
