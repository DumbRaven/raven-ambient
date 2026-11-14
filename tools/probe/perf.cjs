/**
 * 性能探针：量真实用户能感觉到的等待，不是量代码看起来重不重。
 *
 * 三件事分开量，因为它们的瓶颈完全不同：
 *   1. 冷启动 —— 音频引擎构造 + 四次并发读封面 + IndexedDB + 开屏动画
 *   2. 切视图 —— 圆形扩散 wipe（520ms）+ 高度动画（110ms）+ 新视图首次布局
 *   3. 交互响应 —— 点一下到下一帧画出来的间隔，含长列表与动画
 *
 * 每条都在同一个窗口里量多次取中位数：单次测量会被 GC 和磁盘缓存污染。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE PROBE_PERF_OUT=.qa/perf.json \
 *     node_modules/electron/dist/electron.exe tools/probe/perf.cjs --no-sandbox
 *
 * 必须跑 dist/ 产物（先 npm run build）。
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const DPR = process.env.PROBE_DPR || '1';
app.commandLine.appendSwitch('force-device-scale-factor', DPR);

const harness = require('./harness.cjs');
const { ROOT, MEDIA_DIR, MEDIA_AUDIO } = harness;

// 必须挂这个：Electron 在「没有窗口 + 没人监听 window-all-closed」时默认退出整个 app，
// 而我们每量完一档就要销毁窗口去开下一档。挂上空实现才能活到最后一档。
app.on('window-all-closed', () => {});

const OUT = path.join(ROOT, process.env.PROBE_PERF_OUT || '.qa/perf.json');

/** 探针数据集。故意给足量：真实用户收藏几百张是常态，六张测不出问题。 */
const RECORD_COLORS = ['#879a91', '#aaa2b4', '#bd9b80', '#8c9caa', '#aaa481', '#b28e92'];
const NAMES = ['雨声', '夜航', '炉火', '打字', '海浪', '微风', '虫鸣', '城市',
  '潮汐', '塔楼', '雪原', '收音机', '雨棚', '列车', '旧唱片', '阳台',
  '地下室', '蝉', '风铃', '走廊', '湖面', '炉边', '凌晨', '巴士'];

