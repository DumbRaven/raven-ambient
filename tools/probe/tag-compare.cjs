/**
 * 三联对比：参考图裁片 / 现在的浪脊版 / 候选雾纹版。
 *
 * 前面几轮探针（`tag-mist2..5`）都是**藏掉字母量统计**，那是为了量纹理本身；
 * 但决定用哪一版要看**带字母的真实观感**，所以这里单独做一张三联图：
 *   左  参考图里的胶囊（`tools/measure/tag-ref.png`，ffmpeg 裁出来放大 5 倍）
 *   中  当前代码渲染的样子
 *   右  候选雾纹注入后的样子
 * 三张统一缩放到同一高度再拼接，才能直接用眼睛比。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-compare.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait } = require('./harness.cjs');

/** 选中的形态：大团慢雾，幅度取中（`tag-mist5.cjs` 里 mid-28 观感最像参考）。 */
const PICK = {
  name: 'mist',
  freq: '0.012', octaves: 5, blur: 4.0, lift: 1.6, opacity: 0.28,
};

const AREA = `(() => {
  const r = document.querySelector('.tpl-tag').getBoundingClientRect();
  return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6,
           width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
})()`;

function markupOf(c) {
  const intercept = (0.5 - 0.5 * c.lift).toFixed(3);
  return `<feTurbulence type="fractalNoise" baseFrequency="${c.freq}" numOctaves="${c.octaves}" seed="23" result="cloud"/>` +
    '<feColorMatrix in="cloud" type="saturate" values="0" result="gray"/>' +
    '<feComponentTransfer in="gray" result="lifted">' +
    `<feFuncR type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    `<feFuncG type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    `<feFuncB type="linear" slope="${c.lift}" intercept="${intercept}"/>` +
    `<feFuncA type="linear" slope="0" intercept="1"/>` +
    '</feComponentTransfer>' +
    `<feGaussianBlur in="lifted" stdDeviation="${c.blur}"/>`;
}

function applyPick() {
  const markup = markupOf(PICK).replace(/\s+/g, ' ').trim();
  const css = `.template-collage .tpl-tag::before {
      background: #808080;
      filter: url(#tpl-mist-try);
      mix-blend-mode: soft-light;
      opacity: ${PICK.opacity};
    }`.replace(/\s+/g, ' ').trim();

  return `(() => { try {
    document.getElementById('try-filter')?.remove();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'try-filter';
    svg.setAttribute('width', '300');
    svg.setAttribute('height', '300');
    svg.innerHTML = '<filter id="tpl-mist-try" x="-40%" y="-40%" width="180%" height="180%">${markup}</filter>';
    document.body.appendChild(svg);
    let style = document.getElementById('try-style');
    if (!style) { style = document.createElement('style'); style.id = 'try-style'; document.head.appendChild(style); }
    style.textContent = ${JSON.stringify(css)};
    return { ok: true };
  } catch (e) { return { error: e.message }; } })()`;
}

function restore() {
  return `(() => { document.getElementById('try-filter')?.remove();
                   document.getElementById('try-style')?.remove(); return { ok: true }; })()`;
}

/**
 * 用 ffmpeg 把几张图缩到同一高度再横向拼接。
 *
 * execFileSync 是**逐参数**传给进程的，路径里不能带引号——
 * 带了会把 `"` 当成参数内容，报 `Unrecognized option 'i "F:\…"'`。
 */
function hstack(files, height, out) {
  const inputs = files.flatMap(f => ['-i', f]);
  const filters = files.map((_, i) => `[${i}:v]scale=-1:${height}:flags=lanczos[s${i}]`).join(';');
  const labels = files.map((_, i) => `[s${i}]`).join('');
  const graph = `${filters};${labels}hstack=inputs=${files.length}[out]`;
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', ...inputs,
    '-filter_complex', graph, '-map', '[out]', out,
  ]);
}

guard(async () => {
  const probe = await launch({ expand: true });
  await wait(500);
  const area = await probe.run(AREA);

  const nowFile = path.join(__dirname, 'compare-now.png');
  fs.writeFileSync(nowFile, (await probe.win.webContents.capturePage(area)).toPNG());

  await probe.run(applyPick());
  await wait(360);
  const mistFile = path.join(__dirname, 'compare-mist.png');
  fs.writeFileSync(mistFile, (await probe.win.webContents.capturePage(area)).toPNG());

  await probe.run(restore());

  const refFile = path.join(__dirname, '..', 'measure', 'tag-ref.png');
  if (!fs.existsSync(refFile)) {
    report({ error: 'missing tag-ref.png，先跑 tools/measure/tag-crop.cjs' });
    return;
  }

  const out = path.join(__dirname, 'tag-compare.png');
  hstack([refFile, nowFile, mistFile], 420, out);
  report({ pick: PICK, files: [refFile, nowFile, mistFile], out });
});
