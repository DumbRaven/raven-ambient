/**
 * 票根浮层在各种窗口画幅下会不会溢出。
 *
 * 起因：用户 2026-11-16 报「点开之后怎么票根只剩一半了」，截图尺寸对应
 * 1704×846 逻辑像素（200% DPI 的 3409×1692），比门禁探针用的 1280×800 更宽更矮。
 *
 * `.ticket-lift` 用 `width: min(1040px, 92vw)` + `aspect-ratio: 100/47.85`，
 * 高度是从宽度**算**出来的，窗口一矮它就顶出上下边界——那时候 `.ticket-stage`
 * 的 overflow 会把它裁掉，撕口和扇贝接缝正好在两端，裁掉多少都看不出来是「被裁了」，
 * 只表现为「票根少了一截」。
 *
 * 两个坑（都踩过了）：
 * 1. **只能 launch 一次**：harness 在模块加载时注册 media scheme，多次 launch 会
 *    重复注册直接抛 `Failed to register protocol: media`。
 * 2. **离屏窗口 `win.setContentSize` 不生效**：三次实测截图全是 1920×1080，
 *    `innerWidth` 也一直是 1920。离屏渲染的窗口没有平台句柄，尺寸由离屏 surface 决定。
 *    所以画幅靠 CDP 的 `Emulation.setDeviceMetricsOverride` 模拟，改的是布局视口，
 *    正是我们要测的那个量。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/ticket-fit.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'ticket-fit');

const SIZES = [
  [1280, 800],   // 门禁探针用的
  [1704, 846],   // 用户截图的逻辑尺寸
  [1920, 1080],
  [1500, 700],   // 矮窗口：最容易顶出去
  [1100, 620],   // 又窄又矮
];

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];

  const { win, run, shot, close } = await launch({
    width: 1920, height: 1080, template: 'collage', expand: true,
  });

  win.webContents.debugger.attach('1.3');

  for (const [w, h] of SIZES) {
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: false,
    });
    await wait(500);

    const info = await run(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      document.querySelector('.ticket-stage')?.click();
      await sleep(350);
      [...document.querySelectorAll('.view-tabs > button')]
        .find(b => b.getAttribute('aria-label') === '相集')?.click();
      await sleep(450);
      const t = document.querySelector('.ticket');
      if (!t) return { error: 'no-ticket' };
      (t.querySelector('button') || t).click();
      await sleep(900);

      const stage = document.querySelector('.ticket-stage');
      const lift = document.querySelector('.ticket-lift');
      const panel = document.querySelector('.ticket-lift-panel');
      if (!lift || !panel) return { error: 'no-lift' };
      const lb = lift.getBoundingClientRect();
      const pb = panel.getBoundingClientRect();
      const st = stage ? getComputedStyle(stage) : null;
      return {
        win: [innerWidth, innerHeight],
        lift: [Math.round(lb.x), Math.round(lb.y), Math.round(lb.width), Math.round(lb.height)],
        panel: [Math.round(pb.x), Math.round(pb.y), Math.round(pb.width), Math.round(pb.height)],
        overTop: Math.round(-lb.top),
        overBottom: Math.round(lb.bottom - innerHeight),
        stageOverflow: st ? st.overflow : null,
      };
    })()`);

    await wait(400);
    await shot(path.join(OUT, `${w}x${h}.png`));
    rows.push({ size: `${w}x${h}`, ...info });
  }

  win.webContents.debugger.detach();
  await close();

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  for (const r of rows) {
    const clipped = r.overTop > 0 || r.overBottom > 0;
    console.log(`[fit] ${r.size.padEnd(9)} win=${JSON.stringify(r.win)} lift=${JSON.stringify(r.lift)} overTop=${r.overTop} overBottom=${r.overBottom}${clipped ? '  ← 顶出可视区' : ''}`);
  }
});
