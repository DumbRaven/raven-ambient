/**
 * 量功能切换栏（`.view-tabs`）：删掉两个数字之后有没有挤坏布局。
 *
 * 用户 m06345：「功能切换栏中唱片显示17和放映显示178有点和右上角重复了」
 * → 把 `唱片柜` 与 `放映` 两个按钮里的 `<small>数字</small>` 删掉了。
 *
 * 这两个数字不是纯装饰：按钮宽度变了，黑色滑块（`.nav-marker`）的
 * 宽和高都跟着按钮走，滑块位置又是由 use-view-layout 量出来写进变量的。
 * 所以要确认三件事：
 *   1. 四个按钮里没有残留的 `<small>`（删干净了）；
 *   2. 每个视图的滑块宽度都等于它对应的按钮宽度（量位置没量错）；
 *   3. 滑块没有超出胶囊容器（最右那个按钮去掉数字后变窄，滑块得跟着收）。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/nav-tabs.cjs --no-sandbox
 */
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

const MEASURE = `(() => {
  const nav = document.querySelector('.view-tabs');
  const marker = nav.querySelector('.nav-marker');
  const buttons = [...nav.querySelectorAll(':scope > button')];
  const navBox = nav.getBoundingClientRect();
  const markerBox = marker.getBoundingClientRect();

  return {
    // 残留的计数小字（应该是空数组）
    leftovers: [...nav.querySelectorAll('small')].map(s => s.textContent),
    nav: [Math.round(navBox.x), Math.round(navBox.y), Math.round(navBox.width), Math.round(navBox.height)],
    marker: [Math.round(markerBox.x), Math.round(markerBox.y), Math.round(markerBox.width), Math.round(markerBox.height)],
    buttons: buttons.map(b => {
      const r = b.getBoundingClientRect();
      return {
        label: b.getAttribute('aria-label'),
        active: b.classList.contains('active'),
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      };
    }),
    // 滑块右端是否还在胶囊里（去掉数字后这里最容易出问题）
    markerInside: markerBox.right <= navBox.right + 0.5 && markerBox.left >= navBox.left - 0.5,
  };
})()`;

const SHOT = `(() => {
  const nav = document.querySelector('.view-tabs');
  const r = nav.getBoundingClientRect();
  // 上下各留 8px，截一条窄带就够看清滑块与文字
  return { x: Math.round(r.x) - 8, y: Math.round(r.y) - 8,
           width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 };
})()`;

guard(async () => {
  const probe = await launch({ expand: false });
  // 回到唱片柜：那里四个按钮都无数字，是「都删干净」最有说服力的一屏
  await probe.run(`(() => {
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '唱片柜')?.click();
    return 1;
  })()`);
  await wait(900);

  const cabinet = await probe.run(MEASURE);
  const area = await probe.run(SHOT);

  // 再逐页点一遍，确认每个视图的滑块都跟着按钮走
  const perView = [];
  for (const label of ['正在听', '专注', '放映', '唱片柜']) {
    await probe.run(`(() => {
      [...document.querySelectorAll('.view-tabs > button')]
        .find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)})?.click();
      return 1;
    })()`);
    await wait(900);
    const m = await probe.run(MEASURE);
    const active = m.buttons.find(b => b.active);
    perView.push({
      label,
      active: active ? active.label : null,
      buttonWidth: active ? active.box[2] : null,
      markerWidth: m.marker[2],
      // 滑块必须精确等于活动按钮的宽度，差 1px 以上说明量错了
      delta: active ? Math.abs(active.box[2] - m.marker[2]) : null,
      markerInside: m.markerInside,
      leftovers: m.leftovers,
    });
  }

  const image = await probe.win.webContents.capturePage(area);
  const png = image.toPNG();
  const file = path.join(__dirname, 'nav-tabs.png');
  require('node:fs').writeFileSync(file, png);

  report({ cabinet, perView, shot: file });
});
