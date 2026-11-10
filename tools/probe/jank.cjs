/**
 * 查「第一次进放映页卡一下」到底卡在哪，以及 4K 视频在 media:// 下能不能顺利 seek。
 *
 * 两个量法：
 *   1. rAF 间隔 —— 主线程真被堵住时帧间隔会拉长，比「点了多久才出现」更能说明卡顿。
 *   2. 逐点 seek —— 能播但 seek 卡死/报错，就是「放映有破损」的那种表现。
 *
 * 注意 harness 的 launch() 已经点过一次「放映」，所以这里必须先切回别的页，
 * 再切回来，才是用户说的「第一次点放映」。
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

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

const picks = [
  ['ocean', workshop(/^Ocean/)],
  ['tokyo', workshop(/^Tokyo/)],
  ['beach', workshop(/^Rain On Window Beach/)],
].filter(([, value]) => value);

const cabinet = {
  version: 2, records: [], queue: [], ambience: [],
  media: picks.map(([id, w]) => ({ id: `video:${id}`, kind: 'video', path: w.path, name: w.name, size: 1 })),
  mediaDirs: [],
  master: 60, musicVolume: 70, ducking: true, duckDepth: 9, order: 'sequence',
  lineMode: false, muted: [],
};

guard(async () => {
  const probe = await launch({ expand: false, patch: cabinet });
  await wait(600);

  // 切回柜子页，让这次「点放映」真的是第一次挂载
  await probe.run(`(() => {
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '唱片柜')?.click();
    return 1;
  })()`);
  await wait(900);

  // 量这一次挂载期间的帧间隔。rAF 回调里记录时间戳，超过 50ms 记为一次卡顿。
  const jank = await probe.run(`(async () => {
    const gaps = [];
    let last = performance.now();
    let alive = true;
    const tick = (now) => {
      if (!alive) return;
      gaps.push(+(now - last).toFixed(1));
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const t0 = performance.now();
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '相集')?.click();
    // 等到放映页出现，再多观察 2.5s 让取色/解码跑起来
    for (let i = 0; i < 200; i++) {
      if (document.querySelector('.template-collage')) break;
      await new Promise(r => setTimeout(r, 16));
    }
    const mountMs = +(performance.now() - t0).toFixed(1);
    await new Promise(r => setTimeout(r, 2500));
    alive = false;

    const bad = gaps.filter(g => g > 50);
    return {
      mountMs,
      frames: gaps.length,
      worstGap: Math.max(...gaps),
      stalls: bad.length,
      stallTotal: +bad.reduce((a, b) => a + b, 0).toFixed(1),
      top5: gaps.slice().sort((a, b) => b - a).slice(0, 5),
    };
  })()`);

  // 逐个视频试 seek：能播不等于能拖动
  const seeks = [];
  for (const [id] of picks) {
    const result = await probe.run(`(async () => {
      const all = [...document.querySelectorAll('.media-grid video, .media-card video')];
      const target = all[${picks.findIndex(p => p[0] === id)}];
      const video = document.querySelector('.tpl-block-media video');
      if (!video) return { id: '${id}', error: 'no stage video' };
      const marks = [];
      for (const pct of [0.1, 0.35, 0.6, 0.85]) {
        const at = Math.max(0.1, (video.duration || 30) * pct);
        const t0 = performance.now();
        await new Promise(resolve => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          video.addEventListener('seeked', finish, { once: true });
          video.addEventListener('error', finish, { once: true });
          setTimeout(finish, 6000);
          try { video.currentTime = at; } catch { finish(); }
        });
        marks.push({ at: +at.toFixed(1), ms: +(performance.now() - t0).toFixed(0),
          readyState: video.readyState, error: video.error ? video.error.code : null });
      }
      return { id: '${id}', marks, gridVideos: all.length };
    })()`);
    seeks.push(result);
  }

  report({ jank, seeks });
});
