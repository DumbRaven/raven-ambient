/**
 * 量票根三块的实际像素边界与 mask 解析值。
 *
 * 用来核对「画面块右缘那排孔的中心是不是压在画面块的右边界上」——
 * 截图里孔的落点与量到的 shot 右缘对不上时，先看这里。
 *
 * 注意 run() 收的是**字符串**（内部走 executeJavaScript），传函数会静默挂住。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-geom.cjs --no-sandbox
 */
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media: seedImages(12), mediaDirs: [MEDIA_DIR] },
  });

  const out = await probe.run(`(() => {
    const ticket = document.querySelector('.ticket');
    const shot = document.querySelector('.ticket-shot');
    const panel = document.querySelector('.ticket-panel');
    const cs = getComputedStyle(shot);
    const ps = getComputedStyle(panel);
    const t = ticket.getBoundingClientRect();
    const s = shot.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    return {
      ticket: { x: Math.round(t.x), w: Math.round(t.width), h: Math.round(t.height) },
      shot: {
        x: Math.round(s.x), w: Math.round(s.width), h: Math.round(s.height),
        leftDelta: Math.round(s.x - t.x),
        rightDelta: Math.round(t.right - s.right),
      },
      panel: {
        x: Math.round(p.x), w: Math.round(p.width),
        leftDelta: Math.round(p.x - t.x),
        gapPx: Math.round(p.x - s.right),
      },
      shotMaskImage: cs.maskImage,
      shotMaskSize: cs.maskSize,
      shotMaskRepeat: cs.maskRepeat,
      panelMaskImage: ps.maskImage,
      panelMaskSize: ps.maskSize,
      toothToken: getComputedStyle(ticket).getPropertyValue('--ticket-tooth').trim(),
      cornerToken: getComputedStyle(ticket).getPropertyValue('--ticket-corner').trim(),
      containerWidth: getComputedStyle(ticket.parentElement).width,
    };
  })()`);

  report(out);
});
