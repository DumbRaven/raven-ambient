// 键盘路径实测：Tab 一圈看焦点落点、顺序、可见性、是否有焦点陷阱。
// 用的是页面内真实的 Tab 键（CDP Input.dispatchKeyEvent），不是 dispatchEvent。
const { guard, report, launch } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080 });
  const out = {};

  // 用 CDP 发真的 Tab，离屏窗口的 sendInputEvent 投不进 DOM 焦点链
  const dbg = probe.win.webContents.debugger;
  dbg.attach('1.3');
  async function tab(n) {
    for (let i = 0; i < n; i++) {
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab' });
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab' });
      await new Promise(r => setTimeout(r, 60));
    }
  }

  async function describe() {
    const js = `(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return JSON.stringify({ none: true });
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const ring = getComputedStyle(el, '::after');
      return JSON.stringify({
        tag: el.tagName,
        cls: typeof el.className === 'string' ? el.className : '',
        text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
        label: el.getAttribute('aria-label'),
        w: Math.round(r.width), h: Math.round(r.height),
        outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
        offset: r.x > -1 && r.y > -1 && r.x < innerWidth && r.y < innerHeight,
      });
    })()`;
    return JSON.parse(await probe.run(js));
  }

  out.stops = [];
  for (let i = 0; i < 28; i++) {
    await tab(1);
    out.stops.push(await describe());
  }
  out.tabs = await probe.run('document.querySelectorAll("[tabindex],button,input,select,textarea,a[href]").length');
  report(out);
});
