import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import path from 'node:path';

async function boot(locked: boolean) {
  const events = new Map<string, () => void>(), calls: string[] = [];
  const win = {
    isMinimized: () => true,
    isDestroyed: () => false,
    isVisible: () => true,
    // second-instance 现在要排除小组件窗口，会问这一句
    isAlwaysOnTop: () => false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    // attachFocusMini 会挂 closed 监听
    on: () => undefined,
  };
  const app = { setPath: () => calls.push('isolated-path'), requestSingleInstanceLock: () => { calls.push('lock'); return locked; },
    quit: () => calls.push('quit'), whenReady: () => { calls.push('ready'); return Promise.resolve(); }, on: (key: string, cb: () => void) => events.set(key, cb) };
  class BrowserWindow {
    static getAllWindows() { return [win]; }
    webContents = { setWindowOpenHandler() {}, on() {} };
    constructor() { calls.push('window'); }
    // 主进程现在先隐藏窗口、等 ready-to-show 再显示，这里要提供对应的方法
    once() {}
    isDestroyed() { return false; }
    isVisible() { return true; }
    isAlwaysOnTop() { return false; }
    isMinimized() { return true; }
    restore() { calls.push('restore'); }
    show() { calls.push('show'); }
    focus() { calls.push('focus'); }
    // 主窗口自己会挂 'closed' 把 mainWindow 置空，测「窗口关了再启动」要靠它
    on(key: string, cb: () => void) { if (key === 'closed') events.set('closed', cb); }
    loadFile() {}
  }
  runInNewContext(readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8'), {
    require: (id: string) => id === 'electron' ? {
      app,
      BrowserWindow,
      screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 1000 } }) },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
      // 检查更新的两条通道注册在 whenReady 里，这里只需要能被调用。
      ipcMain: { on: () => undefined },
    }
      : id === 'node:path' ? path
      : id === './now-playing.cjs' ? { attachNowPlaying: () => undefined }
      : id === './focus-mini.cjs' ? { attachFocusMini: () => undefined }
      : id === './desktop-stage.cjs' ? { attachDesktopStage: () => undefined }
      : id === './media.cjs' ? { registerMediaScheme: () => undefined, attachMedia: () => undefined }
      // 这个测试关心的是窗口生命周期，更新检查只要不炸就行。
      : id === './update.cjs' ? { attachUpdate: () => ({ check: async () => ({ status: 'current' }), open: () => false }) }
      : { existsSync: () => false },
    process: { env: { RAVEN_DATA_DIR: 'F:/Vibe/.qa/mock-only' }, platform: 'win32', resourcesPath: 'F:/Vibe/.qa/mock-only' }, __dirname: 'F:/Vibe/electron',
    // 主进程里有个「万一 ready-to-show 不来也要露脸」的兜底定时器，沙箱里没有 setTimeout
    setTimeout: () => 0, clearTimeout: () => undefined,
  });
  await Promise.resolve(); return { events, calls };
}
test('第二个实例在加载窗口和存储之前退出', async () => {
  const { calls } = await boot(false);
  assert.deepEqual(calls, ['isolated-path', 'lock', 'quit']);
});
test('首实例收到重复启动时还原并聚焦已有窗口', async () => {
  const { events, calls } = await boot(true);
  events.get('second-instance')!();
  assert.equal(calls.filter(c => c === 'window').length, 1);
  assert.deepEqual(calls.slice(-3), ['restore', 'show', 'focus']);
});

test('主窗口已经关了，再启动要把主窗口建回来', async () => {
  // 回归测试：原来靠「可见且不是 alwaysOnTop」猜主窗口。但壁纸窗和专注小窗
  // 都不做 alwaysOnTop，猜中的可能是它们——用户点任务栏图标，冒出来的是壁纸窗。
  // 更糟的是只剩壁纸窗时 `show()` 会把它从桌面翻到前台。
  const { events, calls } = await boot(true);
  events.get('second-instance')!();
  const before = calls.filter(c => c === 'window').length;

  // 主窗口关掉（win.on('closed') 会把 mainWindow 置空）
  events.get('closed')?.();
  calls.length = 0;
  events.get('second-instance')!();

  assert.equal(calls.filter(c => c === 'window').length, 1, '要重建主窗口');
  assert.equal(calls.includes('show'), false, '不该去 show 别人的窗口');
  assert.ok(before >= 1);
});
