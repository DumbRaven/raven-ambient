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
    on() {}
    loadFile() {}
  }
  runInNewContext(readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8'), {
    require: (id: string) => id === 'electron' ? { app, BrowserWindow, screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 1000 } }) }, session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } } }
      : id === 'node:path' ? path
      : id === './now-playing.cjs' ? { attachNowPlaying: () => undefined }
      : id === './focus-mini.cjs' ? { attachFocusMini: () => undefined }
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
