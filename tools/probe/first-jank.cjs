/**
 * 查「第一次点放映卡一下」的真正来源。
 *
 * 上次用 rAF 帧间隔量，结论是「没有停顿」（最坏 34.5ms）——但那是在
 * **已经是放映页**、再切回来量的，而且取色早就缓存好了。
 *
 * 这次分三段计时，把「卡」拆开看：
 *   ① 点标签 → 放映页挂载（React 渲染 + 布局）
 *   ② 挂载 → 版式配色算出来（videoPalette 抽帧 + collageTone）
 *   ③ 挂载 → 视频出第一帧（4K seek + 首帧解码）
 *
 * 用 performance.now() + PerformanceObserver 抓 longtask（>50ms 的阻塞任务），
 * 那才是用户能感知的「卡」。
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait, MEDIA_DIR, MEDIA_IMG } = require('./harness.cjs');

const WE = 'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\431960';

function workshop(pattern) {
  for (const dir of fs.readdirSync(WE)) {
    const full = path.join(WE, dir);
    let project;
    try { project = JSON.parse(fs.readFileSync(path.join(full, 'project.json'), 'utf8')); } catch { continue; }
    if (!pattern.test(project.title || '')) continue;
    const file = path.join(full, project.file || '');
    if (fs.existsSync(file)) return { path: file, name: project.title };
  }
  return null;
}

const ocean = workshop(/^Ocean/);

const cabinet = {
  version: 2, records: [], queue: [], ambience: [],
  media: [
    { id: 'video:ocean', kind: 'video', path: ocean.path, name: ocean.name, size: 1 },
    { id: 'image:1', kind: 'image', path: MEDIA_IMG, name: 'Ocean', size: 1 },
  ],
  mediaDirs: [MEDIA_DIR],
  master: 60, musicVolume: 70, ducking: true, duckDepth: 9, order: 'sequence',
  lineMode: false, muted: [],
};

/**
 * 冷启动模拟：把 videoPalette 的缓存清掉，再切页。
 * `__ravenPaletteCache` 是 video-palette 模块内部那个 Map——它挂在模块作用域里，
 * 页面内拿不到，所以只能靠 reload 一条路。
 */
const RUN = `(async () => {
  const longtasks = [];
  let observer = null;
  try {
    observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longtasks.push(+entry.duration.toFixed(1));
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {}

  const waitFor = async (predicate, limit = 8000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < limit) {
      if (predicate()) return +(performance.now() - t0).toFixed(1);
      await new Promise(r => requestAnimationFrame(() => r()));
    }
    return null;
  };

  const t0 = performance.now();
  [...document.querySelectorAll('.view-tabs > button')]
    .find(b => b.getAttribute('aria-label') === '相集')?.click();

  const mountMs = await waitFor(() => !!document.querySelector('.template-collage'));
  const video = await waitFor(() => document.querySelector('.tpl-block-media video, .tpl-block-media img'));
  // 首帧：视频要 have currentData(2)
  const firstFrameMs = await waitFor(() => {
    const v = document.querySelector('.tpl-block-media video');
    return v ? v.readyState >= 2 : !!document.querySelector('.tpl-block-media img');
  });
  // 配色：面板底色已经不再是初始值
  const panelEl = document.querySelector('.tpl-block-panel');
  const themedMs = await waitFor(() => {
    if (!panelEl) return false;
    const bg = getComputedStyle(panelEl).backgroundColor;
    return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  });

  await new Promise(r => setTimeout(r, 1200));
  observer?.disconnect();
  const v = document.querySelector('.tpl-block-media video');
  return {
    totalMs: +(performance.now() - t0).toFixed(1),
    mountMs, videoMs: video, firstFrameMs, themedMs,
    longtasks,
    worstLongtask: longtasks.length ? Math.max(...longtasks) : 0,
    video: v ? { readyState: v.readyState, size: v.videoWidth + 'x' + v.videoHeight } : null,
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: false, patch: cabinet });
  await wait(800);

  // 先切回柜子页：harness 启动时已经点过一次放映，配色缓存已热
  await probe.run(`(() => {
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '唱片柜')?.click();
    return 1;
  })()`);
  await wait(1000);

  // 热态：同一会话内第二次进放映
  const warm = await probe.run(RUN);

  // 冷态：reload 之后立刻第一次进放映
  await probe.run(`(() => {
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '唱片柜')?.click();
    return 1;
  })()`);
  await probe.win.webContents.reload();
  await wait(2200);
  const cold = await probe.run(RUN);

  report({ warm, cold, note: 'cold = reload 后第一次进放映，接近用户说的首次' });
});
