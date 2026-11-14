/**
 * 探针：相集页「图片 / 视频」那颗滑块动没动，以及页尾添加区摆在哪。
 *
 * 为什么必须逐帧量：`data-ready` 没置上、或者 `--flip-*` 没写进去时，
 * 按钮的选中态照样会换（那是 React 管的），只有滑块会瞬移或者干脆不动。
 * 所以点击与逐帧记录必须在**同一次 executeJavaScript** 里完成——
 * 分两次调用的话，中间隔着 380ms 的过渡，抓到的时候早就到位了。
 *
 * 判据：
 *   1. 滑块正好压住 button.active（误差 < 1px）
 *   2. 切换时出现过中间态（至少 2 帧既不在起点也不在终点）
 *   3. 两档文字长短不同 → 宽度也要跟着变
 *   4. 页尾添加区在票根列表下方，且工具栏里已经没有那两个按钮
 *   5. 全屏时页尾添加区被藏掉
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, guard, wait, report } = require('./harness.cjs');

/** 读工具栏与页尾的几何关系。 */
const READ = `(() => {
  const tabs = document.querySelector('.media-room .filter-tabs');
  const marker = tabs ? tabs.querySelector('.flip-marker') : null;
  if (!tabs || !marker) return { error: 'no-tabs' };
  const active = tabs.querySelector('button.active');
  const markerBox = marker.getBoundingClientRect();
  const activeBox = active ? active.getBoundingClientRect() : null;
  const markerStyle = getComputedStyle(marker);
  const toolbar = document.querySelector('.media-room .media-toolbar');
  const importer = document.querySelector('.media-import');
  const grid = document.querySelector('.ticket-grid');
  const box = el => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) };
  };
  return {
    ready: tabs.dataset.ready || null,
    vars: { x: tabs.style.getPropertyValue('--flip-x'), width: tabs.style.getPropertyValue('--flip-width') },
    marker: { left: Math.round(markerBox.left * 100) / 100, width: Math.round(markerBox.width * 100) / 100 },
    active: activeBox ? { text: active.textContent.trim(), left: Math.round(activeBox.left * 100) / 100, width: Math.round(activeBox.width * 100) / 100 } : null,
    transition: markerStyle.transitionProperty + ' ' + markerStyle.transitionDuration,
    toolbarButtons: toolbar ? toolbar.querySelectorAll('button').length : null,
    toolbarText: toolbar ? toolbar.textContent.replace(/\\s+/g, ' ').trim() : null,
    importer: box(importer),
    importerText: importer ? importer.textContent.replace(/\\s+/g, ' ').trim() : null,
    grid: box(grid),
    importerBelowGrid: !!(importer && grid && importer.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom - 2),
  };
})()`;

/** 点第 index 颗，同一个执行环境里逐帧记滑块 left/width。 */
const CLICK_AND_TRACK = index => `(async () => {
  const tabs = document.querySelector('.media-room .filter-tabs');
  if (!tabs) return { error: 'no-tabs' };
  const marker = tabs.querySelector('.flip-marker');
  const buttons = [...tabs.querySelectorAll('button')];
  const target = buttons[${index}];
  if (!target) return { error: 'no-button' };

  const frames = [];
  const read = () => {
    const b = marker.getBoundingClientRect();
    frames.push({ left: Math.round(b.left * 100) / 100, width: Math.round(b.width * 100) / 100 });
  };
  read();
  target.click();

  // 过渡 380ms，多留 200ms 收尾。
  const until = performance.now() + 580;
  await new Promise(done => {
    const tick = () => {
      read();
      if (performance.now() < until) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });

  const first = frames[0];
  const last = frames[frames.length - 1];
  const mids = frames.filter(f => Math.abs(f.left - first.left) > 0.5 && Math.abs(f.left - last.left) > 0.5);
  return {
    frames: frames.length,
    from: first,
    to: last,
    midCount: mids.length,
    midSample: mids.length ? mids[Math.min(2, mids.length - 1)] : null,
    travelled: Math.round((last.left - first.left) * 100) / 100,
    widened: Math.round((last.width - first.width) * 100) / 100,
  };
})()`;

guard(async () => {
  // 窗口态：工具栏和页尾都看得见。
  const probe = await launch({ width: 1440, height: 900, expand: false, settle: 2600 });
  const { run } = probe;

  // 隐藏窗口里 Chromium 会把动画时钟挂起：580ms 内 rAF 只跑了 3 帧，
  // 过渡的 computed transform 一步都不推进，量出来全是「没动」的假值。
  //
  // harness 现在默认走离屏渲染（见 harness.cjs 顶部），窗口不出现、rAF 按真实
  // 节拍跑，所以这里什么都不用做。只有显式 `PROBE_SHOW=1` 想肉眼看，或者
  // `PROBE_OFFSCREEN=0` 退回隐藏窗口时，才需要把窗口亮出来让动画跑。

  const out = {};

  out.initial = await run(READ);

  // 切到「视频」：滑块要滑过去并变宽。
  out.toVideo = await run(CLICK_AND_TRACK(1));
  await wait(280);
  out.afterVideo = await run(READ);

  // 切回「图片」：反向也要有中间态。
  out.backToImage = await run(CLICK_AND_TRACK(0));
  await wait(280);
  out.afterImage = await run(READ);

  // 页尾的菜单必须往上弹（否则一出页面就被切掉）。
  out.menu = await run(`(async () => {
    const button = document.querySelector('.media-import-main');
    if (!button) return { error: 'no-import-button' };
    // 先滚到跟前：页尾本来就在首屏之外，不滚的话量到的「在视口内」没有意义。
    button.scrollIntoView({ block: 'end' });
    await new Promise(r => setTimeout(r, 220));
    button.click();
    await new Promise(r => setTimeout(r, 260));
    const menu = document.querySelector('.media-import .media-add-menu');
    if (!menu) return { error: 'menu-not-open' };
    const b = menu.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    return {
      gapAboveAnchor: Math.round(anchor.top - b.bottom),
      inViewport: b.top >= 0 && b.bottom <= window.innerHeight,
      width: Math.round(b.width),
      items: menu.querySelectorAll('button').length,
    };
  })()`);
  await run(`(() => { document.querySelector('.media-add-veil')?.click(); return 1; })()`);

  const png = (await probe.win.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(__dirname, 'media-import.png'), png);
  out.shot = 'tools/probe/media-import.png';

  // 全屏态：页尾添加区必须被藏掉。
  // 这里不能另起一个 launch——harness 在模块加载时注册一次 media scheme，
  // 第二次 launch 再 attach 会抛「Failed to register protocol: media」。
  // 同一个窗口里点全屏就够了。
  await run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
  await wait(1400);
  out.expanded = await run(`(() => {
    const importer = document.querySelector('.media-import');
    const toolbar = document.querySelector('.media-room .collection-toolbar');
    return {
      importerShown: importer ? getComputedStyle(importer).display !== 'none' : null,
      toolbarShown: toolbar ? getComputedStyle(toolbar).display !== 'none' : null,
    };
  })()`);

  report(out);
});