// halo 到底该怎么修？把「渐变参数」和「外发光」拆开来分别量。
//
// 背景：styles.css 里 halo 与 glow 是两条不同的规则
//   glow  26% / 56% / 76%          （盘心一圈较宽的高亮带）
//   halo  26% / 48% / 74% + 标签外一条 3 段 box-shadow 光环
// 而 mini.html 把 halo 合进了 glow 那条（26%/56%/76%），且完全没有 box-shadow。
//
// 但 box-shadow 的 11px / 24px 是按主界面「标签直径约 72px」设计的，
// mini 的标签只有 13px —— 照抄会让光晕比整个盘还大。所以要把两件事分开量：
//   A 只改渐变（26/48/74），不加发光
//   B 渐变 + 按比例缩小后的发光（4px / 9px）
//   C 渐变 + 照抄的发光（11px / 24px），作为「照抄会有多离谱」的对照
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(process.cwd(), '.qa', 'mini-halo');

const VARIANTS = [
  { id: 'glow-baseline', css: '' }, // 不改：现状（与 glow 完全一样）
  { id: 'a-gradient-only', css: `.disc.pressing-halo{background-image:radial-gradient(circle at 50% 50%,var(--v-base) 26%,var(--v-accent) 48%,var(--v-base) 74%,var(--v-sheen) 100%)}` },
  { id: 'b-gradient-glow4-9', css: `.disc.pressing-halo{background-image:radial-gradient(circle at 50% 50%,var(--v-base) 26%,var(--v-accent) 48%,var(--v-base) 74%,var(--v-sheen) 100%)}.disc.pressing-halo::after{box-shadow:0 0 0 1px rgba(255,255,255,.36),0 0 4px var(--v-sheen),0 0 9px var(--v-accent)}` },
  { id: 'c-gradient-glow11-24', css: `.disc.pressing-halo{background-image:radial-gradient(circle at 50% 50%,var(--v-base) 26%,var(--v-accent) 48%,var(--v-base) 74%,var(--v-sheen) 100%)}.disc.pressing-halo::after{box-shadow:0 0 0 1px rgba(255,255,255,.36),0 0 11px var(--v-sheen),0 0 24px var(--v-accent)}` },
  { id: 'z-glow-for-compare', css: '' }, // 同上但工艺设成 glow，作为「本来就该长这样」的参照
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 306, height: 96, show: false, transparent: true, frame: false,
    backgroundColor: '#00000000', webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(process.cwd(), 'electron', 'mini.html'));
  await new Promise(r => setTimeout(r, 400));

  const rows = [];
  for (const v of VARIANTS) {
    const pressing = v.id === 'z-glow-for-compare' ? 'glow' : 'halo';
    await win.webContents.executeJavaScript(`(() => {
      const old = document.getElementById('halo-patch');
      if (old) old.remove();
      const css = ${JSON.stringify(v.css)};
      if (css) {
        const el = document.createElement('style');
        el.id = 'halo-patch';
        el.textContent = css;
        document.head.appendChild(el);
      }
      const disc = document.querySelector('.disc');
      disc.style.setProperty('--v-base', '#2c3444');
      disc.style.setProperty('--v-accent', '#7f93b8');
      disc.style.setProperty('--v-accent-2', '#4a5872');
      disc.style.setProperty('--v-sheen', '#dfe6f2');
      disc.style.setProperty('--v-angle', '30deg');
      disc.style.setProperty('--v-art', 'none');
      disc.className = 'disc pressing-' + ${JSON.stringify(pressing)};
      return undefined;
    })()`, true);
    await new Promise(r => setTimeout(r, 240));
    const png = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, v.id + '.png'), png.toPNG());
    rows.push(v.id);
  }
  console.log(JSON.stringify(rows));
  app.exit(0);
}).catch(e => { console.error('PROBE_FAIL ' + (e && e.stack || e)); app.exit(1); });
