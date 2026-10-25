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
process.exitCode = result.status ?? 1;
