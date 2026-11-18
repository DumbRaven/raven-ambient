// 拍一张「键盘停在图层块上」的截图，确认焦点环到底画了几层。
// overlay 的默认 outline 没被重置，`.overlay:focus-visible::after` 又画了一圈虚线，
// 两者叠在一起是不是真的双重环，只能看图。
const { guard, report, launch } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080 });
  const dbg = probe.win.webContents.debugger;
  dbg.attach('1.3');
  async function tab(n) {
    for (let i = 0; i < n; i++) {
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab' });
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab' });
      await new Promise(r => setTimeout(r, 80));
    }
  }
  // 第 10 次 Tab 停在 `.overlay-clock`（见 keyboard-path 的输出）
  await tab(10);
  const who = await probe.run(`(() => { const e = document.activeElement; return e.className + ' | ' + e.getBoundingClientRect().toJSON().x + ',' + e.getBoundingClientRect().toJSON().y; })()`);
  const r = JSON.parse(await probe.run('JSON.stringify(document.activeElement.getBoundingClientRect().toJSON())'));
  await probe.shot('.qa/overlay-focus.png');
  report({ who, rect: r });
});
