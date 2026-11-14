/**
 * 计算样式快照探针：导出多个视图/尺寸下的全量计算样式，供 style-diff.mjs 比对。
 *
 * 与 baseline.cjs 的分工：
 *   baseline.cjs  → 像素图，验「看起来对不对」
 *   styles.cjs    → 计算样式，验「每个元素每个属性有没有变」
 *
 * 后者覆盖前者拍不到的全部盲区：折叠抽屉、":hover"/":focus-visible" 独占规则、
 * 视口外元素、`@media (max-height: 700px)` 分支、全屏态。
 *
 * 用法（先在 .qa 里存一份基准，改完再存一份，然后 diff）：
 *   env -u ELECTRON_RUN_AS_NODE PROBE_STYLE_OUT=.qa/style-before \
 *     node_modules/electron/dist/electron.exe tools/probe/styles.cjs --no-sandbox
 *   npx tsc -b --force && npm run build
 *   env -u ELECTRON_RUN_AS_NODE PROBE_STYLE_OUT=.qa/style-after \
 *     node_modules/electron/dist/electron.exe tools/probe/styles.cjs --no-sandbox
 *   node tools/probe/style-diff.mjs .qa/style-before .qa/style-after
 *
 * 注意：和 baseline.cjs 一样，改完源码必须先 `npm run build`，探针读的是 dist/。
 */
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// 必须在 require('./harness.cjs') 之前：这个开关只在 app ready 之前设置才生效。
// 不钉 DPR 的话，同一套 CSS 在不同机器上算出不同的 px 值（1.5 倍机器上
// font-size: 13px 会算成 19.5px），跨机器比对立刻全红。
app.commandLine.appendSwitch('force-device-scale-factor', process.env.PROBE_DPR || '1');

const { launch, wait, guard, ROOT, MEDIA_AUDIO } = require('./harness.cjs');
const { flatten } = require('./style-snapshot.cjs');

const OUT_ROOT = process.env.PROBE_STYLE_OUT
  ? path.resolve(ROOT, process.env.PROBE_STYLE_OUT)
  : path.join(ROOT, '.qa', 'style');

const SIZES = [
  { id: 'wide', width: 680, height: 980 },
  { id: 'narrow', width: 440, height: 860 },
  // 第三档专门打 `max-height: 700px` 分支：矮窗口下样式表会切另一套排布，
  // 那是纯媒体查询、跟宽度无关，前面两个尺寸都覆盖不到。
  { id: 'short', width: 680, height: 680 },
];

const VIEWS = [
  { id: 'cabinet', label: '唱片柜' },
  { id: 'listening', label: '正在听' },
  { id: 'focus', label: '专注' },
  { id: 'media', label: '相集' },
];

// 与 baseline.cjs 用同一套探针数据，保证两边看的是同一个界面的同一个状态。
const RECORD_COLORS = ['#879a91', '#aaa2b4', '#bd9b80', '#8c9caa', '#aaa481', '#b28e92'];
const NAMES = ['雨声', '夜航', '炉火', '打字', '海浪', '微风', '虫鸣', '城市'];
const RECORDS = NAMES.map((name, i) => ({
  id: `probe-${i}`,
  assetId: `probe-asset-${i}`,
  name,
  artist: '本地收藏',
  description: '',
  category: i < 5 ? 'music' : 'ambient',
  duration: 180 + i * 37,
  format: i % 2 ? 'FLAC' : 'MP3',
  size: 2_400_000 + i * 100_000,
  color: RECORD_COLORS[i % RECORD_COLORS.length],
  fingerprint: `probe-fingerprint-${i}`,
  volume: 60,
  pan: 0,
  warmth: 0,
  duckDepth: 9,
}));

const PATCH = {
  records: RECORDS,
  queue: RECORDS.filter(r => r.category === 'music').map(r => r.id),
  ambience: RECORDS.filter(r => r.category === 'ambient').map(r => r.id),
};

/** 按 aria-label 切视图。底栏顺序会随窗口变，不能靠位置点。 */
const switchView = label => `(() => {
  const hit = [...document.querySelectorAll('.view-tabs > button')]
    .find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)});
  if (!hit) return 'missing:' + ${JSON.stringify(label)};
  hit.click();
  return 1;
})()`;

/**
 * 让所有动画停在同一个相位。
 *
 * 与 baseline.cjs 的 SETTLE 同一套做法，这里也要，理由完全一样：
 * 不冻的话，转动的黑胶每次停在不同角度，上百个 transform 值都对不上，
 * 整个门禁沦为噪声。区别是这里只关心「值确定」，不关心长什么样。
 */