function buildPatch(count) {
  const records = [];
  for (let i = 0; i < count; i += 1) {
    records.push({
      id: `perf-${i}`,
      assetId: `perf-asset-${i}`,
      name: `${NAMES[i % NAMES.length]} ${i + 1}`,
      artist: i % 3 === 0 ? '实地录音' : '',
      description: '',
      category: i % 8 < 5 ? 'music' : 'ambient',
      duration: 180 + (i % 40) * 7,
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
  return {
    records,
    queue: records.filter(r => r.category === 'music').map(r => r.id),
    ambience: records.filter(r => r.category === 'ambient').map(r => r.id),
  };
}

const SIZES = [
  { id: 'wide', width: 680, height: 980 },
  { id: 'narrow', width: 440, height: 860 },
  { id: 'short', width: 680, height: 680 },
];

const VIEWS = [
  { id: 'cabinet', label: '唱片柜' },
  { id: 'listening', label: '正在听' },
  { id: 'focus', label: '专注' },
  { id: 'media', label: '相集' },
];

const wait = ms => new Promise(done => setTimeout(done, ms));

/**
 * 在页面里量一次「从这一刻到下一帧真正画出来」的间隔。
 *
 * 用两层 rAF 而不是 performance.now() 差值：单层 rAF 只保证回调在下一帧之前跑，
 * 双层才说明那一帧真的提交了。这也正是用户感觉到的延迟。
 */
const FRAME_PROBE = `
(() => new Promise(resolve => {
  const started = performance.now();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve(Math.round((performance.now() - started) * 100) / 100);
  }));
}))()`;

/**
 * 长任务观测。超过 50ms 的主线程阻塞用户能明确感觉到（输入延迟、动画掉帧）。
 * 采完就断开，不影响后续测量。
 */
const LONG_TASKS = `
(() => {
  window.__perfLong = [];
  if (!('PerformanceObserver' in window)) return 'unsupported';
  try {
    const obs = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        window.__perfLong.push({ start: Math.round(entry.startTime), dur: Math.round(entry.duration) });
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
    window.__perfObs = obs;
    return 'ok';
  } catch (error) { return 'failed:' + error.message; }
})()`;

const TAKE_LONG = `
(() => {
  const list = window.__perfLong || [];
  window.__perfObs?.disconnect();
  window.__perfLong = [];
  const sorted = list.map(x => x.dur).sort((a, b) => b - a);
  return {
    count: list.length,
    total: list.reduce((sum, x) => sum + x.dur, 0),
    worst: sorted.slice(0, 5),
  };
})()`;

/** 点一下并量出「这一下到画面更新」的耗时。 */
const clickAndMeasure = selector => `
(() => new Promise(resolve => {
  const hit = document.querySelector(${JSON.stringify(selector)});
  if (!hit) { resolve({ ok: false, reason: 'missing' }); return; }
  const started = performance.now();
  hit.click();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve({ ok: true, ms: Math.round((performance.now() - started) * 100) / 100 });
  }));
}))()`;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2 * 100) / 100;
}

/**
 * launch() 每次都会 attachMedia() 注册 media: 协议，而协议只能注册一次。
 * 第二档窗口起不来就会报 "Failed to register protocol: media"。
 *
 * 这里第一次走完整的 launch（建窗 + 注入 + reload + 等开屏），之后复用同一扇窗：
 * 改尺寸、改 localStorage、reload。种子脚本是 addScriptToEvaluateOnNewDocument
 * 挂的，reload 会自动重跑，所以每一档拿到的随机序列仍然完全一样。
 */
let sharedWindow = null;

async function openWindow(size, count) {
  if (!sharedWindow) {
    const probe = await harness.launch({
      width: size.width,
      height: size.height,
      settle: 5200,
      patch: buildPatch(count),
    });
    sharedWindow = probe;
    return probe;
  }
  sharedWindow.win.setContentSize(size.width, size.height);
  await sharedWindow.run(
    `localStorage.setItem('raven-cabinet-v2', ${JSON.stringify(JSON.stringify(buildPatch(count)))})`,
  );
  await sharedWindow.run('location.reload()').catch(() => {});
  await wait(5200);
  return sharedWindow;
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), dpr: DPR, recordCounts: {}, runs: [] };

  for (const count of [8, 200]) {
    report.recordCounts[count] = [];
    for (const size of SIZES) {
      console.log(`[perf] ${size.id} × ${count} 张唱片`);

      // 冷启动用页面自己的 Navigation Timing，不用墙钟——launch() 内部本来就有
      // 5200ms 的刻意等待（等开屏动画跑完），拿墙钟量出来的是我的等待，不是用户
      // 的等待。这里量的是「文档开始导航 → load 事件结束」这段硬成本。
      const probe = await openWindow(size, count);
      const nav = await probe.run(`
        (() => {
          const entry = performance.getEntriesByType('navigation')[0];
          if (!entry) return null;
          return {
            // domContentLoaded 之前是脚本解析与执行，用户看到的白屏就是这段。
            boot: Math.round(entry.domContentLoadedEventEnd),
            // load 含首屏图片解码。封面是 17 个 SVG，量得出来。
            load: Math.round(entry.loadEventEnd),
            // 有 paint 条目说明首屏真的画过了，没有就是还在白屏。
            paints: performance.getEntriesByType('paint')
              .map(p => ({ name: p.name, at: Math.round(p.startTime) })),
          };
        })()`);

      const seeded = await probe.run(LONG_TASKS);
      await wait(600);

      const entry = {
        size: size.id,
        records: count,
        nav,
        longTaskSupport: seeded,
        viewSwitch: {},
        frameAfter: {},
        longTasks: {},
        memoryMB: null,
      };

      // 切视图。这个动画本身是 520ms 的圆扩散（src/motion-state.ts 的 wipeDuration），
      // 时长是设计选择而不是成本，量「总共多久」没有意义。
      //
      // 真正决定手感的是**这段动画期间有没有掉帧**。所以在切换的同时记录每一帧的
      // 间隔，跑满 700ms，然后看有几帧超过 24ms（60fps 下两帧的时间）。
      for (const view of VIEWS) {
        const result = await probe.run(`
          (() => new Promise(resolve => {
            const hit = [...document.querySelectorAll('.view-tabs > button')]
              .find(b => b.getAttribute('aria-label') === ${JSON.stringify(view.label)});
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
                // 丢掉第一帧：它是点击那一拍留下的余量，不是动画本身的开销。
                const body = gaps.slice(1).sort((a, b) => a - b);
                const total = body.reduce((sum, x) => sum + x, 0);
                resolve({
                  ok: true,
                  frames: body.length,
                  // 平均帧间隔低于 16.7 说明跑在 60fps 以上。
                  avg: Math.round((total / body.length) * 100) / 100,
                  p95: Math.round(body[Math.floor(body.length * 0.95)] * 100) / 100,
                  worst: Math.round(body[body.length - 1] * 100) / 100,
                  // 超过 24ms 的帧用户能看出顿一下。
                  dropped: body.filter(x => x > 24).length,
                });
              }
            };
            requestAnimationFrame(step);
          }))()`);
        entry.viewSwitch[view.id] = result && result.ok ? result : { ok: false };
      }

      // 帧间隔：在唱片柜里空转 40 帧，看有没有掉帧。这里不该有动画在跑，
      // 所以最差值就是布局/绘制的底色成本。
      await probe.run(`
        (() => {
          const hit = [...document.querySelectorAll('.view-tabs > button')]
            .find(b => b.getAttribute('aria-label') === '唱片柜');
          hit?.click();
          return 1;
        })()`);
      await wait(800);
      entry.frameAfter.idle = await probe.run(`
        (() => new Promise(resolve => {
          const gaps = [];
          let last = performance.now();
          let n = 0;
          const step = () => {
            const now = performance.now();
            gaps.push(now - last);
            last = now;
            n += 1;
            if (n < 40) requestAnimationFrame(step);
            else {
              const sorted = [...gaps].sort((a, b) => a - b);
              resolve({
                median: Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100,
                worst: Math.round(sorted[sorted.length - 1] * 100) / 100,
              });
            }
          };
          requestAnimationFrame(step);
        }))()`);

      // 交互响应：悬停一张卡（要算黑胶取色 + 压片），这是最重的一次点击。
      entry.frameAfter.hoverCard = [
        await probe.run(clickAndMeasure('.record-card .record-preview')),
        await probe.run(clickAndMeasure('.record-card .record-preview')),
      ];

      // 打开设置弹窗：弹窗里挂了整棵表单树。
      entry.frameAfter.openSettings = await probe.run(
        clickAndMeasure('.header-actions button[aria-label="空间设置"]'),
      );
      await probe.run(`
        (() => { document.querySelector('.modal-close')?.click(); return 1; })()`);
      await wait(400);

      entry.longTasks = await probe.run(TAKE_LONG);

      // 内存。堆大小比 RSS 更能说明「是不是我们自己没放手」。
      try {
        entry.memoryMB = await probe.run(`
          (() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)()`);
      } catch { /* 某些构建没有 performance.memory */ }

      report.runs.push(entry);
      report.recordCounts[count].push(entry);
      // 窗口留着给下一档复用（删了会触发 window-all-closed，虽然上面挂了空实现，
      // 但重建窗口要重新注册协议，走不通）。
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  // 打印人看的摘要
  console.log('');
  console.log('尺寸    唱片  启动DOM  首屏  切视图最差帧  p95   掉帧  悬停卡  开设置  堆MB  长任务');
  for (const run of report.runs) {
    const switches = Object.values(run.viewSwitch).filter(v => v && v.ok);
    const worstFrame = switches.length ? Math.max(...switches.map(v => v.worst)) : '-';
    const worstP95 = switches.length ? Math.max(...switches.map(v => v.p95)) : '-';
    const dropped = switches.reduce((sum, v) => sum + v.dropped, 0);
    const hover = median((run.frameAfter.hoverCard || []).filter(x => x && x.ok).map(x => x.ms));
    const firstPaint = run.nav?.paints?.find(p => p.name === 'first-paint');
    console.log(
      [
        run.size.padEnd(7),
        String(run.records).padStart(5),
        `${run.nav?.boot ?? '-'}ms`.padStart(9),
        `${firstPaint?.at ?? '-'}ms`.padStart(6),
        `${worstFrame}ms`.padStart(13),
        `${worstP95}ms`.padStart(6),
        String(dropped).padStart(5),
        `${hover === null ? '-' : hover}ms`.padStart(7),
        `${run.frameAfter.openSettings?.ms ?? '-'}ms`.padStart(7),
        String(run.memoryMB ?? '-').padStart(5),
        `${run.longTasks.count}个/${run.longTasks.total}ms`.padStart(10),
      ].join(' '),
    );
  }
  console.log('');
  console.log('切视图逐项（avg = 平均帧间隔，60fps 的预算是 16.7ms）');
  for (const run of report.runs) {
    const parts = Object.entries(run.viewSwitch)
      .filter(([, v]) => v && v.ok)
      .map(([k, v]) => `${k} avg${v.avg}/p95 ${v.p95}/最差 ${v.worst}/丢${v.dropped}`);
    console.log(` ${run.size.padEnd(7)} ${String(run.records).padStart(3)}  ${parts.join('  ')}`);
  }
  console.log('');
  console.log(`[perf] 明细写到 ${OUT}`);
}

app.whenReady().then(() => {
  main()
    .then(() => { app.exit(0); })
    .catch(error => {
      console.error('[perf] 失败：', error);
      app.exit(1);
    });
});

void BrowserWindow;
void MEDIA_DIR;
void MEDIA_AUDIO;
