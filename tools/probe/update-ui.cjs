/**
 * 设置面板「版本」那一组的渲染探针。
 *
 * 验四件事：
 *   1. 探针环境下（没有 preload）不显示版本号、也不显示「—」，只有按钮
 *   2. 注入一个带 preload 形状的 window.raven 之后，点检查更新能走到「有新版本」
 *   3. 有新版本时出现「去下载」按钮
 *   4. 底部那行版本文字用的是主进程给的版本号，不是写死的
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/update-ui.cjs --no-sandbox
 *
 * ⚠ 必须用可见窗口：离屏窗口的 `capturePage()` 返回 0 字节（实测）。
 * 输出 `.qa/update-ui/*.png`。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '.qa/update-ui');
fs.mkdirSync(OUT, { recursive: true });

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'probe-update-')));

/** 读设置面板里「版本」那一组的实际文字与按钮。 */
const READ = `(() => {
  const groups = [...document.querySelectorAll('.settings-group')];
  const group = groups.find(g => (g.querySelector('h3')?.textContent || '').trim() === '版本');
  if (!group) return { found: false };
  const p = group.querySelector('p:not(.update-note)');
  const button = group.querySelector('button');
  const help = document.querySelector('.import-help');
  return {
    found: true,
    text: (p?.textContent || '').trim(),
    note: ((group.querySelector('.update-note')?.textContent) || '').trim(),
    noteHeight: Math.round(group.querySelector('.update-note')?.getBoundingClientRect().height || 0),
    button: (button?.textContent || '').trim(),
    buttonDisabled: !!button?.disabled,
    buttonHeight: Math.round(button?.getBoundingClientRect().height || 0),
    spinning: !!group.querySelector('.loading-spin'),
    help: (help?.textContent || '').trim().replace(/\\s+/g, ' '),
    box: (() => { const r = group.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })(),
  };
})();`;

/** 点开设置面板。主界面的齿轮按钮。 */
const OPEN = `(() => {
  const buttons = [...document.querySelectorAll('button')];
  const gear = buttons.find(b => (b.getAttribute('aria-label') || '').includes('设置'));
  if (gear) gear.click();
  return !!gear;
})();`;

/** 装一个假的 preload 桥：让 checkForUpdate 立刻拿到「有新版本」。 */
const FAKE_BRIDGE = verbose => `(() => {
  const handlers = new Map();
  window.raven = {
    send(channel, payload) {
      if (channel === 'update:check') {
        setTimeout(() => {
          const h = handlers.get('update:result');
          if (h) h({ current: '0.3.3', result: {
            status: 'newer', version: '0.4.0',
            notes: '测试用更新说明',
            url: 'https://example.invalid/test.zip',
          }});
        }, 60);
        return true;
      }
      if (channel === 'update:open') { window.__opened = true; return true; }
      return false;
    },
    on(channel, handler) {
      handlers.set(channel, handler);
      return () => { if (handlers.get(channel) === handler) handlers.delete(channel); };
    },
  };
  return ${verbose ? "'installed'" : 'undefined'};
})();`;

/** 主进程给的版本号（模拟 preload 回包里的 current）。 */
const INJECT_VERSION = `(() => {
  const handlers = new Map();
  window.raven = {
    send(channel) {
      if (channel === 'update:check') {
        setTimeout(() => {
          const h = handlers.get('update:result');
          if (h) h({ current: '0.4.2', result: { status: 'current' } });
        }, 60);
        return true;
      }
      return false;
    },
    on(channel, handler) {
      handlers.set(channel, handler);
      return () => { if (handlers.get(channel) === handler) handlers.delete(channel); };
    },
  };
})();`;

/**
 * 慢速桥：延迟若干毫秒才回一个指定结局。
 *
 * 为什么需要它：「正在检查…」这个中间态只在等待期间存在，回得太快就量不到，
 * 而按钮会不会在中间变字/变灰正是这次要验的东西。
 */
const slowBridge = (result, delay) => `(() => {
  const handlers = new Map();
  window.raven = {
    send(channel) {
      if (channel === 'update:check') {
        setTimeout(() => {
          const h = handlers.get('update:result');
          if (h) h({ current: '0.4.2', result: ${JSON.stringify(result)} });
        }, ${delay});
        return true;
      }
      return false;
    },
    on(channel, handler) {
      handlers.set(channel, handler);
      return () => { if (handlers.get(channel) === handler) handlers.delete(channel); };
    },
  };
})();`;

