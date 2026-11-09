/**
 * 桌面放映窗的实机探针。
 *
 * 验的是六件在纯逻辑测试里看不到的事：
 *   1. 点了「放到桌面」之后真的多出一个窗口，且尺寸等于那块屏（不是工作区）；
 *   2. **窗口是透明的**——html/body/.desktop-stage 三层都不能有不透明底色，
 *      否则桌面壁纸透不上来，这个模式就白做了；
 *   3. 那个窗口画的是同一个舞台（版式根节点在、唱片在）或透明模式的组件；
 *   4. 窗口上点胶囊，主窗口的石纹跟着换——也就是命令那条线是通的；
 *   5. 桌面窗没有抢走 MediaBridge：主窗口的媒体动作照常处理；
 *   6. 透明模式的组件在主窗口里能加、能拖、能删，且桌面窗跟着变。
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
const OUT_DESKTOP = path.join(__dirname, 'desktop-transparent.png');
const OUT_MAIN = path.join(__dirname, 'desktop-preview.png');

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

/**
 * 透明模式的读法：结构全是新的，不能套 READ_STAGE（那边找 .template-collage）。
 *
 * 几个关键判据：
 *   - `transparentLayers`：三层背景色必须都是全透明。任何一层不透明，
 *     桌面壁纸就被那块盖住，这个模式等于没做。
 *   - `roots`：版式根节点是 `.template-desktop`，而且**里面不能有 video/img**
 *     —— 有的话说明又把画面画上去了，那会盖掉正在跑的壁纸。
 *   - `widgets`：每块的 id、位置、可见性。
 */
