/**
 * 配色面板的样子有没有被改坏。
 *
 * 起因：删石纹选项那一组 `.tone-stones` 时，我把中间那段
 * `.tone-swatches` / `.tone-fields` / `.tone-group` / `.tone-field` / `.tone-hex` /
 * `.tone-reset` 一起删了（用户 m10262：「怎么调色板变成这样了……好丑」）。
 *
 * 这个探针逐档打开配色面板，量每组控件的实际尺寸与间距，
 * 任何一组塌成 0 高或丢了边框就是覆盖层被删了。
 *
 * 跑法（改完源码先 npm run build）：
 *   node_modules/electron/dist/electron.exe tools/probe/tone-panel.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

const OPEN = `(() => {
  const button = document.querySelector('button[aria-label="配色"]');
  if (!button) return { error: 'no tone button' };
  button.click();
  return { ok: true };
})()`;

const MODE = name => `(() => {
  const button = [...document.querySelectorAll('.tone-modes button')].find(n => n.textContent.includes(${JSON.stringify(name)}));
  if (!button) return { error: 'no mode button ' + ${JSON.stringify(name)} };
  button.click();
  return { ok: true };
})()`;

const MEASURE = `(() => {
  const box = node => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const css = getComputedStyle(node);
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      border: css.borderTopWidth,
      radius: css.borderTopLeftRadius,
      background: css.backgroundColor,
      font: css.fontSize,
    };
  };
  const menu = document.querySelector('.theater-tone-menu');
  return {
    menu: box(menu),
    modes: [...document.querySelectorAll('.tone-modes button')].map(node => ({ text: node.textContent.trim(), ...box(node) })),
    swatches: [...document.querySelectorAll('.tone-swatches button')].map(box),
    groups: [...document.querySelectorAll('.tone-group')].map(g => ({
      legend: g.querySelector('legend')?.textContent ?? null,
      ...box(g),
      fields: [...g.querySelectorAll('.tone-field')].map(box),
    })),
    hex: box(document.querySelector('.tone-hex')),
    color: box(document.querySelector('.tone-field input[type="color"]')),
    reset: box(document.querySelector('.tone-reset')),
    hint: box(document.querySelector('.tone-hint')),
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });
  const run = code => probe.run(code);

  await wait(240);
  await run(OPEN);
  await wait(280);

  const out = {};

  await run(MODE('挑一个'));
  await wait(320);
  out.pick = await run(MEASURE);
  fs.writeFileSync(
    path.join(__dirname, 'tone-pick.png'),
    (await probe.win.webContents.capturePage()).toPNG(),
  );
  const pickBox = await run(`(() => {
    const r = document.querySelector('.theater-tone-menu').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);
  if (pickBox) {
    const pad = 14;
    fs.writeFileSync(
      path.join(__dirname, 'tone-menu-pick.png'),
      (await probe.win.webContents.capturePage({
        x: Math.max(0, pickBox[0] - pad), y: Math.max(0, pickBox[1] - pad),
        width: pickBox[2] + pad * 2, height: pickBox[3] + pad * 2,
      })).toPNG(),
    );
  }

  await run(MODE('自己填'));
  await wait(320);
  out.custom = await run(MEASURE);
  const full = await probe.win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'tone-custom.png'), full.toPNG());

  // 菜单自己的坐标：单独裁一张，否则整屏图里它只有一小块，看不出好坏。
  const menuBox = await run(`(() => {
    const r = document.querySelector('.theater-tone-menu').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);
  if (menuBox) {
    const pad = 14;
    const crop = await probe.win.webContents.capturePage({
      x: Math.max(0, menuBox[0] - pad), y: Math.max(0, menuBox[1] - pad),
      width: menuBox[2] + pad * 2, height: menuBox[3] + pad * 2,
    });
    fs.writeFileSync(path.join(__dirname, 'tone-menu-custom.png'), crop.toPNG());
  }

  // 判据：列出的每一项都存在且尺寸不为 0。
  const checks = [];
  const push = (label, node) => checks.push({ label, ok: !!node && node.w > 0 && node.h > 0, ...(node ?? {}) });
  push('swatch', (out.pick?.swatches ?? [])[0]);
  push('group', (out.custom?.groups ?? [])[0]);
  push('field', (out.custom?.groups ?? [])[0]?.fields?.[0]);
  push('color input', out.custom?.color);
  push('hex input', out.custom?.hex);
  push('reset', out.custom?.reset);

  report({ out, checks, broken: checks.filter(c => !c.ok).map(c => c.label) });
});
