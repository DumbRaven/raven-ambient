/**
 * 在 macOS 上抓一张主窗口的截图，用来远程核对界面。
 *
 * 为什么不用 `screencapture`：它走 TCC 的 Screen Recording 权限，而
 * 给 sshd 授权需要人手动去 System Settings 点，SSH 这边永远拿不到
 * （`could not create image from display`）。Electron 的 `capturePage()`
 * 抓的是自己的渲染结果，不经过那套权限，所以能跑。
 *
 * 为什么不复用 `tools/probe/harness.cjs`：它要在 `/tmp` 下用 ffmpeg 现造
 * 假媒体素材（假封面 PNG + 假音频 m4a），而 Mac 上没装 ffmpeg、
 * 也不该为一个预览去装。这个脚本只开真实窗口、不注入任何数据。
 *
 * 用法（Mac 上）：
 *   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     tools/probe/mac-shot.cjs
 *
 * 输出：`<repo>/.qa/mac/<name>.png`，名字可以用 `SHOT_NAME` 覆盖。
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.qa', 'mac');
const NAME = process.env.SHOT_NAME || 'main';
const WAIT = Number(process.env.SHOT_WAIT || 2600);

// userData 指到临时目录：别把用户真实的唱片柜读进来，也别写脏它。
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mac-shot-')));

app.disableHardwareAcceleration();

(async () => {
  await app.whenReady();

  const win = new BrowserWindow({
    width: Number(process.env.SHOT_WIDTH || 680),
    height: Number(process.env.SHOT_HEIGHT || 980),
    // 量界面要用内容区尺寸。不给这个，980 会算上标题栏，内容区只剩 948，
    // 与 Windows 基线（680×980 内容区）比就会凭空少 32px。
    useContentSize: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 窗口不 show 时 Chromium 会把 rAF 与 CSS 动画压到几乎不推进，
      // 于是 index.html 里的开屏动画永远走不完、`dismissSplash()` 等不到
      // 那批 `splash-*` 动画的 finished，截图就卡在开屏上（第一版正是这样）。
      backgroundThrottling: false,
      // 真实主窗口用的就是这份 preload；不挂它，页面里所有走 IPC 的功能都会静默失败
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
    },
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, WAIT));

  // 开屏靠 CSS 动画自己走完才撤，而离屏窗口上动画推进不可靠（实测两次截图
  // 都是同一张开屏图、字节数一模一样）。这里只是抓图核对界面，直接摘掉它——
  // 不要把这个当成产品行为，产品里由 `src/splash.ts` 决定何时撤。
  await win.webContents.executeJavaScript(
    "document.getElementById('splash')?.remove(); undefined;",
  );
  await new Promise((resolve) => setTimeout(resolve, 600));

  // 可选：切到某个页签再截。传的是按钮上的中文名（唱片柜/正在听/专注/相集）。
  const view = process.env.SHOT_VIEW;
  if (view) {
    const hit = await win.webContents.executeJavaScript(`
      (() => {
        const button = [...document.querySelectorAll('button')]
          .find((node) => node.textContent.trim() === ${JSON.stringify(view)});
        if (!button) return 'MISS';
        button.click();
        return 'OK';
      })()
    `);
    if (hit !== 'OK') {
      console.error(`PROBE_FAIL 找不到页签 ${view}`);
      app.exit(1);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.SHOT_SETTLE || 1800)));
  }

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${NAME}.png`);

  // 离屏窗口上 capturePage() 偶尔返回 0 字节（Windows 上踩过），
  // 退一步从 nativeImage 取 PNG。
  const image = await win.webContents.capturePage();
  const buffer = image.isEmpty() ? null : image.toPNG();
  if (!buffer || buffer.length === 0) {
    console.error('PROBE_FAIL 截图是空的');
    app.exit(1);
    return;
  }

  fs.writeFileSync(file, buffer);
  console.log(`PROBE_OK ${file} ${buffer.length} bytes`);
  app.exit(0);
})().catch((error) => {
  console.error(`PROBE_FAIL ${error.message}`);
  app.exit(1);
});