const READ_TRANSPARENT = `(() => {
  const alpha = color => {
    if (!color) return null;
    if (color === 'transparent') return 0;
    const m = color.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map(v => parseFloat(v));
    return parts.length < 4 ? 1 : parts[3];
  };
  const bg = sel => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).backgroundColor : null;
  };
  /**
   * 从「要找的那块」一路沿父节点爬到 body，逐层报背景色。
   *
   * 为什么不再挑几层写死：上一版只量了 html/body/.desktop-stage/.template-desktop
   * 四层，漏掉中间的 .media-theater 与 .theater-screen——那两条在 skin-bold.css
   * 里是全屏用的 #000000，整块画面被盖住，包里却是「全绿」。教训写在探针里。
   */
  const chain = el => {
    const out = [];
    let node = el;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      out.push({
        tag: node.tagName.toLowerCase(),
        cls: (node.className || '').toString().trim().slice(0, 60),
        bg: style.backgroundColor,
        alpha: alpha(style.backgroundColor),
        opacity: style.opacity,
        backgroundImage: style.backgroundImage === 'none' ? '' : 'set',
      });
      node = node.parentElement;
    }
    const rootStyle = getComputedStyle(document.documentElement);
    out.push({ tag: 'html', cls: '', bg: rootStyle.backgroundColor, alpha: alpha(rootStyle.backgroundColor), opacity: rootStyle.opacity, backgroundImage: rootStyle.backgroundImage === 'none' ? '' : 'set' });
    return out;
  };
  const root = document.querySelector('.template-desktop');
  const layer = document.querySelector('.desktop-widgets');
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const stack = root ? chain(root) : [];
  return {
    hasRoot: !!root,
    rootBg: root ? getComputedStyle(root).backgroundColor : null,
    htmlBg: bg('html'),
    bodyBg: bg('body'),
    stageBg: bg('.desktop-stage'),
    /** 从内容一路到 html 的每一层；有一层 alpha > 0 就透不过去。 */
    stack,
    opaqueLayers: stack.filter(step => step.alpha !== null && step.alpha > 0),
    transparentLayers: {
      html: alpha(bg('html')),
      body: alpha(bg('body')),
      stage: alpha(bg('.desktop-stage')),
      root: alpha(root ? getComputedStyle(root).backgroundColor : null),
    },
    media: {
      video: document.querySelectorAll('.template-desktop video').length,
      img: document.querySelectorAll('.template-desktop img').length,
    },
    widgets: layer ? [...document.querySelectorAll('.dw')].map(el => ({
      id: [...el.classList].find(name => name.startsWith('dw-') && name !== 'dw-kill' && name !== 'dw-disc') || '',
      cls: el.className,
      box: rect(el),
      editable: el.getAttribute('data-editable') || '',
      text: (el.textContent || '').trim().slice(0, 24),
    })) : [],
    empty: !!document.querySelector('.desktop-widgets-empty'),
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
      // 全屏键与「放到桌面」现在是同一颗：拼贴版式下它是全屏，透明版式下它是桌面。
      expandLabel: document.querySelector('.theater-expand')?.getAttribute('aria-label') || '',
      templates: [...document.querySelectorAll('.theater-templates button')].map(b => b.textContent.trim()),
      windows: 1,
    };
  })()`);

  const display = screen.getDisplayMatching(win.getBounds());

  // 先切到透明版式——那颗键只有在这个版式下才表示「放到桌面」
  // （用户 m11693：切换成透明的时候，全屏就变成桌面放映）。
  await run(`(() => {
    [...document.querySelectorAll('.theater-templates button')]
      .find(b => b.textContent.trim() === '透明')?.click();
    return 1;
  })()`);
  await wait(900);
  await run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
  await wait(1400);

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

    // 在桌面窗里拖一块组件 → 主窗口那份存档应该跟着变。
    // （原来是点胶囊验石纹，但透明版式下画面里没有胶囊——那颗按钮长在拼贴版式上。
    //  透明版式里唯一能点的东西就是组件本身，正好也就是这次要验的「全屏也能拖」。）
    const dragBefore = await run(`(() => {
      const raw = localStorage.getItem('raven-desktop-widgets');
      const list = raw ? JSON.parse(raw) : [];
      const clock = list.find(w => w.id === 'clock');
      return clock ? clock.spot : null;
    })()`);
    const dragResult = await deskWin.webContents.executeJavaScript(`(async () => {
      const el = document.querySelector('.dw-clock');
      if (!el) return { error: 'no-clock' };
      const box = el.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const fire = (type, px, py) => el.dispatchEvent(new PointerEvent(type, {
        pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1,
        clientX: px, clientY: py, bubbles: true, cancelable: true,
      }));
      fire('pointerdown', x, y);
      await new Promise(r => setTimeout(r, 260));
      fire('pointermove', x - 160, y + 80);
      await new Promise(r => setTimeout(r, 60));
      fire('pointerup', x - 160, y + 80);
      await new Promise(r => setTimeout(r, 260));
      const after = el.getBoundingClientRect();
      return { movedX: Math.round(after.left - box.left), movedY: Math.round(after.top - box.top) };
    })()`);
    await wait(900);
    const dragAfter = await run(`(() => {
      const raw = localStorage.getItem('raven-desktop-widgets');
      const list = raw ? JSON.parse(raw) : [];
      const clock = list.find(w => w.id === 'clock');
      return clock ? clock.spot : null;
    })()`);
    stoneAfter = { dragBefore, dragResult, dragAfter, wroteBack: JSON.stringify(dragBefore) !== JSON.stringify(dragAfter) };
    pressedAfter = await run(`document.querySelector('.theater-expand')?.getAttribute('aria-pressed') || ''`);

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

  // ---------- 透明模式 ----------
  // 切到第三套版式（透明），主窗口这边加一块组件，桌面窗跟着变。
  const transparentMain = await run(`(() => {
    const buttons = [...document.querySelectorAll('.theater-templates button')];
    const target = buttons.find(b => b.textContent.includes('透明'));
    if (!target) return { missing: true, labels: buttons.map(b => b.textContent.trim()) };
    target.click();
    return { clicked: true, labels: buttons.map(b => b.textContent.trim()) };
  })()`);
  await wait(900);
  const transparentMainState = await run(READ_TRANSPARENT);

  // 主窗口这边有编辑入口，桌面窗只读
  // 「叠加元素」与「加组件」合并成了一颗按钮（用户 m11693），
  // 透明版式下它的菜单就是六项组件。
  const widgetMenu = await run(`(() => {
    const toggle = document.querySelector('.theater-overlays .theater-overlay-toggle');
    if (!toggle) return { missing: true };
    toggle.click();
    return { opened: true, label: toggle.getAttribute('aria-label') };
  })()`);
  await wait(400);
  const widgetItems = await run(`(() => {
    const nodes = [...document.querySelectorAll('.theater-overlay-menu > button')];
    return nodes.map(n => ({ label: n.textContent.trim(), checked: n.getAttribute('aria-checked') }));
  })()`);

  await wait(1200);
  const transparentDesktop = deskWin
    ? await deskWin.webContents.executeJavaScript(READ_TRANSPARENT)
    : null;

  // 主窗口里加一块、拖一块、删一块——这三条是用户真正会做的动作。
  //
  // **每条事件之间必须隔开一帧**：pointerdown 之后 React 才重渲染、useEffect
  // 才把 window 上的监听挂上。同一个 tick 里连着派发 move，监听还没挂，
  // 整段位移就丢了——第一版探针就是这么量到「一动不动」的。
  const dragDown = await run(`(() => {
    const el = document.querySelector('.dw-clock');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    window.__dragFrom = { x, y };
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y }));
    return { before: { x: Math.round(x), y: Math.round(y) } };
  })()`);
  await wait(260);
  const dragMove = await run(`(() => {
    const from = window.__dragFrom;
    const target = document.querySelector('.dw-clock');
    const seen = [];
    const spy = event => seen.push(event.type);
    window.addEventListener('pointermove', spy);
    window.addEventListener('pointerup', spy);
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 11, pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: from.x + 160, clientY: from.y + 90 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11, pointerType: 'mouse', isPrimary: true, button: 0, clientX: from.x + 160, clientY: from.y + 90 }));
    window.removeEventListener('pointermove', spy);
    window.removeEventListener('pointerup', spy);
    return { seen, styleVar: target ? target.style.getPropertyValue('--wx') : '' };
  })()`);
  await wait(700);
  const afterDrag = await run(`(() => {
    const el = document.querySelector('.dw-clock');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);

  // 加一块「标题」
  const addResult = await run(`(() => {
    const toggle = document.querySelector('.theater-overlays .theater-overlay-toggle');
    if (toggle && !document.querySelector('.theater-overlay-menu')) toggle.click();
    return { menu: !!document.querySelector('.theater-overlay-menu') };
  })()`);
  await wait(300);
  const addClick = await run(`(() => {
    const node = [...document.querySelectorAll('.theater-overlay-menu > button')].find(n => n.textContent.includes('标题'));
    if (!node) return { missing: true };
    node.click();
    return { clicked: true };
  })()`);
  await wait(600);
  const afterAdd = await run(READ_TRANSPARENT);
  const desktopAfterAdd = deskWin ? await deskWin.webContents.executeJavaScript(READ_TRANSPARENT) : null;

  // 主窗口在透明模式下的样子（那张是「预览」，有幕布）
  const mainPng = (await win.webContents.capturePage()).toPNG();
  fs.writeFileSync(OUT_MAIN, mainPng);

  // 桌面窗自己再截一张：这张图上的透明区域应该是「透过去」的
  if (deskWin) {
    const png = (await deskWin.webContents.capturePage()).toPNG();
    fs.writeFileSync(OUT_DESKTOP, png);
  }

  // 收回
  if (deskWin) {
    await run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
    await wait(900);
  }
  const closedCheck = {
    windowsLeft: BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.webContents.getURL().includes('desktop.html')).length,
    pressedAfterClose: await run(`document.querySelector('.theater-expand')?.getAttribute('aria-pressed') || ''`),
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
    transparent: {
      switched: transparentMain,
      main: transparentMainState,
      menu: widgetMenu,
      items: widgetItems,
      desktop: transparentDesktop,
      drag: { down: dragDown, move: dragMove, after: afterDrag },
      add: { open: addResult, click: addClick, main: afterAdd, desktop: desktopAfterAdd },
    },
    images: {
      desktop: fs.existsSync(OUT) ? OUT : null,
      transparent: fs.existsSync(OUT_DESKTOP) ? OUT_DESKTOP : null,
      preview: fs.existsSync(OUT_MAIN) ? OUT_MAIN : null,
    },
  });
}).catch(e => {
  console.error('PROBE_FAIL ' + e.message + '\n' + e.stack);
  app.exit(1);
});
