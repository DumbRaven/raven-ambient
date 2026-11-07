/**
 * 量「控制条压在浅色信息条上会不会发灰」。
 *
 * 背景：用户报「唱片确实在控制栏下面了，但是信息栏还在控制栏上面」。
 * 层级实测是控制条在上面（elementFromPoint 全落在控制条自己身上），
 * 所以这句说的不是绘制顺序，是**看起来**像是信息条压着控制条。
 *
 * 最可能的解释：控制条是半透明 + backdrop-blur 的胶囊。
 * 唱片是深色，透上来还是一条深色，看不出差别；
 * 版式信息条是中灰 #72777d，左半段透上来就明显发亮。
 * 同一条胶囊一半黑一半灰，读起来就是「右边的压住了、左边的没压住」。
 *
 * 这个探针沿控制条中线横向扫一排**实际渲染出来的像素**，
 * 把「压在信息条上」和「压在暗背景上」两段的亮度摆在一起对比。
 * 差得多就说明是透光问题，而不是层级问题。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/chrome-contrast.cjs --no-sandbox
 */
const path = require('node:path');
const { launch, report, guard } = require('./harness.cjs');

const GEOM = `(() => {
  const bar = document.querySelector('.theater-bar');
  const info = document.querySelector('.tpl-block-bar');
  const b = bar.getBoundingClientRect();
  const i = info ? info.getBoundingClientRect() : null;
  return {
    bar: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    info: i ? [Math.round(i.x), Math.round(i.y), Math.round(i.width), Math.round(i.height)] : null,
    infoRight: i ? Math.round(i.right) : null,
  };
})()`;

/** 在重叠区正中问一次「最上层是谁」，确认不是绘制顺序的问题。 */
const HIT = `(() => {
  const bar = document.querySelector('.theater-bar');
  const info = document.querySelector('.tpl-block-bar');
  const b = bar.getBoundingClientRect();
  const i = info.getBoundingClientRect();
  const x = Math.round(i.left + i.width / 2);
  const y = Math.round(Math.max(b.top, i.top) + (Math.min(b.bottom, i.bottom) - Math.max(b.top, i.top)) / 2);
  const el = document.elementFromPoint(x, y);
  return {
    at: [x, y],
    top: el ? el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '') : null,
    inBar: !!(el && bar.contains(el)),
    inInfo: !!(el && info.contains(el)),
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: true });
  const geo = await probe.run(GEOM);
  const hit = await probe.run(HIT);

  const [bx, by, bw, bh] = geo.bar;
  const image = await probe.win.webContents.capturePage({ x: bx, y: by, width: bw, height: bh });
  const size = image.getSize();
  const bmp = image.getBitmap(); // BGRA
  const scale = Math.round(Math.sqrt(bmp.length / 4 / (size.width * size.height))) || 1;

  // 沿中线横向量：每 8 个逻辑像素取一点，避免采到按钮图标边缘
  const y = Math.floor(size.height / 2);
  const samples = [];
  for (let x = 6; x < size.width - 6; x += 8) {
    const px = x * scale;
    const py = y * scale;
    const idx = (py * size.width * scale + px) * 4;
    const b0 = bmp[idx];
    const g0 = bmp[idx + 1];
    const r0 = bmp[idx + 2];
    // 视觉亮度（sRGB 近似，够用来判断「一半亮一半暗」）
    samples.push({ x: x + bx, lum: Math.round(0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0), rgb: [r0, g0, b0] });
  }

  const infoRight = geo.infoRight;
  const onInfo = samples.filter(s => infoRight != null && s.x < infoRight);
  const offInfo = samples.filter(s => infoRight != null && s.x >= infoRight);
  const avg = list => (list.length ? Math.round(list.reduce((a, s) => a + s.lum, 0) / list.length) : null);
  const spread = list => (list.length ? Math.max(...list.map(s => s.lum)) - Math.min(...list.map(s => s.lum)) : null);

  report({
    geo,
    hit,
    scale,
    // 压在信息条上那一段 vs 压在暗背景上那一段
    onInfo: { count: onInfo.length, avgLum: avg(onInfo), spread: spread(onInfo) },
    offInfo: { count: offInfo.length, avgLum: avg(offInfo), spread: spread(offInfo) },
    // 两段的亮度差：差 20 以上人眼就会觉得「不是一个东西」
    deltaLum: avg(onInfo) != null && avg(offInfo) != null ? Math.abs(avg(onInfo) - avg(offInfo)) : null,
    // 抽几个点给人眼看
    peek: samples.filter((_, i) => i % 12 === 0).map(s => [s.x, s.lum]),
  });
});
