/**
 * `.ticket::before`（缺口 + 撕缝的垫底阴影）到底渲没渲？
 * 打印它的 computed background-image / background-size，以及 ::before 的盒大小。
 * 顺带确认 .ticket 是否建立了层叠上下文（filter / transform / isolation）。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-before.cjs --no-sandbox
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
    const ticket = document.querySelector('.ticket-grid > li .ticket');
    const before = getComputedStyle(ticket, '::before');
    const after = getComputedStyle(ticket.querySelector('.ticket-shot'), '::after');
    return {
      beforeContent: before.content,
      beforePos: before.position,
      beforeInset: [before.top, before.right, before.bottom, before.left].join(' '),
      beforeZ: before.zIndex,
      beforeW: before.width,
      beforeH: before.height,
      beforeBG: before.backgroundImage,
      beforeBGSize: before.backgroundSize,
      beforeBGRepeat: before.backgroundRepeat,
      toothPc: getComputedStyle(ticket).getPropertyValue('--ticket-tooth-pc'),
      arcPc: getComputedStyle(ticket).getPropertyValue('--ticket-arc-pc'),
      arcOffPc: getComputedStyle(ticket).getPropertyValue('--ticket-arc-off-pc'),
      ticketFilter: getComputedStyle(ticket).filter,
      ticketIsolation: getComputedStyle(ticket).isolation,
      ticketPosition: getComputedStyle(ticket).position,
      shotAfterBG: after.backgroundImage,
      shotAfterW: after.width,
    };
  })()`);

  report(out);
});
