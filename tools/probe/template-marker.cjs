/**
 * 探针：版式切换那颗滑块到底动没动（用户 m12760 第 2 条）。
 *
 * 为什么不能只看「切换成功」：`data-ready` 没置上、或者 `--marker-x` 没写进去时，
 * 按钮照样会换选中态（那是 React 的），只有那颗白底滑块会瞬移或者干脆不动。
 * 所以要**逐帧**记录它的 `transform`，确认切换过程中存在中间值。
 *
 * 判据三条：
 *   1. 三个按钮各自的 offsetLeft/offsetWidth 与滑块位置对得上（误差 < 1px）
 *   2. 点相邻那颗之后，滑块出现过中间态（不是一帧跳到位）
 *   3. 三档的宽度、位置互不相同——三个字长短不一样，滑块得跟着变宽
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { launch, guard, wait, report } = require('./harness.cjs');

/** 读当前滑块与三颗按钮的几何关系。 */
const READ = `(() => {
  const group = document.querySelector('.theater-templates');
  if (!group) return { error: 'no-group' };
  const marker = group.querySelector('.template-marker');
  const buttons = [...group.querySelectorAll('button')];
  const style = group.getAttribute('style') || '';
  const markerStyle = marker ? getComputedStyle(marker) : null;
  return {
    ready: group.dataset.ready || null,
    styleVars: style,
    markerLeft: marker ? marker.getBoundingClientRect().left : null,
    markerWidth: marker ? marker.getBoundingClientRect().width : null,
    markerTransition: markerStyle ? markerStyle.transitionProperty + ' ' + markerStyle.transitionDuration : null,
    buttons: buttons.map(b => ({
      name: b.textContent.trim(),
      on: b.classList.contains('on'),
      left: b.getBoundingClientRect().left,
      width: b.getBoundingClientRect().width,
    })),
  };
})()`;

/**
 * 点第 index 颗，同时用 rAF 逐帧记录滑块 left/width。
 *
 * 必须**在同一个 executeJavaScript 里**点与记录：分两次调用的话，
 * 中间隔的是 380ms 的过渡，抓到的时候早就到位了。
 */
const CLICK_AND_TRACK = index => `(async () => {
  const group = document.querySelector('.theater-templates');
  if (!group) return { error: 'no-group' };
  const marker = group.querySelector('.template-marker');
  const buttons = [...group.querySelectorAll('button')];
  const target = buttons[${index}];
  if (!target) return { error: 'no-button' };

  const frames = [];
  const read = () => {
    const box = marker.getBoundingClientRect();
    frames.push({ t: Math.round(performance.now()), left: Math.round(box.left * 100) / 100, width: Math.round(box.width * 100) / 100 });
  };
  read();
  target.click();

  // 过渡 380ms，多留 200ms 把收尾那帧也收进来。
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
    from: { left: first.left, width: first.width },
    to: { left: last.left, width: last.width },
    midCount: mids.length,
    midSample: mids.length ? mids[Math.min(2, mids.length - 1)] : null,
    travelled: Math.round((last.left - first.left) * 100) / 100,
    widened: Math.round((last.width - first.width) * 100) / 100,
  };
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080, template: 'collage', expand: true, settle: 2600 });
  const { run, win } = probe;
  const out = {};

  // ---- 1. 初始：滑块应该正好压在第一颗（拼贴）上
  out.initial = await run(READ);

  // ---- 2. 切到第二颗（相集）：逐帧看它滑过去
  out.toPhoto = await run(CLICK_AND_TRACK(1));
  await wait(260);
  out.afterPhoto = await run(READ);

  // ---- 3. 切到第三颗（透明）：再滑一次，宽度要变
  out.toDesktop = await run(CLICK_AND_TRACK(2));
  await wait(260);
  out.afterDesktop = await run(READ);

  // ---- 4. 切回第一颗：反向也要有中间态
  out.backToCollage = await run(CLICK_AND_TRACK(0));
  await wait(260);
  out.afterCollage = await run(READ);

  // ---- 5. 截图：三颗并排、第三颗选中，滑块应当在最右
  const png = (await win.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(__dirname, 'template-marker.png'), png);
  out.shot = 'tools/probe/template-marker.png';

  report(out);
});
