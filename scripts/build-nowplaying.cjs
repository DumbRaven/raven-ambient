// 编译 NowPlaying.exe。
// csc 4 对 WinRT 支持不完整（IAsyncOperation 没有 GetAwaiter），所以源码里全是手写回调，不依赖扩展方法。
//
// **这个脚本只在 Windows 上有意义**。macOS 那边的外部音乐走 media-control
// （见 electron/now-playing-mac.cjs），不需要本机编译任何东西。但打包流程是
// 同一条命令，所以这里在非 Windows 上直接放行——否则 mac 上跑打包会在第一步
// 就报「找不到 csc.exe」而中断。
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') {
  console.log('非 Windows 平台，跳过 NowPlaying.exe（macOS 用 media-control）');
  process.exit(0);
}

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const winmd = 'C:\\Windows\\System32\\WinMetadata';
const runtime = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Runtime.dll';
const here = path.join(__dirname, '..', 'electron', 'nowplaying');
const out = path.join(here, 'NowPlaying.exe');

if (!fs.existsSync(csc)) {
  console.error('找不到 csc.exe，这台机器没装 .NET Framework 4？');
  process.exit(1);
}

const refs = [
  path.join(winmd, 'Windows.Media.winmd'),
  path.join(winmd, 'Windows.Foundation.winmd'),
  path.join(winmd, 'Windows.Storage.winmd'),
  path.join(winmd, 'Windows.ApplicationModel.winmd'),
  runtime,
].filter((p) => fs.existsSync(p));

const args = ['/nologo', '/target:exe', `/out:${out}`, ...refs.map((p) => `/r:${p}`), path.join(here, 'NowPlaying.cs')];

try {
  execFileSync(csc, args, { stdio: 'inherit' });
  console.log('已生成', out, fs.statSync(out).size, '字节');
} catch (error) {
  console.error('编译失败');
  process.exit(1);
}
