/**
 * 有没有「一直卡」的页面。
 *
 * 上面两轮量到的都是切换那一下。但 frame-culprit 的相集那栏显示：关掉圆扩散
 * 只省 1.1ms，关掉全部动画却省 6.5ms —— 这说明相集里有**一直在跑**的动画，
 * 和切换无关。那种卡不是「切换时顿一下」，是停留在这页就一直掉帧，
 * 用户会持续感觉到（鼠标发飘、滚动不跟手）。
 *
 * 这里只量静止态：切到某页、等它稳定、然后空转 90 帧看帧间隔。
 * 对比「关掉全部动画」的同一页，差值就是常驻动画的成本。
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

/** 切到某页，稳定后空转 90 帧。kill 为真时先把全部动画停掉。 */
const idle = (label, kill) => `
(() => new Promise(resolve => {
  const old = document.getElementById('probe-kill');
  if (old) old.remove();
  if (${kill}) {
    const style = document.createElement('style');
    style.id = 'probe-kill';
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(style);
  }
  const hit = [...document.querySelectorAll('.view-tabs > button')]
    .find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)});
  hit?.click();
  // 等切换完全结束（wipe 520ms + 高度动画 110ms + 余量）。
  setTimeout(() => {
    const gaps = [];
    let last = performance.now();
    let n = 0;
    const step = () => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      n += 1;
      if (n < 90) requestAnimationFrame(step);
      else {
        const body = gaps.slice(2).sort((a, b) => a - b);
        const total = body.reduce((sum, x) => sum + x, 0);
        resolve({
          avg: Math.round((total / body.length) * 100) / 100,
          p95: Math.round(body[Math.floor(body.length * 0.95)] * 100) / 100,
          worst: Math.round(body[body.length - 1] * 100) / 100,
          dropped: body.filter(x => x > 24).length,
        });
      }
    };
    requestAnimationFrame(step);
  }, 1600);
}))()`;

/** 顺便把页面里「无限循环」的动画名列出来，指出到底是谁在跑。 */
const ENDLESS = `
(() => {
  const found = new Map();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = list => {
      for (const rule of list) {
        if (rule.cssRules) { walk(rule.cssRules); continue; }
        if (rule.type !== CSSRule.KEYFRAMES_RULE) continue;
        found.set(rule.name, rule.cssText.length);
      }
    };
    walk(rules);
  }
  // 再看实际在跑的那些元素：动画名 + 元素签名 + 用了几次
  const running = [];
  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    for (const name of style.animationName.split(',')) {
      const trimmed = name.trim();
      if (!trimmed || trimmed === 'none') continue;
      if (style.animationIterationCount.split(',')[0].trim() !== 'infinite') continue;
      running.push({
        name: trimmed,
        el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
        play: style.animationPlayState.split(',')[0].trim(),
      });
    }
  }
  return { defined: [...found.keys()], running };
})()`;

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
  for (const view of ['唱片柜', '正在听', '专注', '相集']) {
    const live = await probe.run(idle(view, false));
    await wait(900);
    const still = await probe.run(idle(view, true));
    await wait(900);
    rows.push({ view, live, still });
    console.log(
      `${view.padEnd(4)} 动画在跑 avg${String(live.avg).padStart(6)}/p95${String(live.p95).padStart(6)}/丢${String(live.dropped).padStart(2)}` +
      `    全停 avg${String(still.avg).padStart(6)}/p95${String(still.p95).padStart(6)}/丢${String(still.dropped).padStart(2)}`,
    );
  }

  // 谁在无限跑
  await probe.run(idle('相集', false));
  await wait(1500);
  const endless = await probe.run(ENDLESS);
  console.log('\n页面里在无限循环的动画：');
  const byName = new Map();
  for (const item of endless.running) {
    byName.set(item.name, (byName.get(item.name) || 0) + 1);
  }
  for (const [name, count] of [...byName].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(28)} ${count} 个元素`);
  }
  const paused = endless.running.filter(x => x.play !== 'running').length;
  console.log(`  其中 ${paused} 个是暂停态（animation-play-state: paused，不产生开销）`);

  const file = path.join(ROOT, '.qa', 'idle-frames.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ rows, endless }, null, 2));
  console.log(`\n[idle-frames] 写到 ${file}`);
}

app.whenReady().then(() => {
  main().then(() => app.exit(0)).catch(error => {
    console.error('[idle-frames] 失败：', error);
    app.exit(1);
  });
});
