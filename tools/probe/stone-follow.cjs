/**
 * 玉石胶囊到底跟不跟着面板变色。
 *
 * 为什么需要：参考图那块胶囊偏蓝（blueMinusRed +24.3），我为了数值对上，
 * 把蓝色写死进了滤镜末尾的 feColorMatrix。但参考图的蓝是**面板的蓝透过
 * 半透明胶囊**上来的——写死之后，用户把配色改成暖色，胶囊不会跟着变。
 *
 * 这个探针把面板换成六个色相（蓝 / 米黄 / 绿 / 紫 / 红 / 灰），
 * 每换一次截一次胶囊并量它的平均 RGB。判据：
 *  - **跟得动**：胶囊的 blueMinusRed 随面板的 blueMinusRed 同向变化；
 *  - **不跟**：两者相差恒定（就是写死了颜色）。
 *
 * 跑法：env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *       tools/probe/stone-follow.cjs --no-sandbox
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

/** 换面板底色。只改 CSS 变量，不碰纹理——要测的正是「纹理会不会跟着走」。 */
const setPanel = color => `(() => {
  const root = document.querySelector('.template-collage') || document.querySelector('.template');
  if (!root) return { error: 'no stage' };
  root.style.setProperty('--tpl-panel', ${JSON.stringify(color)});
  return { panel: getComputedStyle(root).getPropertyValue('--tpl-panel').trim() };
})()`;

/** 面板六档：蓝（参考图那种）/ 米黄 / 绿 / 紫 / 红 / 灰。 */
const PANELS = [
  ['blue', '#4a5363'],
  ['sand', '#6b6350'],
  ['green', '#48584a'],
  ['violet', '#544a63'],
  ['red', '#634a4a'],
  ['gray', '#555555'],
];

/**
 * 量胶囊的平均 RGB，跳过金色像素（字与 ✦）。
 *
 * 判据照抄 tools/measure/texture-only.cjs：`r - b > 26 && r > 96`
 * 就是金色，反过来说，蓝偏的纹理 `r - b` 一定是负的，不会被误挖。
 * 同时内缩 14%，避开圆角处漏进来的面板底色。
 */
function measureTag(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap(); // BGRA
  const x0 = Math.round(width * 0.14);
  const x1 = Math.round(width * 0.86);
  const y0 = Math.round(height * 0.14);
  const y1 = Math.round(height * 0.86);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      const blue = bitmap[i];
      const green = bitmap[i + 1];
      const red = bitmap[i + 2];
      if (red - blue > 26 && red > 96) continue; // 金色
      r += red; g += green; b += blue; n += 1;
    }
  }
  if (!n) return null;
  return [r / n, g / n, b / n].map(v => +v.toFixed(1));
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

  // 面板块自己占了画面右侧一大片，从它身上取一块当「面板色真的变了」的旁证——
  // 只看胶囊的话，胶囊不跟着变与「变量根本没生效」两种情况分不出来。
  const panelRect = await run('panel-rect', `(() => {
    const r = document.querySelector('.tpl-block-panel').getBoundingClientRect();
    return [Math.round(r.x + r.width * 0.12), Math.round(r.y + r.height * 0.62),
            Math.round(r.width * 0.16), Math.round(r.height * 0.10)];
  })()`);

  const shots = [];
  const average = async area => {
    if (!area) return null;
    const image = await probe.win.webContents.capturePage({
      x: area[0], y: area[1], width: Math.max(1, area[2]), height: Math.max(1, area[3]),
    });
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap(); // BGRA
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      b += bitmap[i]; g += bitmap[i + 1]; r += bitmap[i + 2]; n += 1;
    }
    if (!n || !width || !height) return null;
    return [r / n, g / n, b / n].map(v => +v.toFixed(1));
  };

  for (const [label, color] of PANELS) {
    const applied = await run(`panel-${label}`, setPanel(color));
    await wait(280);
    const image = await probe.win.webContents.capturePage({
      x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: w + pad * 2, height: h + pad * 2,
    });
    const out = path.join(__dirname, `follow-${label}.png`);
    fs.writeFileSync(out, image.toPNG());
    shots.push({
      label, panel: color, applied, file: out,
      swatch: await average(panelRect),
      // 胶囊自己的色：**必须跳过金色像素**，否则 DUMBRAVEN 的字与 ✦ 会把均值带偏
      // （第一次量出 blueMinusRed −27 就是被字母吃掉的，真实值在 +20 附近）。
      // 判据与 tools/measure/texture-only.cjs 同口径。
      tag: measureTag(image),
    });
  }

  // 跟色幅度：面板自己 blueMinusRed 的极差，与胶囊 blueMinusRed 的极差之比。
  // 1 附近＝完全跟着走；0＝颜色写死了（修之前实测是 0）。
  const spread = key => {
    const values = shots.map(s => s[key]).filter(Boolean).map(v => v[2] - v[0]);
    return +(Math.max(...values) - Math.min(...values)).toFixed(1);
  };
  const follow = {
    panelSpread: spread('swatch'),
    tagSpread: spread('tag'),
    cast: shots.map(s => ({
      label: s.label,
      blueMinusRed: s.tag ? +(s.tag[2] - s.tag[0]).toFixed(1) : null,
    })),
  };

  // 把六张拼成一条，一眼看出跟不跟。
  const row = path.join(__dirname, 'follow-row.png');
  const H = 640;
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...shots.flatMap(s => ['-i', s.file]),
    '-filter_complex',
    shots.map((_, i) => `[${i}:v]scale=-2:${H}:flags=lanczos[v${i}]`).join(';') +
      ';' + shots.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${shots.length}`,
    '-frames:v', '1', row,
  ]);

  report({ steps, shots, row, rect, follow });
});