/** 把弹窗滚到底：「版本」那一组在滚动区之外，不滚就截不到。 */
const SCROLL_END = `(() => {
  const dialog = document.querySelector('dialog[open]');
  const scroller = document.querySelector('.modal-content') || dialog;
  if (dialog) dialog.scrollTop = dialog.scrollHeight;
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
  return { dialog: dialog ? dialog.scrollHeight : 0, content: scroller ? scroller.scrollHeight : 0 };
})();`;

/** 点设置面板自己的关闭按钮（走 React，才会真的卸载组件、下次重挂时重跑 effect）。 */
const CLOSE = `(() => {
  const x = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '关闭窗口');
  if (!x) return false;
  x.click();
  return true;
})();`;

/** 点设置面板里「版本」那一组的按钮。 */
const CLICK_CHECK = `(() => {
  const groups = [...document.querySelectorAll('.settings-group')];
  const group = groups.find(g => (g.querySelector('h3')?.textContent || '').trim() === '版本');
  const button = group?.querySelector('button');
  if (!button) return null;
  const before = { text: button.textContent.trim(), disabled: button.disabled, height: Math.round(button.getBoundingClientRect().height) };
  button.click();
  return before;
})();`;

/**
 * 截图。走 CDP 而不是 `webContents.capturePage()`——后者在本机这个 Electron 版本
 * 上无论窗口可见与否都返回 0 字节（实测两次），CDP 的 `Page.captureScreenshot` 稳定。
 */
