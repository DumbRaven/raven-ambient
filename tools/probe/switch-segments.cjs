/**
 * 决定性测试：切页之后「什么都不再做」，帧间隔会不会回到 16.66ms。
 *
 * 现状（全部背靠背多轮、已预热）：
 *   静止态（切页后等 1.5 秒再量）      16.66ms  ← 环境能跑满 60fps
 *   切页瞬间开始量（700ms 窗口）        20.2ms
 *   关掉 CSS 动画                       19.6ms
 *   关掉高度动画                        19.8ms
 *   两个都关                            19.3ms  ← 仍慢 2.7ms
 *
 * 两个都关还是慢，说明开销既不是动画也不是高度。剩下两种可能：
 *   A. 切页后有一段时间确实在忙（某次重排、图片解码、字体回退……）
 *   B. 是我的测量本身在制造这个数字——从 click() 那一刻起量，点击造成的
 *      帧调度变化被算进去了
 *
 * 这一版在**同一次切页**里连续量三段：
 *   段1  0 - 700ms    （动画期）
 *   段2  700 - 1400ms （动画刚结束）
 *   段3  1400 - 2100ms（完全静止）
 * 如果段3 回到 16.66，说明开销只存在于切换后一小段时间，A 成立；
 * 如果三段都是 20ms，那就是测量伪影，B 成立 —— 之前的结论全要作废。
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

const threeSegments = target => `
(() => new Promise(resolve => {
  const home = [...document.querySelectorAll('.view-tabs > button')].find(b => b.getAttribute('aria-label') === '唱片柜');
  home?.click();
  setTimeout(() => {
    const hit = [...document.querySelectorAll('.view-tabs > button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(target)});
    if (!hit) { resolve({ ok: false }); return; }

    const seg = [[], [], []];       // 三段各自的帧间隔
    let last = performance.now();
    const started = last;
    hit.click();

    const step = () => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      const t = now - started;
      if (t < 700) seg[0].push(gap);
      else if (t < 1400) seg[1].push(gap);
      else if (t < 2100) seg[2].push(gap);
      if (t < 2100) requestAnimationFrame(step);
      else {
        const stat = xs => {
          const body = xs.slice(1).sort((a, b) => a - b);   // 丢掉每段第一帧（跨段边界的残值）
          if (!body.length) return null;
          const total = body.reduce((s, x) => s + x, 0);
          return {
            frames: body.length,
            avg: Math.round(total / body.length * 100) / 100,
            median: Math.round(body[Math.floor(body.length / 2)] * 100) / 100,
            over17: body.filter(x => x > 17).length,
          };
        };
        resolve({ ok: true, s0: stat(seg[0]), s1: stat(seg[1]), s2: stat(seg[2]) });
      }
    };
    requestAnimationFrame(step);
  }, 900);
}))()`;

app.whenReady().then(async () => {
  const probe = await H.launch({ width: 680, height: 980, settle: 5200, patch });
  try {
    for (const record of patch.records) await probe.seedAsset(record.assetId, MEDIA_AUDIO);

    // 预热
    for (const t of ['正在听', '相集', '正在听', '相集']) {
      await probe.run(threeSegments(t));
      await wait(500);
    }

    for (const target of ['正在听', '相集']) {
      const acc = [[], [], []];
      for (let i = 0; i < 4; i += 1) {
        const r = await probe.run(threeSegments(target));
        if (r.ok) {
          acc[0].push(r.s0); acc[1].push(r.s1); acc[2].push(r.s2);
        }
        await wait(500);
      }
      const pick = (arr, key) => {
        const s = arr.map(x => x[key]).sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      console.log(`\n=== ${target} ===`);
      ['段1 0-700ms（动画期）', '段2 700-1400ms', '段3 1400-2100ms（静止）'].forEach((name, idx) => {
        console.log(`  ${name.padEnd(24)} avg ${String(pick(acc[idx], 'avg')).padStart(6)}  中位 ${String(pick(acc[idx], 'median')).padStart(6)}  超17ms ${pick(acc[idx], 'over17')}`);
      });
    }
  } finally {
    await probe.close();
    app.exit(0);
  }
});
