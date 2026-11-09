/**
 * 桌面放映窗的实机探针。
 *
 * 验的是四件在纯逻辑测试里看不到的事：
 *   1. 点了「放到桌面」之后真的多出一个窗口，且尺寸等于那块屏（不是工作区）；
 *   2. 那个窗口画的是同一个舞台（.template-collage 在、画面在、信息条在）；
 *   3. 窗口上点胶囊，主窗口的石纹跟着换——也就是命令那条线是通的；
 *   4. 桌面窗没有抢走 MediaBridge：主窗口的媒体动作照常处理。
 *
 * 为什么不用两个 BrowserWindow 各自 loadFile：harness 的 launch() 已经把
 * 主窗口造好了（含 media scheme、注入的柜子、切到放映页），直接用那只最省。
 * 桌面窗必须由 desktop-stage.cjs 自己开，否则验的不是真实路径。
 *
 * 跑法（本 shell 里没有 env 命令，要用 PowerShell 的 Remove-Item）：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules/electron/dist/electron.exe tools/probe/desktop-stage.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { BrowserWindow, app, screen } = require('electron');
const { launch, report, wait, ROOT } = require('./harness.cjs');
const { attachDesktopStage, desktopStage } = require(path.join(ROOT, 'electron', 'desktop-stage.cjs'));

const OUT = path.join(__dirname, 'desktop-stage.png');

/** 桌面窗里能看到的那些块。全是读 DOM，不猜。 */
const READ_STAGE = `(() => {
  const root = document.querySelector('.template-collage');
  const box = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    ready: !!root,
    stone: root ? (root.getAttribute('data-stone') || '') : '',
    canvas: box('.template-collage'),
    bar: box('.tpl-block-bar'),
    panel: box('.tpl-block-panel'),
    tag: document.querySelector('.tpl-tag') ? {
      box: box('.tpl-tag'),
      label: document.querySelector('.tpl-tag').getAttribute('aria-label'),
      disabled: document.querySelector('.tpl-tag').disabled,
    } : null,
    disc: box('.tpl-disc'),
    video: (() => {
      const v = document.querySelector('video');
      if (!v) return null;
      return { w: v.videoWidth, h: v.videoHeight, paused: v.paused, readyState: v.readyState };
    })(),
    body: { w: innerWidth, h: innerHeight },
  };
})()`;

app.whenReady().then(async () => {
  const { win, run, shot } = await launch({ expand: true });
  attachDesktopStage(win);

  const mainBefore = await run(`(() => {
    const root = document.querySelector('.template-collage');
    return {
      stone: root ? root.getAttribute('data-stone') : '',
      desktopButton: !!document.querySelector('.theater-desktop'),
      desktopPressed: document.querySelector('.theater-desktop')?.getAttribute('aria-pressed') || '',
      windows: 1,
    };
  })()`);

  const display = screen.getDisplayMatching(win.getBounds());

  // 点「放到桌面」
  await run(`(() => { document.querySelector('.theater-desktop')?.click(); return 1; })()`);
  await wait(1200);

  const all = BrowserWindow.getAllWindows();
  const deskWin = all.find(w => w.webContents.getURL().includes('desktop.html')) || null;

  let deskInfo = null;
  let stage = null;
  let bridge = null;
  let stoneAfter = null;
  let pressedAfter = '';

  if (deskWin) {
    const bounds = deskWin.getBounds();
    deskInfo = {
      found: true,
      url: path.basename(new URL(deskWin.webContents.getURL()).pathname),
      bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
      display: { x: display.bounds.x, y: display.bounds.y, w: display.bounds.width, h: display.bounds.height },
      matchesDisplay: bounds.x === display.bounds.x && bounds.y === display.bounds.y
        && bounds.width === display.bounds.width && bounds.height === display.bounds.height,
      visible: deskWin.isVisible(),
      alwaysOnTop: deskWin.isAlwaysOnTop(),
      minimizable: deskWin.isMinimizable(),
      windowCount: all.length,
    };

    // 等快照推过来、React 画完
    await wait(1600);
    stage = await deskWin.webContents.executeJavaScript(READ_STAGE);

    // 在桌面窗上点胶囊 → 主窗口应该跟着换石纹
    await deskWin.webContents.executeJavaScript(`(() => { document.querySelector('.tpl-tag')?.click(); return 1; })()`);
    await wait(1200);
    const deskAfter = await deskWin.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.template-collage');
      return root ? root.getAttribute('data-stone') : '';
    })()`);
    stoneAfter = deskAfter;
    pressedAfter = await run(`document.querySelector('.theater-desktop')?.getAttribute('aria-pressed') || ''`);

    // 顺手截一张桌面窗（这是用户真正会看到的画面）
    const png = (await deskWin.webContents.capturePage()).toPNG();
    fs.writeFileSync(OUT, png);

    // 桌面窗不该抢 MediaBridge：主窗口还在，且没有第二个 target 抢走轮询。
    // 判据是主窗口的 outbox 还在被清空——被抢走的话它会一直攒着没人取。
    bridge = await run(`(() => {
      const before = (window.__ravenMediaOutbox || []).length;
      window.__ravenMediaOutbox = [...(window.__ravenMediaOutbox || []), { type: 'ping' }];
      return { before };
    })()`);
    await wait(900);
    bridge = {
      ...bridge,
      after: await run(`(window.__ravenMediaOutbox || []).length`),
      drained: await run(`(window.__ravenMediaOutbox || []).length`) === 0,
    };
  }

  const mainAfter = await run(READ_STAGE);

  // 收回
  if (deskWin) {
    await run(`(() => { document.querySelector('.theater-desktop')?.click(); return 1; })()`);
    await wait(900);
  }
  const closedCheck = {
    windowsLeft: BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.webContents.getURL().includes('desktop.html')).length,
    pressedAfterClose: await run(`document.querySelector('.theater-desktop')?.getAttribute('aria-pressed') || ''`),
  };

  report({
    before: mainBefore,
    desktop: deskInfo,
    stage,
    stageMain: mainAfter,
    stoneAfterClickOnDesktop: stoneAfter,
    pressedAfterClickOnDesktop: pressedAfter,
    bridge,
    closed: closedCheck,
    image: fs.existsSync(OUT) ? OUT : null,
  });
}).catch(e => {
  console.error('PROBE_FAIL ' + e.message + '\n' + e.stack);
  app.exit(1);
});
