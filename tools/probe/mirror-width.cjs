/**
 * 验第 5 条：环境音的**正行**与**倒影**必须折行在同一处、宽度相同。
 *
 * 判据不是「看着差不多」，是量两条 text 的矩形宽度与高度：
 * 同一个字符串、同一个字体、同一个盒子宽度 → 两块的 width/height 应当一致。
 * 只差 transform: scaleY(-1)，那条不影响横向尺寸。
 */
const path = require('node:path');
const { launch, report, guard, wait, MEDIA_DIR, MEDIA_IMG } = require('./harness.cjs');

const record = (id, name, category) => ({
  id, assetId: `asset:${id}`, name, artist: 'DumbRaven', description: '', category,
  duration: 600, format: 'WAV', size: 1, color: '#4b5a66', fingerprint: id,
  volume: 60, pan: 0, warmth: 0, duckDepth: 12,
});

// 用户点名的那一串长名字，正好用来测折行
const LONG = '木头吱吱作响 · 水波的轻响 · 书写 · 在雪林中行走';

const cabinet = {
  version: 2,
  records: [
    record('ambient:a', LONG, 'ambient'),
    record('music:1', 'DROWNED DUSK', 'music'),
  ],
  queue: ['music:1'],
  ambience: ['ambient:a'],
  muted: [],
  // 必须给一件画面：没有媒体条目时页面会停在空库分支，
  // 空库分支根本没有放映页，量到的全是 null。
  media: [{ id: 'image:1', kind: 'image', path: MEDIA_IMG, name: 'Ocean', size: 1 }],
  mediaDirs: [MEDIA_DIR],
  master: 60, musicVolume: 70, ducking: true, duckDepth: 9, order: 'sequence',
  lineMode: false,
};

const MEASURE = `(() => {
  const box = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const canvas = document.querySelector('.template-collage').getBoundingClientRect();
    return {
      x: +((r.left - canvas.left) / canvas.width * 100).toFixed(2),
      y: +((r.top - canvas.top) / canvas.height * 100).toFixed(2),
      w: +(r.width / canvas.width * 100).toFixed(2),
      h: +(r.height / canvas.height * 100).toFixed(2),
    };
  };
  const main = document.querySelector('.tpl-ambient-layers');
  const mirror = document.querySelector('.tpl-ambient-mirror');
  const cs = el => el ? getComputedStyle(el) : null;
  const m = cs(main), k = cs(mirror);
  return {
    text: main ? main.textContent : null,
    sameText: !!main && !!mirror && main.textContent.trim() === (mirror.textContent || '').trim(),
    mainRect: box(main),
    mirrorRect: box(mirror),
    mainStyle: m ? { font: m.fontSize, line: m.lineHeight, align: m.textAlign, width: m.width } : null,
    mirrorStyle: k ? { font: k.fontSize, line: k.lineHeight, align: k.textAlign, width: k.width } : null,
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: true, patch: cabinet });
  await wait(900);
  report(await probe.run(MEASURE));
});