let dbgReady = false;
async function shot(win, name, box) {
  const dbg = win.webContents.debugger;
  if (!dbgReady) { dbg.attach('1.3'); dbgReady = true; }
  // 整页截，不传 clip：clip 只截可见区域，而「版本」那一组在弹窗滚到底才看得见，
  // 传了它只会得到一张空白图（踩过）。
  const { data } = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) throw new Error('CDP 截图为空：' + name);
  fs.writeFileSync(path.join(OUT, name + '.png'), buf);
  if (box && box.width > 0) fs.writeFileSync(path.join(OUT, name + '.box.json'), JSON.stringify(box));
  return buf.length;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 680,
    height: 1000,
    show: true,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(ROOT, 'dist/index.html'));
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const fail = [];
  const log = (...a) => console.log(...a);

  // ---- 情形一：没有 preload（探针默认环境）----
  await run(OPEN);
  await wait(900);
  await run(SCROLL_END);
  await wait(200);
  const bare = await run(READ);
  log('情形一 无 preload :', JSON.stringify({ text: bare.text, button: bare.button, help: bare.help }));
  await shot(win, '1-bare');

  if (!bare.found) fail.push('找不到「版本」这一组');
  if (bare.text !== '') fail.push(`无 preload 时不该有文字，实际是「${bare.text}」`);
  if (bare.button !== '检查更新') fail.push(`按钮该是「检查更新」，实际是「${bare.button}」`);
  if (/0\.3\.3/.test(bare.help)) fail.push('底部仍写死 0.3.3');
  if (/[\d.]+\s*$/.test(bare.help) && /Raven Ambient ·/.test(bare.help)) {
    fail.push('无 preload 时底部不该出现版本号：' + bare.help);
  }

  // ---- 情形二：主进程给了版本号、已是最新 ----
  await run(CLOSE);
  await wait(500);
  await run(INJECT_VERSION);
  await run(OPEN);
  await wait(900);
  await run(SCROLL_END);
  await wait(200);
  const current = await run(READ);
  log('情形二 已是最新  :', JSON.stringify({ text: current.text, button: current.button, help: current.help }));
  await shot(win, '2-current');
  if (current.button !== '检查更新') fail.push('已是最新时按钮该是「检查更新」');
  if (!/0\.4\.2/.test(current.help)) fail.push(`底部版本号该是 0.4.2，实际是「${current.help}」`);

  // ---- 情形三：有新版本 ----
  await run(CLOSE);
  await wait(500);
  await run(FAKE_BRIDGE(true));
  await run(OPEN);
  await wait(1200);
  await run(SCROLL_END);
  await wait(200);
  const newer = await run(READ);
  log('情形三 有新版本  :', JSON.stringify({ text: newer.text, button: newer.button, help: newer.help }));
  await shot(win, '3-newer', newer.box.width > 0 ? newer.box : undefined);
  if (!/0\.4\.0/.test(newer.text)) fail.push(`该显示新版 0.4.0，实际「${newer.text}」`);
  if (newer.button !== '去下载') fail.push(`该出现「去下载」，实际「${newer.button}」`);

  // 点「去下载」，应当只发 update:open、不传 URL
  await run(`(() => {
    const groups = [...document.querySelectorAll('.settings-group')];
    const group = groups.find(g => (g.querySelector('h3')?.textContent || '').trim() === '版本');
    group.querySelector('button')?.click();
  })();`);
  await wait(300);
  const opened = await run('!!window.__opened');
  log('点去下载 → 发出 update:open :', opened);
  if (!opened) fail.push('点「去下载」没有发出 update:open');

  // ---- 情形四：手动点击「检查更新」，结局是「已是最新」 ----
  //
  // 验的是 2026-11-18 用户报的那个问题：点一下只抖了抖，什么都没说。
  // 三条断言：等待期间按钮不变字不变灰；等完出现「已经是最新版本」；按钮高度全程不变。
  await run(CLOSE);
  await wait(500);
  await run(slowBridge({ status: 'current' }, 700));
  await run(OPEN);
  await wait(1200);
  await run(SCROLL_END);
  await wait(200);
  const beforeCurrent = await run(READ);
  await run(CLICK_CHECK);
  await wait(250); // 还在等待期
  const duringCurrent = await run(READ);
  await shot(win, '4-current-waiting');
  await wait(900); // 等回包
  const afterCurrent = await run(READ);
  log('情形四 手动/已是最新:', JSON.stringify({ during: duringCurrent.note, note: afterCurrent.note, button: afterCurrent.button, h: afterCurrent.buttonHeight }));
  await shot(win, '5-current-done');
  if (duringCurrent.button !== '检查更新') fail.push(`等待期间按钮不该换字，实际「${duringCurrent.button}」`);
  if (duringCurrent.buttonDisabled) fail.push('等待期间按钮不该禁用（全局 disabled 会让它变淡）');
  if (!duringCurrent.note) fail.push('等待期间 `.update-note` 该有「正在检查…」');
  if (afterCurrent.note !== '已经是最新版本。') fail.push(`点完该说「已经是最新版本。」，实际「${afterCurrent.note}」`);
  if (afterCurrent.button !== beforeCurrent.button) fail.push('点完按钮文字变了');
  if (afterCurrent.buttonHeight !== beforeCurrent.buttonHeight) fail.push(`按钮高度变了：${beforeCurrent.buttonHeight} → ${afterCurrent.buttonHeight}`);
  if (!afterCurrent.noteHeight) fail.push('结论行高度为 0，说明它没占位（会出现上下位移）');

  // ---- 情形五：手动点击，结局是「没能查到」 ----
  await run(CLOSE);
  await wait(500);
  await run(slowBridge({ status: 'unknown', reason: 'timeout' }, 700));
  await run(OPEN);
  await wait(1200);
  await run(SCROLL_END);
  await wait(200);
  await run(CLICK_CHECK);
  await wait(1100);
  const afterUnknown = await run(READ);
  log('情形五 手动/查不到  :', JSON.stringify({ note: afterUnknown.note, button: afterUnknown.button }));
  await shot(win, '6-unknown-done');
  if (afterUnknown.note !== '没能查到，稍后再试。') fail.push(`查不到时该说「没能查到，稍后再试。」，实际「${afterUnknown.note}」`);
  if (afterUnknown.button !== '检查更新') fail.push('查不到时按钮该仍是「检查更新」');

  log('');
  if (fail.length) {
    console.log('PROBE_FAIL');
    fail.forEach(f => console.log('  -', f));
    app.exit(1); return;
  }
  console.log('PROBE_OK');
  app.exit(0);
}).catch((error) => {
  console.log('PROBE_FAIL 抛错:', error && error.message);
  app.exit(1);
});
