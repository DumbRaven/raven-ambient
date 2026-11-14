// Package a clean runtime input, without traversing unrelated workspace directories.
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stageRoot = path.join(root, '.qa');
fs.mkdirSync(stageRoot, { recursive: true });

// 产物固定落在 release/win-unpacked。
// 这里有一处 Windows 特有的坑：electron-builder 清空输出目录时会 unlink resources/app.asar，
// 而只要有任何进程还持有这个文件的句柄（IDE 索引、杀软扫描、上一次没退干净的 electron、
// 甚至本仓库自己的探针宿主），unlink 就会返回 EBUSY 并让整个打包中止：
//   ⨯ EBUSY: resource busy or locked, unlink '...\release\win-unpacked\resources\app.asar'
// 关键事实是：**unlink 不行，但 truncate 覆盖写入可以**。所以被占住时改打到 .qa 下的临时
// 输出目录，再把产物同步回 release/win-unpacked——同名文件用覆盖写入，避开 unlink。
const outDir = path.join(root, 'release', 'win-unpacked');
const asarPath = path.join(outDir, 'resources', 'app.asar');

// 用「能否改名」判断能否被替换：能改名说明没有进程以独占方式持有它，也就等价于能删。
// 比试着删一下再恢复安全——删失败是必然的，恢复却可能失败，把产物文件弄丢。
function canReplaceFile(file) {
  if (!fs.existsSync(file)) return true;
  const probe = `${file}.lock-probe`;
  try {
    fs.renameSync(file, probe);
  } catch {
    return false;
  }
  try {
    fs.renameSync(probe, file);
  } catch (error) {
    throw new Error(`锁检测后还原失败，请检查 ${file} 与 ${probe}：${error.message}`);
  }
  return true;
}

// 把临时输出同步进正式目录。src 里有的一律覆盖写（copyFileSync 默认 truncate），
// src 里没有的旧文件删掉，避免上一版残留（比如已经裁掉的 dll 又被旧包带回来）。
function syncInto(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name), to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      syncInto(from, to);
      continue;
    }
    try {
      fs.copyFileSync(from, to);
    } catch (error) {
      // 覆盖都写不进去，说明这个文件真的动不了；明确报错，不要留下半旧半新的产物。
      throw new Error(`同步产物失败：${to}（${error.code}）。关掉占用它的进程后重跑打包。`);
    }
  }
  for (const entry of fs.readdirSync(dst, { withFileTypes: true })) {
    if (fs.existsSync(path.join(src, entry.name))) continue;
    const stale = path.join(dst, entry.name);
    try {
      fs.rmSync(stale, { recursive: true, force: true });
    } catch {
      console.warn('同步时删不掉，已跳过：', stale);
    }
  }
}

const asarLocked = !canReplaceFile(asarPath);
// 走临时输出时统一用固定名字，打完即删，不会在 .qa 里堆积。
const lockedOut = path.join(stageRoot, 'release-locked');
const outputRoot = asarLocked ? lockedOut : path.join(root, 'release');
if (asarLocked) console.log('app.asar 被占用，改打到 .qa/release-locked 再同步回 release');

const input = fs.mkdtempSync(path.join(stageRoot, 'package-main-'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
for (const folder of ['dist', 'electron']) fs.cpSync(path.join(root, folder), path.join(input, folder), { recursive: true, errorOnExist: true });
fs.mkdirSync(path.join(input, 'build'));
fs.copyFileSync(path.join(root, 'build/raven-logo.png'), path.join(input, 'build/raven-logo.png'));
// Vite bundles renderer dependencies; the Electron main uses only built-in modules.
const { name, version, description, author, main, type } = pkg;
const build = { ...pkg.build, npmRebuild: false, electronVersion, electronDist: path.join(root, 'node_modules/electron/dist'),
  directories: { output: outputRoot },
  extraResources: [{ from: path.join(root, 'build/raven-logo.png'), to: 'raven-logo.png' }],
  win: { ...pkg.build.win, icon: path.join(root, 'build/icon.ico') } };
fs.writeFileSync(path.join(input, 'package.json'), JSON.stringify({ name, version, description, author, main, type, private: true, build }, null, 2), 'utf8');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--projectDir', input, '--win', '--dir'], { cwd: input, windowsHide: true, stdio: 'inherit' });
// 打包用的暂存目录用完即删，避免 .qa 里堆一串 package-main-*
fs.rmSync(input, { recursive: true, force: true });
if (result.error) throw result.error;

if (result.status === 0 && asarLocked) {
  syncInto(path.join(lockedOut, 'win-unpacked'), outDir);
  fs.rmSync(lockedOut, { recursive: true, force: true });
}

// 裁掉这台机器上永远用不到的着色器编译器。
// dxcompiler.dll + dxil.dll 是 Dawn 编译 WebGPU 着色器用的；本程序只用 Canvas 2D 与 CSS 渐变，
// WebGL 走的是另一份 d3dcompiler_47.dll。实测删掉后 Canvas 2D 逐像素一致、WebGL 着色器照常编译。
// 注意不要动 vk_swiftshader.dll / vulkan-1.dll：那是没有显卡或显卡驱动出问题时的软件渲染兜底，
// 省 6 MB 换一个「换台电脑就白屏」的风险不划算。
for (const name of ['dxcompiler.dll', 'dxil.dll']) {
  const target = path.join(outDir, name);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { force: true });
    console.log('已裁掉', name);
  }
}

process.exitCode = result.status ?? 1;
