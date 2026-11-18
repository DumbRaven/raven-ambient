/**
 * 检查更新的真链路端到端探针：preload 白名单 → IPC → 主进程 → GitHub。
 *
 * 为什么必须单独一个：
 *   - `update-check.cjs` 只测了主进程那个函数，绕过了 IPC；
 *   - `update-ui.cjs` 用的是**假的** window.raven，绕过了 preload 白名单。
 *   中间这两层恰恰是最容易错的（通道名打错一个字就永远收不到回包，
 *   而界面上表现为「点了没反应」，没有任何报错）。
 *
 * 这个探针装真的 preload、注册真的 ipcMain handler，走的和打包后完全同一条路。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/update-e2e.cjs --no-sandbox
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '.qa/update-e2e');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'probe-e2e-')));

const { attachUpdate } = require(path.join(ROOT, 'electron/update.cjs'));

/** 和 electron/main.cjs 里注册的逐字一致（除了版本号用假的，好触发「有新版本」）。 */
function wire(version) {
  const update = attachUpdate();
  ipcMain.on('update:check', async (event) => {
    const current = version;
    const result = await update.check(current);
    if (!event.sender.isDestroyed()) event.sender.send('update:result', { current, result });
  });
  ipcMain.on('update:open', () => { update.open(); });
}

app.whenReady().then(async () => {
  const fail = [];
  const log = (...a) => console.log(...a);

  // 用 0.3.2 而不是真实版本：线上最新是 0.3.3，这样一定能走到「有新版本」那条分支，
  // 而那条分支才会把下载地址缓存下来给 update:open 用。
  wire('0.3.2');

  const win = new BrowserWindow({
    width: 680,
    height: 1000,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(ROOT, 'electron/preload.cjs'),
    },
  });
  await win.loadFile(path.join(ROOT, 'dist/index.html'));
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // 1. preload 真的挂上了吗
  const bridge = await run(`({
    has: !!window.raven,
    keys: window.raven ? Object.keys(window.raven) : [],
    sendIsFn: typeof window.raven?.send === 'function',
    onIsFn: typeof window.raven?.on === 'function',
  })`);
  log('1. preload 桥 :', JSON.stringify(bridge));
  if (!bridge.has) fail.push('window.raven 没挂上（preload 没加载）');
  if (bridge.keys.sort().join(',') !== 'on,send') fail.push('暴露的成员不是只有 send/on：' + bridge.keys.join(','));
  // 沙箱里不该看到任何 Node 能力
  const leak = await run(`({
    req: typeof window.require,
    proc: typeof window.process,
    buf: typeof window.Buffer,
  })`);
  log('   泄漏检查   :', JSON.stringify(leak));
  if (leak.req !== 'undefined' || leak.proc !== 'undefined' || leak.buf !== 'undefined') {
    fail.push('页面里能摸到 Node 能力：' + JSON.stringify(leak));
  }

  // 2. 白名单：不在名单里的通道必须被拒（返回 false）
  const gate = await run(`({
    bad: window.raven.send('electron:steal', null),
    good: window.raven.send('update:check', null),
  })`);
  log('2. 白名单     :', JSON.stringify(gate));
  if (gate.bad !== false) fail.push('不在白名单的通道没有被拒');
  if (gate.good !== true) fail.push('update:check 被拒了（preload 白名单忘了加？）');

  // 3. 等真正的回包（第 2 步已经发过一次 update:check）
  const got = await run(`new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 8000);
    const off = window.raven.on('update:result', (payload) => {
      clearTimeout(timer); off(); resolve(payload);
    });
    // 再发一次，确保这次订阅之后有回包
    window.raven.send('update:check', null);
  })`);
  log('3. 真实回包   :', JSON.stringify(got));
  if (got.timeout) fail.push('8 秒内没收到 update:result');
  if (got && got.result && got.result.status === 'unknown') {
    fail.push('查询失败：' + got.result.reason);
  }
  if (got && typeof got.current !== 'string') fail.push('回包里没有 current 版本号');

  // 4. 页面侧的 checkForUpdate（走的是 src/update-bridge.ts 编译后的那份）
  //    这里直接调它，验的是「桥模块自己也对」。
  const viaBridge = await run(`(async () => {
    // 从打包后的模块里拿不到具名导出，所以用界面上的按钮来驱动一次，
    // 再比对面板文字——这条路径和用户实际点的完全一样。
    const buttons = [...document.querySelectorAll('button')];
    const gear = buttons.find(b => (b.getAttribute('aria-label') || '').includes('设置'));
    gear?.click();
    return !!gear;
  })()`);
  await wait(1500);
  const panel = await run(`(() => {
    const groups = [...document.querySelectorAll('.settings-group')];
    const group = groups.find(g => (g.querySelector('h3')?.textContent || '').trim() === '版本');
    const help = document.querySelector('.import-help');
    return {
      text: (group?.querySelector('p')?.textContent || '').trim(),
      button: (group?.querySelector('button')?.textContent || '').trim(),
      help: (help?.textContent || '').trim().replace(/\\s+/g, ' '),
    };
  })()`);
  log('4. 面板文字   :', JSON.stringify(panel));
  if (viaBridge !== true) fail.push('点不到设置按钮');
  if (!/新版/.test(panel.text)) fail.push(`面板该显示「新版 x 可以下载了」，实际「${panel.text}」`);
  if (panel.button !== '去下载') fail.push(`按钮该是「去下载」，实际「${panel.button}」`);
  if (!/0\.3\.2/.test(panel.help)) fail.push(`底部版本号该是 0.3.2，实际「${panel.help}」`);

  // 5. 点「去下载」：真主进程会走 shell.openExternal。这里只验通道通不通，
  //    不能让探针真的拉起浏览器（那会打断人）。所以换一个只记标志的 handler。
  //    注意：上面 wire() 注册的监听还在，为验证「update:open 能到主进程」，
  //    直接在这里再听一次同一个通道即可（ipcMain 允许同通道多个监听）。
  let opened = false;
  ipcMain.once('update:open', () => { opened = true; });
  await run(`(() => {
    const groups = [...document.querySelectorAll('.settings-group')];
    const group = groups.find(g => (g.querySelector('h3')?.textContent || '').trim() === '版本');
    group?.querySelector('button')?.click();
  })()`);
  await wait(400);
  log('5. update:open 到达主进程 :', opened);
  if (!opened) fail.push('点「去下载」没有到达主进程');

  log('');
  if (fail.length) {
    console.log('PROBE_FAIL');
    fail.forEach(f => console.log('  -', f));
    app.exit(1); return;
  }
  console.log('PROBE_OK');
  app.exit(0);
}).catch((error) => {
  console.log('PROBE_FAIL 抛错:', error && error.stack);
  app.exit(1);
});
