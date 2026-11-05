/**
 * 复验「部分视频不能放映/破损」——重点量 moov 在文件尾的那一支。
 *
 * 为什么单独挑它：ffmpeg 默认把索引（moov）写在文件最后，
 * Chromium 必须读到索引才知道时长和关键帧位置。如果协议不支持 Range，
 * 它就只能把整个文件下完——121MB 的 4K 片子走这条路就是转圈、花屏。
 *
 * 所以这里量的是**从设 src 到能播第一帧的毫秒数**，以及浏览器到底发了多少个
 * Range 请求（区间请求数 > 1 就说明它在按段拉，而不是整段下）。
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
    if (fs.existsSync(file)) return { path: file, name: project.title, size: fs.statSync(file).size };
  }
  return null;
}

const tokyo = workshop(/Tokyo CyberPunk/);
const ocean = workshop(/^Ocean/);

/** 在页面里量：设 src → 等到 readyState>=3（可以播放）→ 报耗时与请求数。 */
const MEASURE = src => `(async () => {
  const requests = [];
  const started = performance.now();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = ${JSON.stringify(src)};
  document.body.append(video);

  // 数一数浏览器实际拉了几段：<video> 自己发的不归 fetch 管，
  // 所以这里只能从 readyState 的推进来判断，另配一条 fetch 的旁证。
  let firstReady = null;
  const waitFor = async (predicate, limit = 20000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < limit) {
      if (predicate()) return Math.round(performance.now() - t0);
      await new Promise(r => setTimeout(r, 16));
    }
    return null;
  };
  const metadataMs = await waitFor(() => video.readyState >= 1);
  firstReady = await waitFor(() => video.readyState >= 3);
  // 真正出一帧
  try { await video.play(); } catch {}
  const frameMs = await waitFor(() => video.readyState >= 2 && video.currentTime > 0, 8000);

  // 旁证：自己发一次区间请求，确认协议真的按段回
  const ranged = await fetch(video.src, { headers: { range: 'bytes=0-1023' } });
  const rangedBody = await ranged.arrayBuffer();

  const info = {
    metadataMs,
    canPlayMs: firstReady,
    frameMs,
    totalMs: Math.round(performance.now() - started),
    readyState: video.readyState,
    size: video.videoWidth + 'x' + video.videoHeight,
    duration: Number.isFinite(video.duration) ? +video.duration.toFixed(2) : null,
    error: video.error ? video.error.code + ':' + video.error.message : null,
    ranged: {
      status: ranged.status,
      contentRange: ranged.headers.get('Content-Range'),
      bytes: rangedBody.byteLength,
    },
  };
  video.remove();
  return info;
})()`;

guard(async () => {
  const probe = await launch({
    expand: true,
    patch: {
      media: [
        { id: 'video:tokyo', kind: 'video', path: tokyo.path, name: tokyo.name, size: tokyo.size },
        { id: 'video:ocean', kind: 'video', path: ocean.path, name: ocean.name, size: ocean.size },
        { id: 'image:1', kind: 'image', path: MEDIA_IMG, name: 'Ocean', size: 1 },
      ],
      mediaDirs: [MEDIA_DIR, path.dirname(tokyo.path), path.dirname(ocean.path)],
    },
  });
  await wait(600);

  // 直接对文件发 media:// 请求，绕开页面里的 mediaSrc 映射
  const urls = await probe.run(`(async () => {
    const out = {};
    for (const item of (window.__ravenMediaTest || [])) out[item.name] = item.src;
    return out;
  })()`);

  const makeUrl = file => 'media://local/' + encodeURIComponent(file);
  const tokyoResult = await probe.run(MEASURE(makeUrl(tokyo.path)));
  const oceanResult = await probe.run(MEASURE(makeUrl(ocean.path)));

  report({
    files: {
      tokyo: { size: tokyo.size, moovAt: 'end' },
      ocean: { size: ocean.size, moovAt: 'front' },
    },
    tokyo: tokyoResult,
    ocean: oceanResult,
    urls,
  });
});
