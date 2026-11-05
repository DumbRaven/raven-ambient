/**
 * 把两个「放映有破损」的视频真的放进放映页，截图看渲染结果。
 *
 * 前一版探针只在游离的 <video> 上量 readyState，那只能证明「能解码」，
 * 不能证明「进了版式之后画面是完整的」——损不损要眼睛看。
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

const HEALTH = `(() => {
  const v = document.querySelector('.tpl-block-media video');
  if (!v) return { video: false };
  return {
    video: true,
    readyState: v.readyState,
    networkState: v.networkState,
    paused: v.paused,
    muted: v.muted,
    currentTime: +v.currentTime.toFixed(2),
    duration: Number.isFinite(v.duration) ? +v.duration.toFixed(2) : null,
    size: v.videoWidth + 'x' + v.videoHeight,
    error: v.error ? v.error.code + ':' + v.error.message : null,
    // 画面块的实际显示区域，用来判断有没有被裁
    box: (() => {
      const r = v.getBoundingClientRect();
      const block = document.querySelector('.tpl-block-media').getBoundingClientRect();
      return {
        video: { w: Math.round(r.width), h: Math.round(r.height) },
        block: { w: Math.round(block.width), h: Math.round(block.height) },
        objectFit: getComputedStyle(v).objectFit,
      };
    })(),
  };
})()`;

guard(async () => {
  const probe = await launch({
    template: 'collage',
    expand: true,
    patch: {
      media: [
        { id: 'video:tokyo', kind: 'video', path: tokyo.path, name: tokyo.name, size: tokyo.size },
        { id: 'video:ocean', kind: 'video', path: ocean.path, name: ocean.name, size: ocean.size },
      ],
      mediaDirs: [path.dirname(tokyo.path), path.dirname(ocean.path)],
      currentId: undefined,
    },
  });
  await wait(600);

  // 点开 Tokyo 那一格，等它真正出画面
  await probe.run(`(() => {
    const card = document.querySelector('.media-card[data-kind="video"]');
    card?.click();
    return !!card;
  })()`);
  await wait(3500);
  const tokyoState = await probe.run(HEALTH);
  await probe.shot(path.join(__dirname, 'screen-tokyo.png'));

  // 换到下一件（用放映页自带的「下一件」按钮，比点网格里的卡片可靠得多：
  // 卡片点击要过一层选中态，探针里点第二张不一定真的切过去）
  await probe.run(`(() => {
    const next = [...document.querySelectorAll('.icon-button')].find(b => b.getAttribute('aria-label') === '下一件');
    next?.click();
    return Boolean(next);
  })()`);
  await wait(3500);
  const oceanState = await probe.run(HEALTH);
  await probe.shot(path.join(__dirname, 'screen-ocean.png'));

  report({ tokyo: tokyoState, ocean: oceanState });
});
