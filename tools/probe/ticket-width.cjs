/**
 * 为什么票根只有 165px？按 flex 算应该是 186px。
 * 打印 .ticket 的 padding/border/gap 与两块纸的 flex、basis、rect。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-width.cjs --no-sandbox
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
    const li = document.querySelector('.ticket-grid > li');
    const ticket = li.querySelector('.ticket');
    const shot = li.querySelector('.ticket-shot');
    const panel = li.querySelector('.ticket-panel');
    const pick = (el, props) => {
      const cs = getComputedStyle(el);
      const o = { rect: el.getBoundingClientRect().width.toFixed(2) };
      for (const p of props) o[p] = cs[p];
      return o;
    };
    return {
      ticket: pick(ticket, ['display', 'gap', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'width', 'boxSizing', 'containerType']),
      shot: pick(shot, ['flexGrow', 'flexShrink', 'flexBasis', 'marginLeft', 'marginRight', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']),
      panel: pick(panel, ['flexGrow', 'flexShrink', 'flexBasis', 'marginLeft', 'marginRight', 'borderLeftWidth', 'borderRightWidth', 'minWidth']),
      containerW: getComputedStyle(ticket).getPropertyValue('--ticket-arc'),
    };
  })()`);

  report(out);
});
