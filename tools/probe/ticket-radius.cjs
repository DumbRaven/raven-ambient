/**
 * 探针：放映台的圆角（用户 m14515 第 3 条）。
 *
 * 「这个放映机不全屏的时候，为了咱们软件的美观，咱们不都应该是圆角的吗，放映机你也圆角吧」
 * 窗口态要 16px；**全屏时必须是 0**——那时这块就是屏幕本身，圆角会漏出桌面。
 *
 * 两态在同一个窗口里量：先窗口态，再点全屏，量完退出来。
 * 不另起第二个窗口——`launch()` 的 `close()` 是 `app.exit(0)`。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-radius.cjs --no-sandbox
 */
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

const READ = `(() => {
  const screen = document.querySelector('.theater-screen');
  const room = document.querySelector('.media-room');
  if (!screen) return { error: 'no-screen' };
  const style = getComputedStyle(screen);
  return {
    expanded: room?.classList.contains('is-expanded') ?? null,
    radius: style.borderRadius,
    overflow: style.overflow,
    size: {
      w: Math.round(screen.getBoundingClientRect().width),
      h: Math.round(screen.getBoundingClientRect().height),
    },
  };
})()`;

const CLICK_EXPAND = `(() => {
  const button = document.querySelector('.theater-expand');
  if (!button) return 'missing';
  button.click();
  return button.getAttribute('aria-label');
})()`;

guard(async () => {
  const probe = await launch({
    width: 1280, height: 900, template: 'collage', expand: false, settle: 1400,
  });
  const { run, shot } = probe;
  const out = {};

  out.window = await run(READ);

  out.toggled = await run(CLICK_EXPAND);
  // 全屏要等主进程收命令 + Windows 过渡，光靠 rAF 不够。
  await wait(1600);
  out.fullscreen = await run(READ);
  await shot(path.join(__dirname, 'ticket-radius-fullscreen.png'));

  await run(CLICK_EXPAND);
  await wait(1600);
  out.restored = await run(READ);

  report(out);
});
