/**
 * 量票根面板的高度：纸面有没有撑满浮层。
 *
 * 用户 2026-11-16 报「点开之后怎么票根只剩一半了」，截图里票根的米白纸
 * 从 y≈6.7% 到 y≈76.6%，而封面上缘一样、下缘到 y≈88%——票面短了一截。
 *
 * 怀疑点：改撕票根那版把 `.ticket-fold > .ticket-panel { position:absolute;
 * inset:0; width:100%; height:100% }` 整段换成 `.ticket-face { position:absolute;
 * inset:0 }`，`height:100%` 没了。`.ticket-panel` 的 `flex: 1` 只对 flex 容器
 * 生效，而它现在挂在一个 `display:block` 的绝对定位父级里 —— 高度塌成内容高度。
 *
 * 这个探针只量数，不判对错：外层 .ticket-lift-panel 该是满高，
 * 内层 .ticket-panel 如果明显小就是塌了。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/ticket-face-height.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'ticket-face');

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const { win, run, shot, close } = await launch({
    width: 1920, height: 1080, template: 'collage', expand: true,
  });
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1704, height: 846, deviceScaleFactor: 1, mobile: false,
  });
  await wait(500);

  const info = await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === '相集')?.click();
    await sleep(600);
    const t = document.querySelector('.ticket');
    if (!t) return { error: 'no-ticket' };
    (t.querySelector('button') || t).click();
    await sleep(900);

    const box = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { y: Math.round(r.y), h: Math.round(r.height) };
    };
    const cs = el => (el ? getComputedStyle(el) : null);

    const lift = document.querySelector('.ticket-lift');
    const shotEl = document.querySelector('.ticket-lift-shot');
    const panelWrap = document.querySelector('.ticket-lift-panel');
    const face = document.querySelector('.ticket-face');
    const panel = document.querySelector('.ticket-lift-panel .ticket-panel');

    return {
      layout: panel ? panel.dataset.layout : null,
      lift: box(lift),
      shot: box(shotEl),
      panelWrap: box(panelWrap),
      face: box(face),
      panel: box(panel),
      faceDisplay: cs(face)?.display,
      faceHeight: cs(face)?.height,
      panelHeight: cs(panel)?.height,
      panelFlex: cs(panel)?.flex,
      panelJustify: cs(panel)?.justifyContent,
      panelPad: cs(panel)?.paddingTop + ' / ' + cs(panel)?.paddingBottom,
    };
  })()`);

  console.log('[face] ' + JSON.stringify(info, null, 2));

  // 把票根那条裁下来放大，好目视
  await wait(300);
  const full = path.join(OUT, 'full.png');
  await shot(full);
  await close();

  const { execFileSync } = require('node:child_process');
  const py = 'C:/Users/DumbRaven/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe';
  try {
    execFileSync(py, ['-c', `
from PIL import Image
im = Image.open(r'${full.replace(/\\/g, '/')}')
print(im.size)
c = im.crop((1050, 150, 1400, 750))
c.save(r'${path.join(OUT, 'panel-zoom.png').replace(/\\/g, '/')}')
`], { stdio: 'inherit' });
  } catch (e) {
    console.log('[face] crop skipped:', e.message);
  }
});
