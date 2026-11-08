/**
 * 云雾版该多浓：扫几档 opacity，把 sd 对回参考图。
 *
 * 为什么需要这一轮：`stone-cloud.png` 量出来 sd 20.26，参考图裁片是 13.94——
 * **衰减形状**（1 / 0.936 / 0.773 / 0.635 vs 1 / 0.933 / 0.806 / 0.626）已经对上了，
 * 说明团块大小是对的，只是整体压得太重，看着比参考"脏"。
 * opacity 是这条合成链最末端的阀门（前面滤镜里调幅度会被它吃掉，
 * 这个坑 tag-tune.cjs 已经踩过一次），所以只扫它。
 *
 * 为了让 sd 可比，探针会先把面板底色固定住——视频画面每帧不同，
 * collageTone 跟着取色，底色一变 sd 就跟着漂，三档就量不到一起去了。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/stone-tune.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');
const { texture } = require('../measure/tag-stats2.cjs');

/**
 * 每一档是「重叠上去的两层各给多少」。分开是因为量出来发现：
 * 只压 `::before` 的 opacity 到 0.22，sd 也只从 20.0 掉到 17.8——
 * 再往下压几乎不动。说明总对比度的大头不在云雾层，而在方向性高光
 * （`::after` 那三层渐变跨越了整条胶囊，粗化到 8% 块仍留得住）。
 * 所以这一轮两层一起扫。 */
const LEVELS = [
  { before: 0.40, after: 1.00 },
  { before: 0.28, after: 0.60 },
  { before: 0.22, after: 0.45 },
  { before: 0.18, after: 0.30 },
];

/** 切到云雾，并把面板与胶囊底色钉死，之后每次只改 ::before 的 opacity。
 *
 *  注意顺序：配色菜单是**条件渲染**的，没点开时 `.tone-stones` 根本不在 DOM 里，
 *  直接点 `button:nth-child(2)` 会静默什么都不做（第一版就栽在这里：
 *  四档量出来 sd 一模一样，因为一直还是浪脊）。 */
const PREPARE = `(() => {
  const opened = document.querySelector('button[aria-label="配色"]');
  if (opened && !document.querySelector('.tone-stones')) opened.click();
  return { menuOpened: !!document.querySelector('.tone-stones') };
})()`;

const PICK_CLOUD = `(() => {
  const button = [...document.querySelectorAll('.tone-stones button')]
    .find(node => node.textContent.includes('云雾'));
  if (!button) return { error: 'no cloud button' };
  button.click();
  return { clicked: true };
})()`;

const setOpacity = (before, after) => `(() => {
  let node = document.getElementById('stone-tune-opacity');
  if (!node) {
    node = document.createElement('style');
    node.id = 'stone-tune-opacity';
    document.head.appendChild(node);
  }
  node.textContent =
    '.template-collage[data-stone="cloud"] .tpl-tag::before { opacity: ${before} !important; }' +
    '.template-collage[data-stone="cloud"] .tpl-tag::after { opacity: ${after} !important; }';
  const tag = document.querySelector('.tpl-tag');
  return {
    before: getComputedStyle(tag, '::before').opacity,
    after: getComputedStyle(tag, '::after').opacity,
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });
  const prepared = await probe.run(PREPARE);
  await wait(260);
  const picked = await probe.run(PICK_CLOUD);
  await wait(600);

  const pinned = await probe.run(`(() => {
    const style = document.createElement('style');
    style.id = 'stone-tune';
    // 底色钉死成参考图那块面板的颜色（#4a5363）。纹理是叠在它上面的，
    // 底一样了，两边的 sd 才能直接比。
    style.textContent = '.template-collage .tpl-block-panel { background: #4a5363 !important; }';
    document.head.appendChild(style);
    return { stone: document.querySelector('.template')?.getAttribute('data-stone') ?? null };
  })()`);
  await wait(260);

  const rect = await probe.run(`(() => {
    const r = document.querySelector('.tpl-tag').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);

  const rows = [];
  for (const level of LEVELS) {
    const applied = await probe.run(setOpacity(level.before, level.after));
    await wait(320);
    const [x, y, w, h] = rect;
    const pad = 6;
    const image = await probe.win.webContents.capturePage({
      x: Math.max(0, x - pad),
      y: Math.max(0, y - pad),
      width: w + pad * 2,
      height: h + pad * 2,
    });
    const out = path.join(__dirname, `stone-tune-b${String(level.before).replace('.', '')}-a${String(level.after).replace('.', '')}.png`);
    fs.writeFileSync(out, image.toPNG());
    const t = texture(out);
    const base = t.rows[0].sd;
    rows.push({
      level,
      applied,
      file: out,
      sd: t.rows.map(r => r.sd),
      shape: t.rows.map(r => +(r.sd / base).toFixed(3)),
      mean: t.rows[0].mean,
    });
  }

  // 参考图同口径再量一遍，放在一起比。
  const ref = texture(path.join(__dirname, '..', 'measure', 'tag-ref.png'));
  const refBase = ref.rows[0].sd;

  report({
    prepared,
    picked,
    pinned,
    rect,
    rows,
    ref: {
      sd: ref.rows.map(r => r.sd),
      shape: ref.rows.map(r => +(r.sd / refBase).toFixed(3)),
      mean: ref.rows[0].mean,
    },
  });
});
