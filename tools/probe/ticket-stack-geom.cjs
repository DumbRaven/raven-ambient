/** stack 版票根的直接子元素几何：查溢出与段距是否落到参考图的 y 带上。 */
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(40);
  const { run } = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const out = await run(`(() => {
    const all = [...document.querySelectorAll('.ticket-panel')];
    const el = all.find(x => x.dataset.layout === 'stack') || all[0];
    const pr = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const kids = [...el.children].map(k => {
      const r = k.getBoundingClientRect();
      return { cls: String(k.className || k.tagName).slice(0, 22),
               top: +(r.top - pr.top).toFixed(1), h: +r.height.toFixed(1),
               txt: (k.textContent || '').trim().slice(0, 16) };
    });
    return { layout: el.dataset.layout,
             panelW: +pr.width.toFixed(1), panelH: +pr.height.toFixed(1),
             pad: cs.padding, gap: cs.gap, justify: cs.justifyContent,
             scrollH: el.scrollHeight, clientH: el.clientHeight, kids };
  })()`);
  report(out);
});
