// 压片工艺 A/B：把 mini.html 的三处参数差补全，在原位与补全态各拍一张，
// 数像素差。用来回答「38px 的盘上，这些差异值不值得修」。
//
// 三处差（把 mini.html 与 styles.css 逐行对出来）：
//   1. swirl      mini 4 层 / styles 5 层（少了 ellipse 40% 60% at 12% 72%）
//   2. splatter   mini 6 点 / styles 10 点（少了 63%/12%、44%/40%、58%/88%、8%/88%）
//   3. halo       mini 与 glow 共用同一条（26%/56%/76%），styles 里 halo 是
//                 26%/48%/74%，且 halo 另有一条 3 段 box-shadow 光环
//
// 判据不是「像不像」，是「38x38 的盘上变了多少像素、最大通道差多少」。
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(process.cwd(), '.qa', 'mini-ab');

/** 补全后的三段 CSS，逐字抄自 src/styles.css 的对应规则（只是变量名换回 --v-*）。 */
const PATCH = `
  .disc.pressing-swirl {
    background-image:
      radial-gradient(ellipse 66% 46% at 28% 22%, var(--v-accent) 0%, transparent 64%),
      radial-gradient(ellipse 54% 64% at 76% 66%, var(--v-accent-2) 0%, transparent 62%),
      radial-gradient(ellipse 88% 38% at 52% 94%, var(--v-accent) 0%, transparent 58%),
      radial-gradient(ellipse 40% 60% at 12% 72%, var(--v-accent-2) 0%, transparent 66%),
      radial-gradient(circle at 50% 50%, var(--v-sheen) 16%, var(--v-base) 76%);
  }
  .disc.pressing-splatter {
    background-image:
      radial-gradient(circle at 24% 18%, var(--v-accent) 0 2.4%, transparent 2.9%),
      radial-gradient(circle at 63% 12%, var(--v-accent-2) 0 1.7%, transparent 2.1%),
      radial-gradient(circle at 82% 34%, var(--v-accent) 0 2.8%, transparent 3.3%),
      radial-gradient(circle at 16% 52%, var(--v-accent-2) 0 2.1%, transparent 2.6%),
      radial-gradient(circle at 44% 40%, var(--v-accent) 0 1.4%, transparent 1.8%),
      radial-gradient(circle at 74% 62%, var(--v-accent-2) 0 2.6%, transparent 3.1%),
      radial-gradient(circle at 32% 78%, var(--v-accent) 0 2.2%, transparent 2.7%),
      radial-gradient(circle at 58% 88%, var(--v-accent-2) 0 1.6%, transparent 2%),
      radial-gradient(circle at 90% 82%, var(--v-accent) 0 2%, transparent 2.5%),
      radial-gradient(circle at 8% 88%, var(--v-accent-2) 0 1.9%, transparent 2.4%),
      radial-gradient(circle at 50% 50%, var(--v-base) 26%, var(--v-sheen) 100%);
  }
  .disc.pressing-halo {
    background-image:
      radial-gradient(circle at 50% 50%, var(--v-base) 26%, var(--v-accent) 48%, var(--v-base) 74%, var(--v-sheen) 100%);
  }
  .disc.pressing-halo::after {
    box-shadow: 0 0 0 1px rgba(255,255,255,.36), 0 0 11px var(--v-sheen), 0 0 24px var(--v-accent);
  }
`;

const DISC = {
  base: '#2c3444',
  accent: '#7f93b8',
  accent2: '#4a5872',
  sheen: '#dfe6f2',
  angle: '30deg',
};

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

  /** 把盘设成某工艺，并可选地注入补全 CSS。 */
  async function setDisc(pressing, patch) {
    await win.webContents.executeJavaScript(`(() => {
      const old = document.getElementById('ab-patch');
      if (old) old.remove();
      if (${patch ? 'true' : 'false'}) {
        const el = document.createElement('style');
        el.id = 'ab-patch';
        el.textContent = ${JSON.stringify(PATCH)};
        document.head.appendChild(el);
      }
      const disc = document.querySelector('.disc');
      const s = disc.style;
      s.setProperty('--v-base', ${JSON.stringify(DISC.base)});
      s.setProperty('--v-accent', ${JSON.stringify(DISC.accent)});
      s.setProperty('--v-accent-2', ${JSON.stringify(DISC.accent2)});
      s.setProperty('--v-sheen', ${JSON.stringify(DISC.sheen)});
      s.setProperty('--v-angle', ${JSON.stringify(DISC.angle)});
      s.setProperty('--v-art', 'none');
      disc.className = 'disc pressing-' + ${JSON.stringify(pressing)};
      return undefined;
    })()`, true);
    await new Promise(r => setTimeout(r, 220));
  }

  const nameOf = pressing => (pressing === 'halo' ? 'halo' : pressing);
  const rows = [];
  for (const pressing of ['swirl', 'splatter', 'halo']) {
    await setDisc(pressing, false);
    const before = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, nameOf(pressing) + '-before.png'), before.toPNG());

    await setDisc(pressing, true);
    const after = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, nameOf(pressing) + '-after.png'), after.toPNG());

    rows.push({ pressing });
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows));
  app.exit(0);
}).catch(error => {
  console.error('PROBE_FAIL ' + (error && error.stack || error));
  app.exit(1);
});
