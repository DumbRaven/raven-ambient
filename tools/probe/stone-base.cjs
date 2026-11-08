/**
 * 云雾版该垫什么底色。
 *
 * 起因：把云雾版和高光各压一半之后，sd 与衰减形状都对上了参考图，
 * 但**整体发灰**——截图上整条胶囊像磨砂塑料，没有浪脊版那种通透感。
 *
 * 原因不在对比度，在透明度：浪脊版的条纹里有一大半是 `#00000000`
 * （透明），底下的半透明白胶囊能透出来；而云雾版垫的是不透明的 `#808080`，
 * 那 28% 的覆盖里完全没有白色，等于给胶囊蒙了一层灰。
 *
 * 所以这一轮只扫**垫什么颜色**：白色让它透，灰色让它闷。
 * 混合模式固定 soft-light（亮处提亮、暗处压暗，围绕中灰对称）。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/stone-base.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');
const { texture } = require('../measure/tag-stats2.cjs');

/** 底色 × 不透明度。灰的是原来的假设（已验证会发闷），白的是新方向。 */
const CANDIDATES = [
  { base: '#ffffff', opacity: 0.30 },
  { base: '#ffffff', opacity: 0.36 },
  { base: '#ffffff', opacity: 0.42 },
  { base: '#ffffff', opacity: 0.48 },
];

const OPEN = `(() => {
  const button = document.querySelector('button[aria-label="配色"]');
  if (button && !document.querySelector('.tone-stones')) button.click();
  return { menu: !!document.querySelector('.tone-stones') };
})()`;

const PICK_CLOUD = `(() => {
  const button = [...document.querySelectorAll('.tone-stones button')].find(n => n.textContent.includes('云雾'));
  if (!button) return { error: 'no cloud button' };
  button.click();
  return { ok: true };
})()`;

const apply = (base, opacity) => `(() => {
  let node = document.getElementById('stone-base');
  if (!node) { node = document.createElement('style'); node.id = 'stone-base'; document.head.appendChild(node); }
  node.textContent =
    '.template-collage[data-stone="cloud"] .tpl-tag::before {' +
    ' background: ${base} !important; opacity: ${opacity} !important; }';
  const s = getComputedStyle(document.querySelector('.tpl-tag'), '::before');
  return { background: s.backgroundColor, opacity: s.opacity, blend: s.mixBlendMode };
})()`;

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });
  const opened = await probe.run(OPEN);
  await wait(260);
  const picked = await probe.run(PICK_CLOUD);
  await wait(500);

  const rect = await probe.run(`(() => {
    const r = document.querySelector('.tpl-tag').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);

  const rows = [];
  for (const c of CANDIDATES) {
    const applied = await probe.run(apply(c.base, c.opacity));
    await wait(320);
    const [x, y, w, h] = rect;
    const pad = 6;
    const image = await probe.win.webContents.capturePage({
      x: Math.max(0, x - pad), y: Math.max(0, y - pad),
      width: w + pad * 2, height: h + pad * 2,
    });
    const out = path.join(__dirname, `stone-base-${c.base.slice(1)}-${String(c.opacity).replace('.', '')}.png`);
    fs.writeFileSync(out, image.toPNG());
    const t = texture(out);
    const b = t.rows[0].sd;
    rows.push({
      want: c,
      applied,
      file: out,
      sd: t.rows.map(r => r.sd),
      shape: t.rows.map(r => +(r.sd / b).toFixed(3)),
      mean: t.rows[0].mean,
    });
  }

  const ref = texture(path.join(__dirname, '..', 'measure', 'tag-ref.png'));
  const rb = ref.rows[0].sd;

  report({
    opened, picked, rect, rows,
    ref: {
      sd: ref.rows.map(r => r.sd),
      shape: ref.rows.map(r => +(r.sd / rb).toFixed(3)),
      mean: ref.rows[0].mean,
    },
  });
});
