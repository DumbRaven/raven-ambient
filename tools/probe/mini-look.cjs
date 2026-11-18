// 拍番茄钟小窗（electron/mini.html）在真实尺寸 306x96 下的样子。
//
// 为什么要单独一个探针：mini.html 是**独立渲染进程 + 内联 CSS**，它不加载
// skin-bold.css，所以三道门禁（样式快照 / 像素基线）完全覆盖不到它。
// 它的视觉只能靠这里亲眼确认。
//
// 小窗平时靠主进程推快照（`focus-mini.cjs` 的 webContents.send），
// 这里直接往页面里灌同样的 JSON 形状，不启动主进程。
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(process.cwd(), '.qa', 'mini');

/** 一份接近真实的快照。字段名取自 electron/mini.html 里 apply() 读的那些。 */
const SNAP = {
  phase: 'focus',
  label: '专注',
  remain: '18:42',
  total: '25:00',
  progress: 0.25,
  round: 2,
  disc: {
    base: '#2c3444',
    accent: '#7f93b8',
    accent2: '#4a5872',
    sheen: '#dfe6f2',
    angle: '30deg',
    art: null,
    pressing: 'swirl',
    light: false,
  },
};

const CASES = [
  { file: 'swirl', pressing: 'swirl' },
  { file: 'marble', pressing: 'marble' },
  { file: 'splatter', pressing: 'splatter' },
  { file: 'glow', pressing: 'glow' },
  { file: 'halo', pressing: 'halo' },
  { file: 'break', pressing: 'swirl', phase: 'break', label: '休息' },
  { file: 'long-break', pressing: 'swirl', phase: 'longBreak', label: '长休息' },
  { file: 'light-disc', pressing: 'swirl', light: true },
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: 306,
    height: 96,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });

  await win.loadFile(path.join(process.cwd(), 'electron', 'mini.html'));
  await new Promise(r => setTimeout(r, 400));

  const rows = [];
  for (const one of CASES) {
    const snapshot = JSON.parse(JSON.stringify(SNAP));
    if (one.phase) snapshot.phase = one.phase;
    if (one.label) snapshot.label = one.label;
    snapshot.disc.pressing = one.pressing;
    if (one.light) snapshot.disc.light = true;

    // 页面里 apply() 是本地函数，外面拿不到；直接照它的写法改 DOM 更快也更稳。
    const info = await win.webContents.executeJavaScript(`(() => {
      const s = ${JSON.stringify(snapshot)};
      const card = document.querySelector('.card');
      const disc = document.querySelector('.disc');
      if (!card || !disc) return JSON.stringify({ error: 'no-card' });

      card.classList.toggle('break', s.phase === 'break');
      card.classList.toggle('longBreak', s.phase === 'longBreak');

      const style = disc.style;
      style.setProperty('--v-base', s.disc.base);
      style.setProperty('--v-accent', s.disc.accent);
      style.setProperty('--v-accent-2', s.disc.accent2);
      style.setProperty('--v-sheen', s.disc.sheen);
      style.setProperty('--v-angle', s.disc.angle);
      style.setProperty('--v-art', 'none');
      disc.className = 'disc pressing-' + s.disc.pressing + (s.disc.light ? ' is-light' : '');

      const r = disc.getBoundingClientRect();
      const cs = getComputedStyle(disc);
      const cardCs = getComputedStyle(card);
      return JSON.stringify({
        discClass: disc.className,
        discRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        layers: cs.backgroundImage.split(/,(?![^(]*\\))/).length,
        cardRadius: cardCs.borderRadius,
        cardBg: cardCs.backgroundColor,
      });
    })()`, true);

    await new Promise(r => setTimeout(r, 260));
    const png = await win.webContents.capturePage();
    const file = path.join(OUT, one.file + '.png');
    fs.writeFileSync(file, png.toPNG());
    rows.push({ case: one.file, ...JSON.parse(info) });
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows));
  app.exit(0);
}).catch(error => {
  console.error('PROBE_FAIL ' + (error && error.stack || error));
  app.exit(1);
});
