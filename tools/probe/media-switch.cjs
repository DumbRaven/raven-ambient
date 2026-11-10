/**
 * 探针：换件（图片↔视频）时画面到底有没有淡入（用户 m12760 第 5 条）。
 *
 * 为什么必须逐帧量：`animation` 写在 CSS 上不代表它在播。换件靠
 * `key={item.id}` 重挂载，只要 React 复用了节点、或者选择器没选中
 * （`.media-theater .template .tpl-media` 少写一层就匹配不到），
 * 动画就是死的——而且**看不见也不报错**，只有量 keyframes 的播放状态才抓得到。
 *
 * 上一版量到 `changed: false / sawTransition: 0`，原因不是动画坏了：
 * `harness.cjs` 的 CABINET 里只放了一件媒体，「下一件」按下去还在原地打转。
 * 所以这里自己造第二、第三张图，用 `patch` 传进去。
 *
 * 判据三条：
 *   1. 换件前后 `src` 真的变了（先证明「确实在换」）
 *   2. 逐帧能读到 opacity < 1（说明在过渡，不是一帧就位）
 *   3. 结束时 opacity 回到 1、scale 回到 1（不许停在半透明）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { launch, guard, wait, report, MEDIA_DIR } = require('./harness.cjs');

const SECOND = path.join(MEDIA_DIR, 'SECOND SHADE.png');
const THIRD = path.join(MEDIA_DIR, 'THIRD LIGHT.png');

/** 造两张同尺寸、不同色相的图，保证换件时肉眼也看得出换了。 */
function ensureExtra() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const jobs = [
    [SECOND, '0x7a5539'],
    [THIRD, '0x4a7a55'],
  ];
  for (const [file, color] of jobs) {
    if (fs.existsSync(file)) continue;
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:d=1`,
      '-frames:v', '1', file,
    ]);
  }
}

const PICK_TEMPLATE = name => `(() => {
  const group = document.querySelector('.theater-templates');
  [...group.querySelectorAll('button')].find(b => b.textContent.trim() === '${name}')?.click();
  return 1;
})()`;

const TRACK = `(async () => {
  const pick = () => document.querySelector('.media-theater .template .tpl-media');
  const nameOf = node => {
    if (!node) return null;
    const raw = node.currentSrc || node.src || '';
    try { return decodeURIComponent(raw).split(/[\\\\/]/).pop(); } catch { return raw.split(/[\\\\/]/).pop(); }
  };

  const before = nameOf(pick());
  const frames = [];
  const read = () => {
    const node = pick();
    if (!node) { frames.push({ missing: true }); return; }
    const s = getComputedStyle(node);
    frames.push({
      opacity: Math.round(Number(s.opacity) * 1000) / 1000,
      scale: s.scale || 'none',
      anim: node.getAnimations().map(a => a.playState).join(','),
    });
  };

  read();
  [...document.querySelectorAll('.theater-bar button')]
    .find(b => b.getAttribute('aria-label') === '下一件')?.click();

  const until = performance.now() + 700;
  await new Promise(done => {
    const tick = () => { read(); if (performance.now() < until) requestAnimationFrame(tick); else done(); };
    requestAnimationFrame(tick);
  });

  const after = nameOf(pick());
  const withOpacity = frames.filter(f => typeof f.opacity === 'number');
  const lows = withOpacity.filter(f => f.opacity < 0.99);
  const last = withOpacity[withOpacity.length - 1] || null;
  return {
    before, after, changed: before !== after,
    frames: withOpacity.length,
    sawTransition: lows.length,
    trough: withOpacity.length ? Math.min(...withOpacity.map(f => f.opacity)) : null,
    sample: lows.slice(0, 4),
    lastOpacity: last ? last.opacity : null,
    lastScale: last ? last.scale : null,
  };
})()`;

guard(async () => {
  ensureExtra();
  const media = [
    { id: 'image:1', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Ocean', size: 1 },
    { id: 'image:2', kind: 'image', path: SECOND, name: 'Second Shade', size: 1 },
    { id: 'image:3', kind: 'image', path: THIRD, name: 'Third Light', size: 1 },
  ];
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: true, settle: 2800,
    patch: { media },
  });
  const { run } = probe;
  const out = {};

  // ---- 相集：整张铺满，正好看换件
  await run(PICK_TEMPLATE('相集'));
  await wait(900);
  out.photo1 = await run(TRACK);
  await wait(700);
  out.photo2 = await run(TRACK);
  await wait(700);

  // ---- 拼贴：同一个 `.tpl-media`，也得播
  await run(PICK_TEMPLATE('拼贴'));
  await wait(1100);
  out.collage = await run(TRACK);

  report(out);
});
