/**
 * 基线体检：不切页、不做任何事，只在每页静止 3 秒，量帧间隔。
 *
 * 先确认「静止态能不能跑满 60fps」这件事本身。
 * 如果静止态就是 20ms，那前面所有「切页 20ms」的结论都得推翻重来——
 * 那说明是探针环境本身跑不满，跟应用无关。
 */
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const H = require('./harness.cjs');
const { ROOT, MEDIA_AUDIO } = H;
app.on('window-all-closed', () => {});

const COLORS = ['#879a91', '#aaa2b4', '#bd9b80', '#8c9caa', '#aaa481', '#b28e92'];
const NAMES = ['雨声', '夜航', '炉火', '打字', '海浪', '微风', '虫鸣', '城市'];
const patch = (() => {
  const records = [];
  for (let i = 0; i < 24; i += 1) {
    records.push({
      id: `perf-${i}`, assetId: `perf-asset-${i}`, name: `${NAMES[i % NAMES.length]} ${i + 1}`,
      artist: '', description: '', category: i % 8 < 5 ? 'music' : 'ambient',
      duration: 200, format: 'mp3', size: 4_000_000,
      color: COLORS[i % COLORS.length], fingerprint: `perf-fp-${i}`,
      volume: 0.8, pan: 0, warmth: 0.4, duckDepth: 12,
    });
  }
  return { records, queue: [], ambience: [] };
})();

const wait = ms => new Promise(done => setTimeout(done, ms));

const idle3s = label => `
(() => new Promise(resolve => {
  const hit = [...document.querySelectorAll('.view-tabs > button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)});
  hit?.click();
  setTimeout(() => {
    const gaps = [];
    let last = performance.now();
    const started = last;
    const step = () => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (now - started < 3000) requestAnimationFrame(step);
      else {
        const body = gaps.slice(2).sort((a, b) => a - b);
        const total = body.reduce((s, x) => s + x, 0);
        resolve({
          frames: body.length,
          avg: Math.round(total / body.length * 100) / 100,
          median: Math.round(body[Math.floor(body.length / 2)] * 100) / 100,
          p95: Math.round(body[Math.floor(body.length * 0.95)] * 100) / 100,
          worst: Math.round(body[body.length - 1] * 100) / 100,
          over16: body.filter(x => x > 17).length,
          over33: body.filter(x => x > 33).length,
        });
      }
    };
    requestAnimationFrame(step);
  }, 1500);
}))()`;

app.whenReady().then(async () => {
  const probe = await H.launch({ width: 680, height: 980, settle: 5200, patch });
  try {
    for (const record of patch.records) await probe.seedAsset(record.assetId, MEDIA_AUDIO);
    await wait(1500);
    const rows = [];
    for (const label of ['唱片柜', '正在听', '专注', '相集']) {
      const r = await probe.run(idle3s(label));
      rows.push({ label, ...r });
      console.log(`  ${label.padEnd(4)} ${String(r.frames).padStart(4)}帧 avg${String(r.avg).padStart(6)} 中位${String(r.median).padStart(6)} p95 ${String(r.p95).padStart(6)} 最差 ${String(r.worst).padStart(7)} 超17ms ${String(r.over16).padStart(4)} 超33ms ${r.over33}`);
      await wait(800);
    }
    const file = path.join(ROOT, '.qa', 'idle3s.json');
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    console.log(`\n[idle3s] ${file}`);
  } finally {
    await probe.close();
    app.exit(0);
  }
});
