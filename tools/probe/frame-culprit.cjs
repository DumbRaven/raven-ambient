/**
 * 第二层诊断：clip-path 之外还剩什么。
 *
 * 上一轮 wipe-cost.cjs 的结论是「关掉圆扩散能把正在听从 30ms 压到 22ms」，
 * 但 22ms 仍然超过 60fps 的 16.7ms 预算。所以还有第二笔开销。
 *
 * 这里逐个关掉候选，看哪一项真的吃帧：
 *   - 黑胶：repeating-radial-gradient 铺满一个圆 + filter: drop-shadow
 *   - 票根：多组 drop-shadow（顺着 alpha 轮廓走，比 box-shadow 贵）
 *   - 唱臂：transform + 1.4s ease 过渡
 *   - 全部 animation
 *
 * 每次只关一项，其余保持原样。哪一项单独关掉后帧间隔回到 16.7 附近，它就是元凶。
 */
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const harness = require('./harness.cjs');
const { ROOT, MEDIA_AUDIO } = harness;
app.on('window-all-closed', () => {});

const RECORD_COLORS = ['#879a91', '#aaa2b4', '#bd9b80', '#8c9caa', '#aaa481', '#b28e92'];
const NAMES = ['雨声', '夜航', '炉火', '打字', '海浪', '微风', '虫鸣', '城市'];

function buildPatch(count) {
  const records = [];
  for (let i = 0; i < count; i += 1) {
    records.push({
      id: `perf-${i}`,
      assetId: `perf-asset-${i}`,
      name: `${NAMES[i % NAMES.length]} ${i + 1}`,
      artist: '',
      description: '',
      category: i % 8 < 5 ? 'music' : 'ambient',
      duration: 200,
      format: 'mp3',
      size: 4_000_000,
      color: RECORD_COLORS[i % RECORD_COLORS.length],
      fingerprint: `perf-fingerprint-${i}`,
      volume: 0.8,
      pan: 0,
      warmth: 0.4,
      duckDepth: 12,
    });
  }
  return { records, queue: [], ambience: [] };
}

const wait = ms => new Promise(done => setTimeout(done, ms));

/** 各种「只关一项」的 CSS。空字符串表示原样。 */
const VARIANTS = [
  { id: '原样', css: '' },
  { id: '关圆扩散', css: '.view-stage, .view-stage[data-motion] { animation: none !important; }' },
  {
    id: '扩散+关黑胶投影',
    css: `.view-stage, .view-stage[data-motion] { animation: none !important; }
          .vinyl, .platter .vinyl { filter: none !important; }`,
  },
  {
    id: '扩散+关黑胶渐变',
    css: `.view-stage, .view-stage[data-motion] { animation: none !important; }
          .vinyl { background: #1c1c1c !important; }
          .vinyl::before { display: none !important; }`,
  },
  {
    id: '扩散+关票根投影',
    css: `.view-stage, .view-stage[data-motion] { animation: none !important; }
          .ticket, .ticket *, .ticket-lift, .ticket-sheet { filter: none !important; }`,
  },
  {
    id: '扩散+关全部动画',
    css: `.view-stage, .view-stage[data-motion] { animation: none !important; }
          *, *::before, *::after { animation: none !important; transition: none !important; }`,
  },
];

const measure = (label, css) => `
(() => new Promise(resolve => {
  const old = document.getElementById('probe-variant');
  if (old) old.remove();
  if (${JSON.stringify(css)}) {
    const style = document.createElement('style');
    style.id = 'probe-variant';
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
  }
  const home = [...document.querySelectorAll('.view-tabs > button')]
    .find(b => b.getAttribute('aria-label') === '唱片柜');
  home?.click();
  setTimeout(() => {
    const hit = [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!hit) { resolve({ ok: false }); return; }
    const gaps = [];
    let last = performance.now();
    const started = last;
    hit.click();
    const step = () => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (now - started < 700) requestAnimationFrame(step);
      else {
        const body = gaps.slice(1).sort((a, b) => a - b);
        const total = body.reduce((sum, x) => sum + x, 0);
        resolve({
          ok: true,
          avg: Math.round((total / body.length) * 100) / 100,
          worst: Math.round(body[body.length - 1] * 100) / 100,
          dropped: body.filter(x => x > 24).length,
        });
      }
    };
    requestAnimationFrame(step);
  }, 900);
}))()`;

async function main() {
  const probe = await harness.launch({
    width: 680,
    height: 980,
    settle: 5200,
    patch: buildPatch(24),
  });
  for (const record of buildPatch(24).records) {
    await probe.seedAsset(record.assetId, MEDIA_AUDIO);
  }

  const out = {};
  for (const view of ['正在听', '相集']) {
    out[view] = [];
    console.log(`\n=== ${view} ===`);
    for (const variant of VARIANTS) {
      const result = await probe.run(measure(view, variant.css));
      await wait(1100);
      out[view].push({ variant: variant.id, ...result });
      console.log(`  ${variant.id.padEnd(18)} avg${String(result.avg).padStart(6)}/最差${String(result.worst).padStart(6)}/丢${result.dropped}`);
    }
  }

  const file = path.join(ROOT, '.qa', 'frame-culprit.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\n[frame-culprit] 写到 ${file}`);
}

app.whenReady().then(() => {
  main().then(() => app.exit(0)).catch(error => {
    console.error('[frame-culprit] 失败：', error);
    app.exit(1);
  });
});
