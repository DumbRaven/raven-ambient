/** 量票根里每个文字元素的字号与行盒几何（给 python 侧比对 ref 行带用）。 */
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
    await new Promise(d => setTimeout(d, 600));
    const panel = card.querySelector('.ticket-panel');
    const pr = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const rows = [];
    panel.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.height < 0.5) return;
      const s = getComputedStyle(el);
      if (s.display === 'none') return;
      rows.push({
        cls: String(el.className || el.tagName).slice(0, 24),
        txt: (el.textContent || '').trim().slice(0, 16),
        fs: +parseFloat(s.fontSize).toFixed(2),
        h: +r.height.toFixed(2),
        top: +(r.top - pr.top).toFixed(2),
        lh: s.lineHeight,
      });
    });
    return {
      panelW: +pr.width.toFixed(2),
      panelH: +pr.height.toFixed(2),
      pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      gap: cs.gap,
      rows,
    };
  })()`);
  report(out);
});