const FREEZE = `(async () => {
  await document.fonts.ready;
  const all = document.getAnimations();
  const isEndless = a => {
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
    return t && t.iterations === Infinity;
  };
  const endless = all.filter(isEndless);
  const finite = all.filter(a => !isEndless(a));
  const guard = new Promise(done => setTimeout(done, 1500));
  await Promise.race([Promise.all(finite.map(a => a.finished.catch(() => {}))), guard]);
  if (endless.length) {
    const style = document.createElement('style');
    style.setAttribute('data-style-freeze', '');
    style.textContent = \`
      *, *::before, *::after {
        animation-iteration-count: 1 !important;
        animation-fill-mode: forwards !important;
        animation-duration: 0.001s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    \`;
    document.head.appendChild(style);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  }
  return { finite: finite.length, endless: endless.length };
})()`;

/** 钉住日期文本。和 baseline.cjs 同因：`todayStamp` / `tpl-corner-date` 取当前日期。 */
const FREEZE_DATES = `(() => {
  const stamp = document.querySelector('.today-stamp > span');
  if (stamp) stamp.textContent = 'FRI · NOV 14';
  const corner = document.querySelector('.tpl-corner-date');
  if (corner) corner.innerHTML = '2026<br>1114';
  return 1;
})()`;

guard(async () => {
  const probe = await launch({
    width: SIZES[0].width,
    height: SIZES[0].height,
    expand: false,
    settle: 5200,
    patch: PATCH,
  });

  fs.mkdirSync(OUT_ROOT, { recursive: true });

  // 资产必须种完再刷新：播放要真音频，原因见 harness.cjs 里 MEDIA_AUDIO 的注释。
  for (const record of RECORDS) {
    await probe.seedAsset(record.assetId, MEDIA_AUDIO);
  }

  // 随机源与日期钉死的方式和 baseline.cjs 完全一致：必须走 CDP 的
  // addScriptToEvaluateOnNewDocument，才能在页面脚本跑起来之前生效。
  // 在页面里直接改 Math.random 已经晚了——`sleeves.ts` 在模块求值时就
  // 算好了 launchSeed，封套配色早已定下。
  const debuggerApi = probe.win.webContents.debugger;
  debuggerApi.attach('1.3');
  await debuggerApi.sendCommand('Page.enable');
  await debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      let s = 0x9e3779b9;
      Math.random = () => {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const RealDate = Date;
      const BASE = 1763164800000;
      let offset = 0;
      const at = () => BASE + offset;
      class FixedDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(at()); else super(...args); }
        static now() { return at(); }
      }
      window.Date = FixedDate;
      window.__probeClock = {
        advance(ms) { offset += ms; return at(); },
        now() { return at(); },
      };
    })()`,
  });

  const files = [];
  for (const size of SIZES) {
    probe.win.setContentSize(size.width, size.height);
    // 每个尺寸都重载：清掉上一轮尺寸留下的 React 状态（焦点、翻开的卡片、
    // 播放器展开态……）。种子脚本会随重载重跑，随机序列回到同一初值，
    // 所以封套配色不会变，可比性保住了。
    await probe.run('location.reload()').catch(() => {});
    await wait(5200);
    await wait(900);

    for (const view of VIEWS) {
      await probe.run(switchView(view.label));
      await wait(1200);
      await probe.run(FREEZE);
      await probe.run(FREEZE_DATES);
      await wait(200);

      const snapshot = await probe.styleSnapshot();
      const name = `${size.id}-${view.id}`;
      const text = flatten(snapshot);
      fs.writeFileSync(path.join(OUT_ROOT, `${name}.txt`), text);
      files.push({ name, size: size.id, view: view.id, elements: snapshot.count });
      console.log(`[style] ${name}  ${snapshot.count} 个元素伪元素块  ${text.split('\n').length - 1} 行`);
    }
  }

  fs.writeFileSync(
    path.join(OUT_ROOT, 'manifest.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      distIndex: fs.statSync(path.join(ROOT, 'dist', 'index.html')).mtime.toISOString(),
      dpr: Number(process.env.PROBE_DPR || 1),
      sizes: SIZES,
      views: VIEWS,
      files,
    }, null, 2),
  );

  console.log(`[style] 完成 ${files.length} 份，输出在 ${OUT_ROOT}`);
  probe.close();
});
