/**
 * 量空状态那句为什么是 0×0。
 *
 * 上一轮量到 `.desktop-widgets-empty` 的 `getBoundingClientRect()` 是 `0×0`，
 * 可它同时带着 `.desktop-widgets`（`position:absolute; inset:0`）。两种可能：
 *   ① 定位失效（最近的定位祖先不是舞台，或者祖先宽高为 0）
 *   ② 它确实撑开了但被裁掉（overflow / clip）
 * 于是把每一层的 computed 全打出来，从元素一路往上。
 */
const { launch, guard, wait, report } = require('./harness.cjs');

const SET_EMPTY = `(() => { localStorage.setItem('raven-layers', '[]'); return 1; })()`;

const CHAIN = `(() => {
  const rows = [];
  let node = document.querySelector('.desktop-widgets-empty');
  while (node && node !== document.documentElement) {
    const s = getComputedStyle(node);
    const b = node.getBoundingClientRect();
    rows.push({
      tag: node.tagName.toLowerCase(),
      cls: node.className && typeof node.className === 'string' ? node.className.trim() : '',
      position: s.position,
      display: s.display,
      inset: [s.top, s.right, s.bottom, s.left].join(' '),
      rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(','),
      overflow: s.overflow,
      visibility: s.visibility,
    });
    node = node.parentElement;
  }
  const p = document.querySelector('.desktop-widgets-empty p');
  return {
    chain: rows,
    paragraph: p ? {
      text: p.textContent.trim(),
      rect: (() => { const b = p.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)].join('x'); })(),
      display: getComputedStyle(p).display,
      fontSize: getComputedStyle(p).fontSize,
    } : null,
  };
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'desktop', expand: true, settle: 2400 });
  const { run, win } = probe;
  await run(SET_EMPTY);
  await win.webContents.reload();
  await wait(2400);
  report(await run(CHAIN));
});
