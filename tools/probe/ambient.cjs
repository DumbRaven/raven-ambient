/**
 * 面板上半的「此刻的环境音」探针。
 *
 * 它要回答三件事：
 *   1. 有环境音时这块长什么样、几何落在哪（相对画布百分比）；
 *   2. 没有环境音时整块是否真的不渲染（不能留一个空壳把版面撑住）；
 *   3. 让位幅度用的是「最深那一层」而不是平均值——这是产品判断，
 *      探针只负责把算出来的 dB 打出来，人看一眼对不对。
 *
 * 两种状态在同一个窗口里切：`launch()` 返回的 `close()` 是直接 app.exit(0)，
 * 调一次进程就没了，所以不能「起两个窗口」。改成写完 localStorage 再 reload。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/ambient.cjs --no-sandbox
 */
const path = require('node:path');
const { launch, report, guard, wait, CQW_PROBE, MEDIA_DIR } = require('./harness.cjs');

const records = ['rain', 'fire', 'traffic'].map((key, at) => ({
  id: `ambient:${key}`,
  assetId: `asset:${key}`,
  name: ['Rain', 'Fireplace', 'Distant Traffic'][at],
  artist: 'Field Recording',
  description: '',
  category: 'ambient',
  duration: 0,
  format: 'WAV',
  size: 1,
  color: ['#4b5a66', '#6b5545', '#54606b'][at],
  fingerprint: key,
  volume: 60,
  pan: 0,
  warmth: 0,
  // 三层故意给不同的让位量：18 / 6 / 12 dB。
  // 面板上应当写 18（最深那一层），写 12（平均）就是错的。
  duckDepth: [18, 6, 12][at],
}));

const LIVE = {
  records,
  ambience: records.map(record => record.id),
  muted: [],
  media: [{ id: 'image:1', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Ocean', size: 1 }],
  mediaDirs: [MEDIA_DIR],
};

const MEASURE = `(() => {
  const C = document.querySelector('.template-collage');
  if (!C) return { error: 'no stage' };
  const cb = C.getBoundingClientRect();
  const box = sel => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return {
      x: +((b.x - cb.x) / cb.width * 100).toFixed(2),
      y: +((b.y - cb.y) / cb.height * 100).toFixed(2),
      w: +(b.width / cb.width * 100).toFixed(2),
      h: +(b.height / cb.height * 100).toFixed(2),
    };
  };
  const style = sel => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const s = getComputedStyle(e);
    return {
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      opacity: s.opacity,
      family: s.fontFamily.split(',')[0].replace(/"/g, ''),
    };
  };
  return {
    block: box('.tpl-ambient'),
    mirror: box('.tpl-ambient-mirror'),
    label: document.querySelector('.tpl-ambient > b')?.textContent ?? null,
    layers: document.querySelector('.tpl-ambient-layers')?.textContent ?? null,
    meta: document.querySelector('.tpl-ambient-meta')?.textContent ?? null,
    labelStyle: style('.tpl-ambient > b'),
    layersStyle: style('.tpl-ambient-layers'),
    metaStyle: style('.tpl-ambient-meta'),
    staleIntro: !!document.querySelector('.tpl-intro, .tpl-intro-mirror'),
  };
})()`;

// 重载后要重新切页、重新点全屏——这两步都在 launch 内部做过一次，这里再做一遍。
const ENTER = `(() => {
  [...document.querySelectorAll('.view-tabs > button')]
    .find(b => b.getAttribute('aria-label') === '放映')?.click();
  return 1;
})()`;

guard(async () => {
  const probe = await launch({ expand: true, patch: LIVE });
  await wait(500);

  const cqw = await probe.run(CQW_PROBE);
  const withAmbience = await probe.run(MEASURE);
  await probe.shot(path.join(__dirname, 'ambient.png'));

  // 换成「一张环境音都没有」的库，重载后再量一次。
  await probe.run(`(() => {
    const next = Object.assign({}, ${JSON.stringify(LIVE)}, {
      records: [], ambience: [], muted: [],
    });
    localStorage.setItem('raven-cabinet-v2', JSON.stringify(next));
    return 1;
  })()`);
  probe.win.webContents.reload();
  await wait(2600);
  await probe.run(ENTER);
  await wait(1600);
  await probe.run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
  await wait(1400);
  const withoutAmbience = await probe.run(MEASURE);

  report({ cqw, withAmbience, withoutAmbience });
});
