/**
 * 「移出」按钮的键盘可达性（用真实的 Tab 键）。
 *
 * CSS 里写的是 `opacity: 0` + `pointer-events: none`，注释里承诺「Tab 仍够得着」。
 * 这个承诺必须实测——`pointer-events: none` 不影响键盘，但 `visibility: hidden`
 * 或 `display: none` 会让元素彻底退出 Tab 序列，三者很容易写混。
 *
 * **焦点移动不能靠 dispatchEvent**：Tab 序是浏览器原生行为，页面里伪造一个
 * `KeyboardEvent('keydown')` 只会触发监听器，焦点一动不动（实测连走 40 步都停在
 * 同一个按钮上）。必须走 CDP 的 `Input.dispatchKeyEvent`，它进的是真正的输入管道。
 *
 * 判据：从第一张票开始按 Tab，能聚焦到 `.ticket-remove`；聚焦后 `opacity` 必须是 1
 * （焦点落在一个看不见的按钮上，等于没有入口）。
 */
const path = require('node:path');
const { launch, guard, report, wait, MEDIA_DIR } = require('./harness.cjs');

guard(async () => {
  const media = [
    { id: 'image:1', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Ocean', size: 1 },
    { id: 'image:2', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Drowned Dusk', size: 1 },
  ];
  const probe = await launch({
    width: 680, height: 980, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;

  win.webContents.debugger.attach('1.3');
  const send = (type) => win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type,
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });

  // 从第一张票开始，否则要 Tab 很久才走到票根区
  await run(`(() => { document.querySelector('.ticket-grid > li .ticket')?.focus(); return 1; })()`);
  await wait(200);

  const visited = [];
  let reached = null;
  for (let i = 0; i < 24; i += 1) {
    await send('keyDown');
    await send('keyUp');
    await wait(90);
    const snap = await run(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cls = typeof el.className === 'string' ? el.className.split(' ').join('.') : '';
      return {
        tag: el.tagName + (cls ? '.' + cls : ''),
        isRemove: !!(el.classList && el.classList.contains('ticket-remove')),
        opacity: getComputedStyle(el).opacity,
        pointer: getComputedStyle(el).pointerEvents,
        label: el.getAttribute('aria-label'),
        outline: getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth,
      };
    })()`);
    if (!snap) break;
    visited.push(snap.tag);
    if (snap.isRemove) { reached = snap; break; }
  }

  report({ reached, visited, steps: visited.length });
});
