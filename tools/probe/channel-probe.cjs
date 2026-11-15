/**
 * 验证 preload 通道真的通。
 *
 * 单测只能验白名单这个纯函数；「页面里 window.raven 到底有没有被暴露出来」、
 * 「发出去主进程能不能收到」、「主进程推回来能不能到页面」这些
 * 只有真跑一次才算数。
 *
 * **不能用 harness.launch()**：它自己 new BrowserWindow、自己写 webPreferences，
 * 里面没有 preload 那一项 —— 拿它验通道等于什么都没验（而且每个
 * `window.raven` 都是 undefined，第一步就炸）。这里照 main.cjs 的窗口配置
 * 复刻一份，只多了截图用的尺寸与离屏参数。
 *
 * 每一步都单独 try/catch：通道一处不通，后面每一步都会跟着报同样的错，
 * 全放在一个 try 里只能看到第一个异常，定位不到是哪一步。
 */
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
const { allowDir, allowFile, attachMedia } = require('../../electron/media.cjs');
const harness = require('./harness.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const wait = ms => new Promise(done => setTimeout(done, ms));

app.on('window-all-closed', () => {});

const report = {};
const step = async (name, run) => {
  try {
    report[name] = await run();
  } catch (error) {
    report[name] = { failed: String((error && error.message) || error) };
  }
};

app.whenReady().then(async () => {
  allowDir(harness.MEDIA_DIR);
  allowFile(harness.MEDIA_IMG);
  attachMedia();

  const win = new BrowserWindow({
    width: 680,
    height: 980,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
      // 就是这一行要验的东西：main.cjs 里配了它，这里照抄。
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
    },
  });

  win.webContents.on('preload-error', (_event, file, error) => {
    report.preloadError = { file, message: String((error && error.message) || error) };
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) (report.console ||= []).push(message.slice(0, 200));
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await wait(5200);

  const run = code => win.webContents.executeJavaScript(code, true);

  // 1) preload 有没有把 raven 挂上去，以及有没有顺手把别的也漏出去
  await step('channel', () => run(`(() => {
    const ch = window.raven;
    if (!ch) return { present: false };
    return {
      present: true,
      send: typeof ch.send,
      on: typeof ch.on,
      // 这些都是不该出现在页面里的：有任何一个不是 undefined，沙箱就白设了
      leaks: {
        ipcRenderer: typeof window.ipcRenderer,
        require: typeof window.require,
        process: typeof window.process,
        Buffer: typeof window.Buffer,
      },
    };
  })()`));

  // 2) 白名单真的在拦
  await step('rejectUnknown', () => run(`window.raven.send('electron:steal', { evil: true })`));
  await step('acceptKnown', () => run(`window.raven.send('media:request', { type: 'ping' })`));

  // 3) 收的方向
  await step('subscribe', () => run(`(() => {
    window.__probeGot = [];
    window.__probeOff = window.raven.on('media:message', payload => window.__probeGot.push(payload));
    return typeof window.__probeOff;
  })()`));
  await step('pushOne', async () => {
    win.webContents.send('media:message', { type: 'ready', dirs: ['C:/probe-a'] });
    await wait(200);
    return run(`window.__probeGot`);
  });

  // 4) 取消订阅之后不该再收到
  await step('afterOff', async () => {
    await run(`window.__probeOff && window.__probeOff()`);
    win.webContents.send('media:message', { type: 'ready', dirs: ['C:/probe-b'] });
    await wait(200);
    return run(`window.__probeGot`);
  });

  // 5) 收的方向也有白名单
  await step('badChannel', async () => {
    await run(`(() => { window.__probeBad = []; window.raven.on('electron:steal', p => window.__probeBad.push(p)); return true; })()`);
    win.webContents.send('electron:steal', { evil: true });
    await wait(200);
    return run(`window.__probeBad`);
  });

  // 6) 真实链路：页面发 ping，主进程回 ready，而且回的这条能到页面。
  await step('pingRoundTrip', async () => {
    await run(`(() => {
      window.__probeGot.length = 0;
      window.__probeGot = [];
      window.__round = [];
      window.raven.on('media:message', p => window.__round.push(p.type));
      window.raven.send('media:request', { type: 'ping' });
      return true;
    })()`);
    await wait(500);
    return run(`window.__round`);
  });

  console.log('@@JSON@@' + JSON.stringify(report, null, 2));

  win.destroy();
  process.exit(0);
});
