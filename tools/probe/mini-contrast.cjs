// mini 窗口的文本对比度实测。
//
// 为什么不能靠推理：`#101010` 底 + `#ffffff` 主数字确实是 18:1，没问题；
// 但副标题用的是 rgba 叠出来的灰、休息阶段的环又是另一族颜色，
// 这些必须按实际渲染像素算。
//
// 原理与 tools/probe/contrast-px.py 一致：文字笔画是少数像素、背景是多数，
// 所以「元素矩形内出现次数最多的颜色」就是底色。
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(process.cwd(), '.qa', 'mini-contrast');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 306, height: 96, show: false, transparent: true, frame: false,
    backgroundColor: '#00000000', webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(process.cwd(), 'electron', 'mini.html'));
  await new Promise(r => setTimeout(r, 400));

  const phases = [
    { id: 'focus', phase: 'focus' },
    { id: 'break', phase: 'break' },
    { id: 'long-break', phase: 'longBreak' },
  ];

  const rows = [];
  for (const p of phases) {
    const info = JSON.parse(await win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.card');
      card.classList.toggle('break', ${JSON.stringify(p.phase === 'break')});
      card.classList.toggle('longBreak', ${JSON.stringify(p.phase === 'longBreak')});

      // 收集所有「自己直接持有文字」的元素
      const out = [];
      const walk = (node) => {
        for (const child of node.children) {
          const text = [...child.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
          if (text) {
            const r = child.getBoundingClientRect();
            if (r.width >= 2 && r.height >= 2) {
              const cs = getComputedStyle(child);
              out.push({
                sel: child.tagName.toLowerCase() + (child.className ? '.' + String(child.className).split(' ').join('.') : ''),
                text,
                rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                px: parseFloat(cs.fontSize),
                weight: cs.fontWeight,
                color: cs.color,
              });
            }
          }
          walk(child);
        }
      };
      walk(card);
      return JSON.stringify(out);
    })()`, true));

    await new Promise(r => setTimeout(r, 240));
    const png = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, 'shot-' + p.id + '.png'), png.toPNG());
    fs.writeFileSync(path.join(OUT, 'elements-' + p.id + '.json'), JSON.stringify(info, null, 2));
    rows.push({ phase: p.id, elements: info.length });
  }

  console.log(JSON.stringify(rows));
  app.exit(0);
}).catch(e => { console.error('PROBE_FAIL ' + (e && e.stack || e)); app.exit(1); });
