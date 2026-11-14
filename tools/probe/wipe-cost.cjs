/**
 * 验证「切视图掉帧是 clip-path 圆扩散造成的」这个判断。
 *
 * 做法是对照着量同一段切换，只改一个变量：
 *   A. 默认状态，原样切
 *   B. 在页面里覆盖 `.view-stage` 的 animation 为 none，但保留 520ms 的等待
 *      —— 结构没变、React 照样重新挂载子树，只是不做裁剪动画
 *
 * 如果 B 的帧间隔回到 16.7ms，掉帧就是裁剪造成的；如果 B 还是慢，说明贵在
 * 别的地方（挂载本身），那方向就得换。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/wipe-cost.cjs --no-sandbox
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

/** 切到某个视图并记录 700ms 内的帧间隔。killWipe 为真时把那层动画换成 none。 */
const measure = (label, killWipe) => `
(() => new Promise(resolve => {
  let style = document.getElementById('probe-kill-wipe');
  if (${killWipe}) {
    if (!style) {
      style = document.createElement('style');
      style.id = 'probe-kill-wipe';
      // 只杀动画，不动 520ms 的等待：这样 React 的重挂节奏和真实情况一致，
      // 唯一变量就是「有没有逐帧裁剪」。
      style.textContent = '.view-stage, .view-stage[data-motion] { animation: none !important; }';
      document.head.appendChild(style);
    }
  } else if (style) style.remove();

  // 先回唱片柜，保证每次测量起点一致。
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
          p95: Math.round(body[Math.floor(body.length * 0.95)] * 100) / 100,
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

  const rows = [];
  for (const view of ['正在听', '相集', '唱片柜', '专注']) {
    const withWipe = await probe.run(measure(view, false));
    await wait(1200);
    const noWipe = await probe.run(measure(view, true));
    await wait(1200);
    rows.push({ view, withWipe, noWipe });
    console.log(
      `${view.padEnd(4)} 有裁剪 avg${withWipe.avg}/最差${withWipe.worst}/丢${withWipe.dropped}` +
      `    无裁剪 avg${noWipe.avg}/最差${noWipe.worst}/丢${noWipe.dropped}`,
    );
  }

  const out = path.join(ROOT, '.qa', 'wipe-cost.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`[wipe-cost] 写到 ${out}`);
}

app.whenReady().then(() => {
  main().then(() => app.exit(0)).catch(error => {
    console.error('[wipe-cost] 失败：', error);
    app.exit(1);
  });
});
