// 量 .ticket-panel 与它的 ::after（虚线内框）实际渲染成什么样。
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2000,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });

  const data = await probe.run(`(() => {
    const panel = document.querySelector('.ticket-grid .ticket-panel');
    if (!panel) return { error: 'no panel' };
    const cs = getComputedStyle(panel);
    const after = getComputedStyle(panel, '::after');
    const pr = panel.getBoundingClientRect();
    return {
      panelRect: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
      panelZ: cs.zIndex,
      panelFilter: cs.filter,
      panelMask: cs.maskImage.slice(0, 50),
      afterContent: after.content,
      afterInset: after.inset,
      afterBorder: after.borderTopWidth + ' ' + after.borderTopStyle + ' ' + after.borderTopColor,
      afterRadius: after.borderRadius,
      afterZ: after.zIndex,
      afterW: after.width,
      afterH: after.height,
      frameToken: cs.getPropertyValue('--ticket-frame').trim(),
      cornerToken: cs.getPropertyValue('--ticket-corner').trim(),
    };
  })()`);

  report({ data });
});
