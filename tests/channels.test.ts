import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 白名单是渲染进程与主进程之间唯一的边界，而它在 electron/preload.cjs 里。
 *
 * 为什么不用 require 直接引进来：preload 一加载就 `require('electron')`，
 * 纯 node 下起不来；而且沙箱 preload 里 chain 白名单**不能拆到单独文件**
 * （受限的 require 不认相对路径，见 preload.cjs 顶部的 ⚠）。
 * 所以这里读源码、用正则抽集合——目的是让「有人顺手加了个通道」在 diff 里显形，
 * 而不是覆盖分支。
 */
const source = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');

/** 从 `const NAME = new Set([ ... ]);` 里抽出字符串字面量。 */
function names(constant: string): string[] {
  const block = source.match(new RegExp(`const ${constant} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(block, `$preload.cjs 里找不到 ${constant} 的定义`);
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
}

const SEND = names('SEND');
const RECEIVE = names('RECEIVE');

test('页面能发的通道：九个，一个不多', () => {
  // 检查更新占两条：update:check 发「请你查一下」，update:open 发「去下载」。
  // 后者不带参数——要打开的地址由主进程自己缓存，页面给的一律丢掉。
  //
  // mac 系统音频也占两条：tap:start / tap:stop。Windows 上不存在这一对——
  // 那边页面自己 getUserMedia 拿虚拟声卡，不需要主进程帮忙。
  assert.deepEqual(SEND, [
    'focus:action',
    'media:request',
    'now:action',
    'stage:command',
    'stage:snapshot',
    'tap:start',
    'tap:stop',
    'update:check',
    'update:open',
  ]);
});

test('主进程能推的通道：九个，一个不多', () => {
  assert.deepEqual(RECEIVE, [
    'focus:press',
    'focus:snapshot',
    'media:message',
    'now:snapshot',
    'stage:closed',
    'stage:paint',
    'stage:press',
    'tap:chunk',
    'update:result',
  ]);
});

test('收和发是两份名单，互不通用', () => {
  // 一条通道两个方向都能用，意味着页面能自己伪造一条「主进程推来的消息」。
  //
  // 这条曾经把一个真 bug 固化下来：`stage:command` / `focus:action` 原本是
  // 双向同名的，主进程往回推时被 RECEIVE 白名单拒掉，桌面窗上的切歌、小窗上的
  // 暂停全都是静默丢弃。改法不是放宽这条断言，而是把回传方向改名为
  // `stage:press` / `focus:press` —— 见 preload.cjs 里 RECEIVE 上方的 ⚠。
  for (const channel of SEND) {
    assert.equal(RECEIVE.includes(channel), false, `${channel} 同时出现在收发两侧`);
  }
});

test('两条转发通道的收发名字必须成对存在，不许只剩一半', () => {
  // 只改一侧就会退回「点一次跳两首」或者「点了没反应」，两种都很隐蔽。
  const pairs = [['stage:command', 'stage:press'], ['focus:action', 'focus:press']];
  for (const [out, back] of pairs) {
    assert.ok(SEND.includes(out), `页面发不出去 ${out}`);
    assert.ok(RECEIVE.includes(back), `页面收不到 ${back}`);
  }
});

test('白名单判定在 send / on 的第一行，不是靠调用方自觉', () => {
  // 形状断言：两个方法都必须先查 Set 再动 ipcRenderer。
  // 如果哪天有人把判断挪到 ipcRenderer.send 之后，这里会红。
  const send = source.match(/send\(channel, payload\) \{([\s\S]*?)\n {2}\},/);
  assert.ok(send, '找不到 send 的实现');
  assert.match(send[1], /SEND\.has\(channel\)/, 'send 没有先查白名单');
  assert.ok(send[1].indexOf('SEND.has') < send[1].indexOf('ipcRenderer.send'), 'send 是先发后查');

  const on = source.match(/on\(channel, handler\) \{([\s\S]*?)\n {2}\},/);
  assert.ok(on, '找不到 on 的实现');
  assert.match(on[1], /RECEIVE\.has\(channel\)/, 'on 没有先查白名单');
  assert.ok(on[1].indexOf('RECEIVE.has') < on[1].indexOf('ipcRenderer.on'), 'on 是先挂后查');
});

test('不往页面漏任何 Node 能力', () => {
  // 只暴露 contextBridge，不碰 window.*
  assert.equal(source.includes("exposeInMainWorld('raven'"), true);

  // 交给页面的对象只能有 send / on 两个成员。
  // 判据是「暴露块的顶层键」，不是在全文里搜 ipcRenderer ——
  // 文件顶部本来就要 import 它，全文搜会把 import 当成泄漏（这里踩过）。
  const exposed = source.match(/exposeInMainWorld\('raven', \{([\s\S]*?)\n\}\);/);
  assert.ok(exposed, '找不到 exposeInMainWorld 的内容');
  const body = exposed[1];
  const keys = [...body.matchAll(/^ {2}(\w+)\(/gm)].map(m => m[1]);
  assert.deepEqual(keys.sort(), ['on', 'send'], `暴露了多余的成员：${keys.join(', ')}`);

  // 沙箱 preload 里不许有相对路径 require（会 module not found，且页面侧毫无线索）。
  // 先去掉注释再找——注释里正好提到 `require('./channels.cjs')` 这个反面例子。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const requires = [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
  assert.deepEqual(requires, ['electron'], 'preload 里出现了 electron 之外的 require');
});

test('取消订阅不能把 ipcRenderer 漏回页面', () => {
  // EventEmitter 的 removeListener 返回 `this`，也就是 ipcRenderer 本身。
  // 早期写成 `return () => ipcRenderer.removeListener(...)`，contextBridge 会把这个
  // 返回值代理给页面 —— `const x = off(); x.send('electron:steal', ...)` 就绕过白名单了。
  // 真机验证时表现为 `Error: An object could not be cloned`（代理不了 EventEmitter）。
  assert.equal(
    /return\s*\(\)\s*=>\s*ipcRenderer\.removeListener\(/.test(source),
    false,
    '取消函数把 ipcRenderer 的返回值漏出去了',
  );
  // 正确的形状：箭头函数体是块，里面只调用、不返回。
  assert.match(source, /return \(\) => \{\s*\n\s*ipcRenderer\.removeListener\(/, '取消函数应当是块体，不返回值');
});

test('通道名里没有空串或纯空白，都带方向前缀', () => {
  for (const channel of [...SEND, ...RECEIVE]) {
    assert.equal(channel, channel.trim());
    assert.equal(channel.includes(' '), false);
    assert.ok(channel.includes(':'), `${channel} 缺少方向前缀`);
  }
});

test('主进程的转发监听在模块级只注册一次，不能跟着窗口重建再挂一遍', () => {
  // createWindow() 每次都会调 attachFocusMini / attachDesktopStage，而主窗口
  // 是可以销毁后重建的（second-instance 的 !mainWindow 分支、macOS 的 activate）。
  // 监听器注册若留在那两个函数里，同一条通道会累积出两个监听器，
  // 表现为一次切歌跳两首、一次暂停被 toggle 两下——而通道改名修好之后
  // 这个缺陷就会立刻显形，所以两条必须一起守。
  const dir = new URL('../electron/', import.meta.url);
  for (const [file, handlers] of [
    ['focus-mini.cjs', ['focus:action']],
    ['desktop-stage.cjs', ['stage:command', 'stage:snapshot']],
  ]) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    const rows = text.split('\n');
    for (const channel of handlers) {
      const line = rows.findIndex(row => row.includes(`ipcMain.on('${channel}'`));
      assert.ok(line >= 0, `${file} 里找不到 ${channel} 的监听`);
      // 判据：注册行必须出现在 attach 函数定义**之前**（模块级），
      // 出现在它之后就只有一种可能——被包进了那个每次 createWindow() 都会调的函数。
      // 不直接用「必须顶格」是因为注册可以合理地包在 `if (ipcMain) {}` 里
      // （纯 node 测试直接 require 这个模块时 ipcMain 是 undefined）。
      const attach = rows.findIndex(row => row.startsWith('function attach'));
      assert.ok(attach > 0, `${file} 里找不到 attach 函数`);
      assert.equal(
        line < attach,
        true,
        `${file} 的 ${channel} 监听被放进了 attach 函数，窗口重建会重复注册`,
      );
    }
  }
});
