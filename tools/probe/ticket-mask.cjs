/**
 * 量齿孔 mask 的实际计算值。
 *
 * 目的：截图里票的左右外缘完全没有缺口，先确认是 mask 没生效、
 * 还是参数把缺口算到了纸外（半径 < 偏移时洞根本不存在）。
 *
 * 跑法：Remove-Item Env:ELECTRON_RUN_AS_NODE
 *       node_modules\electron\dist\electron.exe tools\probe\ticket-mask.cjs --no-sandbox
 */
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run } = probe;

  const out = await run(`(() => {
    const t = document.querySelector('.ticket');
    const s = t.querySelector('.ticket-shot');
    const p = t.querySelector('.ticket-panel');
    const cs = getComputedStyle(s);
    const cp = getComputedStyle(p);
    const r = n => Math.round(n * 100) / 100;
    const px = v => parseFloat(v) || 0;
    const w = s.getBoundingClientRect().width;
    const cqw = w / 100;
    const R = px(cs.getPropertyValue('--edge-arc')) * cqw;
    const off = px(cs.getPropertyValue('--edge-off')) * cqw;
    return {
      shotW: r(w),
      cqwPx: r(cqw),
      tokens: {
        edgeStep: cs.getPropertyValue('--edge-step').trim(),
        edgeArc: cs.getPropertyValue('--edge-arc').trim(),
        edgeOff: cs.getPropertyValue('--edge-off').trim(),
        seamStep: cs.getPropertyValue('--seam-step').trim(),
        seamArc: cs.getPropertyValue('--seam-arc').trim(),
        seamOff: cs.getPropertyValue('--seam-off').trim(),
      },
      // 圆半径 R、圆心在纸外 off 时：纸被切进去的深度 = R - off
      geom: { Rpx: r(R), offPx: r(off), depthPx: r(R - off) },
      shotMaskImage: cs.maskImage,
      shotMaskSize: cs.maskSize,
      shotMaskRepeat: cs.maskRepeat,
      shotMaskComposite: cs.maskComposite,
      panelMaskImage: cp.maskImage,
      panelMaskSize: cp.maskSize,
      panelMaskComposite: cp.maskComposite,
    };
  })()`);

  report(out);
});
