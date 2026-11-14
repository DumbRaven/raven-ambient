/**
 * 圆扩散能不能便宜下来。
 *
 * 已知：切到「正在听」时平均帧间隔 30ms（预算 16.7ms），关掉圆扩散回到 21.8ms。
 * 贵的部分在 `clip-path: circle(var(--wipe-r) at ...)`：半径是自定义属性，
 * 浏览器每帧都要重新解析、重新裁剪整棵子树，走主线程重绘。
 *
 * 三个不改观感的候选：
 *   A. 给舞台加 will-change / 独立图层，让裁剪在合成阶段做
 *   B. 动画的起点终点写死成百分比（不用 var），减少每帧的属性解析
 *   C. 把连续两帧的半径量化（steps），少算几次
 *
 * 每个候选单独插一段样式覆盖，只量「正在听」这页，其余不动。
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

const CANDIDATES = [
  { id: '基线', css: '' },
  {
    id: 'A 独立图层',
    css: `.view-stage { will-change: clip-path; contain: paint; }`,
  },
  {
    id: 'A2 图层+背面',
    css: `.view-stage { will-change: clip-path; backface-visibility: hidden; transform: translateZ(0); }`,
  },
  {
    id: 'B 写死半径',
    css: `.view-stage[data-motion="enter"] {
            animation-name: probe-wipe-fixed !important;
          }
          @keyframes probe-wipe-fixed {
            from { clip-path: circle(0% at 50% 0%); }
            to   { clip-path: circle(150% at 50% 0%); }
          }`,
  },
  {
    id: 'C 量化成 12 步',
    css: `.view-stage[data-motion="enter"] {
            animation-timing-function: steps(12, end) !important;
          }`,
  },
  {
    id: 'A+B 图层+写死',
    css: `.view-stage { will-change: clip-path; contain: paint; }
          .view-stage[data-motion="enter"] {
            animation-name: probe-wipe-fixed !important;
          }
          @keyframes probe-wipe-fixed {
            from { clip-path: circle(0% at 50% 0%); }
            to   { clip-path: circle(150% at 50% 0%); }
          }`,
  },
];

const measure = (label, css, keepEnter) => `
(() => new Promise(resolve => {
  const old = document.getElementById('probe-cand');
  if (old) old.remove();
  if (${JSON.stringify(css)}) {
    const style = document.createElement('style');
    style.id = 'probe-cand';
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
  for (const target of ['正在听', '相集']) {
    console.log(`\n=== ${target} ===`);
    for (const candidate of CANDIDATES) {
      // 每个候选跑两遍取平均，单次会被 GC 污染。
      const first = await probe.run(measure(target, candidate.css));
      await wait(900);
      const second = await probe.run(measure(target, candidate.css));
      await wait(900);
      const avg = Math.round((first.avg + second.avg) / 2 * 100) / 100;
      const row = { target, id: candidate.id, avg, first, second };
      rows.push(row);
      console.log(
        `  ${candidate.id.padEnd(14)} avg${String(avg).padStart(6)}` +
        `  (${first.avg} / ${second.avg})  丢${first.dropped}+${second.dropped}`,
      );
    }
  }

  const file = path.join(ROOT, '.qa', 'wipe-fix.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`\n[wipe-fix] 写到 ${file}`);
}

app.whenReady().then(() => {
  main().then(() => app.exit(0)).catch(error => {
    console.error('[wipe-fix] 失败：', error);
    app.exit(1);
  });
});
