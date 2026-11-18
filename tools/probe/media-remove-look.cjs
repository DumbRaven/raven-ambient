/**
 * 相一张：票角「移出」按钮长什么样。
 *
 * 三种状态都要看：悬停前（不该出现）、悬停（出现）、上膛（常驻 + 变色）。
 * 布局类判断只能靠眼睛——数字只能证明它在，不能证明它不难看。
 */
const path = require('node:path');
const { launch, guard, report, wait, MEDIA_DIR } = require('./harness.cjs');

guard(async () => {
  const media = [
    { id: 'image:1', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Ocean', size: 1 },
    { id: 'image:2', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Drowned Dusk', size: 1 },
    { id: 'image:3', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Slow Moments', size: 1 },
    { id: 'image:4', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Still Water', size: 1 },
  ];
  const probe = await launch({
    width: 680, height: 980, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, hover, shot } = probe;
  const out = {};

  // 悬停第二张
  out.hover = await hover('.ticket-grid > li:nth-child(2)');
  await wait(320);
  await shot(path.join(__dirname, 'media-remove-hover.png'));

  // 上膛
  out.armed = await run(`(async () => {
    const li = document.querySelector('.ticket-grid > li:nth-child(2)');
    li.querySelector('.ticket-remove').click();
    await new Promise(r => setTimeout(r, 320));
    const b = li.querySelector('.ticket-remove');
    return { armed: b.classList.contains('armed'), opacity: getComputedStyle(b).opacity };
  })()`);
  await wait(260);
  await shot(path.join(__dirname, 'media-remove-armed.png'));

  // 浮层里的那个
  await run(`(async () => {
    document.querySelector('.ticket-grid > li:nth-child(3) .ticket')?.click();
    return 1;
  })()`);
  await wait(1100);
  await shot(path.join(__dirname, 'media-remove-stage.png'));

  report(out);
});
