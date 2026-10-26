// Package a clean runtime input, without traversing unrelated workspace directories.
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stageRoot = path.join(root, '.qa');
fs.mkdirSync(stageRoot, { recursive: true });
const input = fs.mkdtempSync(path.join(stageRoot, 'package-main-'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
for (const folder of ['dist', 'electron']) fs.cpSync(path.join(root, folder), path.join(input, folder), { recursive: true, errorOnExist: true });
fs.mkdirSync(path.join(input, 'build'));
fs.copyFileSync(path.join(root, 'build/raven-logo.png'), path.join(input, 'build/raven-logo.png'));
// Vite bundles renderer dependencies; the Electron main uses only built-in modules.
const { name, version, description, author, main, type } = pkg;
const build = { ...pkg.build, npmRebuild: false, electronVersion, electronDist: path.join(root, 'node_modules/electron/dist'),
  directories: { output: path.join(root, 'release') },
  extraResources: [{ from: path.join(root, 'build/raven-logo.png'), to: 'raven-logo.png' }],
  win: { ...pkg.build.win, icon: path.join(root, 'build/icon.ico') } };
fs.writeFileSync(path.join(input, 'package.json'), JSON.stringify({ name, version, description, author, main, type, private: true, build }, null, 2), 'utf8');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--projectDir', input, '--win', '--dir'], { cwd: input, windowsHide: true, stdio: 'inherit' });
// 打包用的暂存目录用完即删，避免 .qa 里堆一串 package-main-*
fs.rmSync(input, { recursive: true, force: true });
if (result.error) throw result.error;

// 裁掉这台机器上永远用不到的着色器编译器。
// dxcompiler.dll + dxil.dll 是 Dawn 编译 WebGPU 着色器用的；本程序只用 Canvas 2D 与 CSS 渐变，
// WebGL 走的是另一份 d3dcompiler_47.dll。实测删掉后 Canvas 2D 逐像素一致、WebGL 着色器照常编译。
// 注意不要动 vk_swiftshader.dll / vulkan-1.dll：那是没有显卡或显卡驱动出问题时的软件渲染兜底，
// 省 6 MB 换一个「换台电脑就白屏」的风险不划算。
const outDir = path.join(root, 'release', 'win-unpacked');
for (const name of ['dxcompiler.dll', 'dxil.dll']) {
  const target = path.join(outDir, name);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { force: true });
    console.log('已裁掉', name);
  }
}

process.exitCode = result.status ?? 1;
