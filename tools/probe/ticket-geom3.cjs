/** 量一张票的真实几何与自带的相册页底色，供 python 侧换算。 */
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(40);
  const { run } = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const out = await run(`(async () => {
    const card = document.querySelector('.ticket-grid .ticket');
    card.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -70);
    await new Promise(d => requestAnimationFrame(() => requestAnimationFrame(d)));
    const t = card.getBoundingClientRect();
    const shot = card.querySelector('.ticket-shot').getBoundingClientRect();
    const panel = card.querySelector('.ticket-panel').getBoundingClientRect();
    const grid = document.querySelector('.ticket-grid').getBoundingClientRect();
    const cs = getComputedStyle(card);
    const gs = getComputedStyle(document.querySelector('.ticket-grid'));
    return {
      ticket: { w: +t.width.toFixed(2), h: +t.height.toFixed(2), x: +t.x.toFixed(1), y: +t.y.toFixed(1) },
      shot: { w: +shot.width.toFixed(2), h: +shot.height.toFixed(2), x: +shot.x.toFixed(1) },
      panel: { w: +panel.width.toFixed(2), h: +panel.height.toFixed(2), x: +panel.x.toFixed(1) },
      gridBg: gs.backgroundColor, gridPad: gs.padding, gridRect: { x: +grid.x.toFixed(1), y: +grid.y.toFixed(1), w: +grid.width.toFixed(1) },
      radius: cs.borderRadius, filter: cs.filter,
      shotShare: +((shot.width / t.width) * 100).toFixed(2),
      panelShare: +((panel.width / t.width) * 100).toFixed(2),
      ratio: +(t.width / t.height).toFixed(3),
    };
  })()`);
  report(out);
});
