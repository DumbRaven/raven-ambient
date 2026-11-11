const { launch, guard } = require('./harness.cjs');
const { seedImages, MEDIA_DIR } = require('./seed-images.cjs');

guard(async () => {
  const app = await launch({
    width: 1920,
    height: 1080,
    template: 'photo',
    expand: false,
    settle: 2500,
    patch: { media: seedImages(12), mediaDirs: [MEDIA_DIR] },
  });
  const out = await app.run(`
    (() => {
      const p = document.querySelector('.ticket-panel');
      const cs = getComputedStyle(p);
      const before = getComputedStyle(p, '::before');
      const shot = document.querySelector('.ticket-shot');
      const scs = getComputedStyle(shot);
      const r = p.getBoundingClientRect();
      const sr = shot.getBoundingClientRect();
      return {
        panelRect: { x: r.x, y: r.y, w: r.width, h: r.height },
        shotRect: { x: sr.x, y: sr.y, w: sr.width, h: sr.height },
        panelMask: cs.maskImage,
        panelMaskSize: cs.maskSize,
        panelMaskComposite: cs.maskComposite,
        panelOverflow: cs.overflow,
        panelIsolation: cs.isolation,
        beforeMask: before.maskImage,
        beforeFilter: before.filter,
        shotMask: scs.maskImage,
        shotMaskSize: scs.maskSize,
        seamArc: cs.getPropertyValue('--seam-arc'),
        edgeArc: cs.getPropertyValue('--edge-arc'),
        containerW: getComputedStyle(p.parentElement.parentElement).width,
      };
    })()
  `);
  console.log(JSON.stringify(out));
  app.close();
});
