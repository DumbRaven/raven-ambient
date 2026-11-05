/**
 * 查两件事：
 *   A. 第一次进放映页为什么卡——分开计时「切页」「取色」「视频起播」。
 *   B. 两个 4K 视频在 media:// 下能不能真的播起来（readyState / videoWidth / error）。
 *
 * 用真实的大文件，不是探针合出来的纯色图：4K 解码和内置协议的行为
 * 只有真文件才测得出来。
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

const WE = 'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\431960';

/** 从壁纸库里挑一个作品，返回它 project.json 里登记的那个视频。 */
function workshop(titlePattern) {
  for (const dir of fs.readdirSync(WE)) {
    const full = path.join(WE, dir);
    let project;
    try { project = JSON.parse(fs.readFileSync(path.join(full, 'project.json'), 'utf8')); } catch { continue; }
    if (!titlePattern.test(project.title || '')) continue;
    const file = path.join(full, project.file || '');
    if (fs.existsSync(file)) return { key: full, path: file, name: project.title };
  }
  return null;
}

const ocean = workshop(/^Ocean/);
const tokyo = workshop(/^Tokyo/);
const beach = workshop(/^Rain On Window Beach/);

const items = [ocean, tokyo, beach].filter(Boolean).map((w, at) => ({
  id: `video:${at}`, kind: 'video', path: w.path, name: w.name, size: 1,
}));

const cabinet = {
  version: 2,
  records: [], queue: [], ambience: [],
  media: items,
  mediaDirs: [],
  master: 60, musicVolume: 70, ducking: true, duckDepth: 9, order: 'sequence',
  lineMode: false, muted: [],
};

guard(async () => {
  const probe = await launch({ expand: false, patch: cabinet });
  await wait(600);

  // A：计时切到放映页 + 首帧。点之前先打一个点，点完等 DOM 出现再打一个点。
  const enterTiming = await probe.run(`(async () => {
    const t0 = performance.now();
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '放映')?.click();
    const t1 = performance.now();
    // 等放映页真的挂上
    for (let i = 0; i < 400; i++) {
      if (document.querySelector('.template-collage')) break;
      await new Promise(r => setTimeout(r, 16));
    }
    const t2 = performance.now();
    const video = document.querySelector('.tpl-block-media video');
    return {
      clickMs: +(t1 - t0).toFixed(1),
      mountMs: +(t2 - t1).toFixed(1),
      hasVideo: !!video,
      posters: document.querySelectorAll('.media-grid video').length,
    };
  })()`);

  // 再等一会儿，看四个 4K 视频（三个缩略图 + 一个放映）各自到什么状态
  await wait(4000);
  const states = await probe.run(`(() => {
    const out = [];
    const all = [...document.querySelectorAll('video')];
    for (const v of all) {
      out.push({
        where: v.closest('.tpl-block-media') ? 'stage' : (v.closest('.media-grid') ? 'grid' : 'other'),
        src: (v.currentSrc || v.src || '').slice(-42),
        readyState: v.readyState,
        networkState: v.networkState,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        paused: v.paused,
        currentTime: +v.currentTime.toFixed(2),
        duration: Number.isFinite(v.duration) ? +v.duration.toFixed(1) : null,
        error: v.error ? { code: v.error.code, message: v.error.message } : null,
      });
    }
    return out;
  })()`);

  report({ enterTiming, states });
});
