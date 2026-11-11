/**
 * 量缺口那一层（.ticket::before）到底解析成了什么。
 *
 * 为什么需要：缺口里应该透出垫底阴影（参考图亮度约 148），实拍却是 199，
 * 只暗了 20 级。怀疑 cqw 在 .ticket 自己的伪元素里没有按自身宽度解析——
 * 建立了 container-type 的元素，它自身的 cqw 不指向自己，会落到外层容器；
 * 外层没有容器时退化成 viewport。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-notch.cjs --no-sandbox
 */
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(40);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run } = probe;

  const out = await run(`(() => {
    const ticket = document.querySelector('.ticket');
    if (!ticket) return { error: 'no ticket' };
    const before = getComputedStyle(ticket, '::before');
    const self = getComputedStyle(ticket);
    const panel = ticket.querySelector('.ticket-panel');
    const shot = ticket.querySelector('.ticket-shot');
    return {
      ticketWidth: ticket.getBoundingClientRect().width,
      toothVar: self.getPropertyValue('--ticket-tooth').trim(),
      stepVar: self.getPropertyValue('--ticket-step').trim(),
      beforeBg: before.backgroundImage,
      beforeZ: before.zIndex,
      beforeDisplay: before.display,
      beforeInset: before.inset,
      panelTooth: getComputedStyle(panel, '::before').backgroundImage,
      shotMask: getComputedStyle(shot).maskImage,
      panelMask: getComputedStyle(panel).maskImage,
    };
  })()`);

  report(out);
});
