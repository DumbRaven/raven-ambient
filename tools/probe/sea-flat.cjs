/**
 * 为什么探针里 sd 11.2 的浪脊，装进 app 就成了 sd 4.5 / mean 205。
 *
 * 逐个关掉参与叠加的层，看是哪一个把对比度吃掉了：
 *   base   原样
 *   noAfter  藏起 ::after（方向性高光）
 *   noFilter ::before 的 filter 关掉（看底色本身就多少）
 *   onlyBefore 藏掉 ::after 与字，只留 ::before
 *
 * 跑法：node_modules/electron/dist/electron.exe tools/probe/sea-flat.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait } = require('./harness.cjs');

const STYLE = style => `(() => {
  let node = document.getElementById('sea-flat');
  if (!node) {
    node = document.createElement('style');
    node.id = 'sea-flat';
    document.head.appendChild(node);
  }
  node.textContent = ${JSON.stringify(style)};
  return true;
})()`;

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
      if (red - blue > 26 && red > 96) continue;
      values.push(0.299 * red + 0.587 * green + 0.114 * blue);
    }
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    return { mean: +mean.toFixed(2), sd: +sd.toFixed(2), n };
  };

  const settle = async () => {
    let prev = await sample();
    for (let i = 0; i < 12; i += 1) {
      await wait(160);
      const now = await sample();
      if (Math.abs(now.mean - prev.mean) < 0.4 && Math.abs(now.sd - prev.sd) < 0.4) return now;
      prev = now;
    }
    return prev;
  };

  const cases = [
    ['base', ''],
    ['noAfter', '.template-collage .tpl-tag::after { display: none !important; }'],
    ['noFilter', '.template-collage .tpl-tag::before { filter: none !important; }'],
    ['onlyBefore', '.template-collage .tpl-tag::after { display: none !important; } .template-collage .tpl-badge, .template-collage .tpl-star { visibility: hidden !important; }'],
  ];

  const rows = [];
  for (const [label, css] of cases) {
    await run(STYLE(css));
    const stat = await settle();
    const file = path.join(__dirname, `flat-${label}.png`);
    fs.writeFileSync(file, (await probe.win.webContents.capturePage({ x, y, width: w, height: h })).toPNG());
    rows.push({ label, ...stat, file });
  }

  // 顺便回报伪元素的实际样式，确认 override 生效。
  const css = await run(`(() => {
    const tag = document.querySelector('.tpl-tag');
    const before = getComputedStyle(tag, '::before');
    const after = getComputedStyle(tag, '::after');
    return {
      beforeFilter: before.filter,
      beforeBackground: before.backgroundColor,
      beforeOpacity: before.opacity,
      beforeBlend: before.mixBlendMode,
      afterOpacity: after.opacity,
      afterBackground: after.backgroundImage.slice(0, 80),
      afterBlend: after.mixBlendMode,
      hosts: [...document.querySelectorAll('[data-tpl-marble]')].map(n => ({
        id: n.querySelector('filter')?.id ?? null,
        freq: n.querySelector('feTurbulence')?.getAttribute('baseFrequency') ?? null,
      })),
    };
  })()`);

  const row = path.join(__dirname, 'flat-row.png');
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...rows.flatMap(r => ['-i', r.file]),
    '-filter_complex',
    rows.map((_, i) => `[${i}:v]scale=-2:520:flags=lanczos[v${i}]`).join(';') +
      ';' + rows.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${rows.length}`,
    '-frames:v', '1', row,
  ]);

  report({ rect, rows, css, row });
});
