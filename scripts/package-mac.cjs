// 打 macOS 版，产物是 release/mac-arm64/Raven Ambient.app，双击就能开。
//
// 和 package-win.cjs 是同一套思路（临时暂存目录 → electron-builder → 收产物），
// 但有三处不能照抄：
//
//   1. **不需要「文件被占用」那套绕行**。那是 Windows 的 unlink/EBUSY 问题，
//      mac 上删一个正在跑的 .app 也会失败，但用户那边是「把 .app 拖进废纸篓」，
//      不经过这个脚本；这里只要能覆盖写就行。
//   2. **不裁 dll**。dxcompiler.dll 那两条是 Windows 专有的着色器编译器。
//   3. **签名身份是 null（ad-hoc）**。没有 Apple 开发者证书，只能用 ad-hoc 签名：
//      `.app` 能在本机跑，但拷到别的 Mac 上会被 Gatekeeper 拦一次
//      （右键 → 打开，或 `xattr -dr com.apple.quarantine`）。
//      这是有意取舍——正式分发要 99 美元/年的开发者账号，等确实要发再说。
//
// 架构固定 arm64：用户的机器是 M6。要出 Intel 版改这里就行。
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const stageRoot = path.join(root, '.qa');
fs.mkdirSync(stageRoot, { recursive: true });

const ARCH = 'arm64';
const outDir = path.join(root, 'release', `mac-${ARCH}`);

const input = fs.mkdtempSync(path.join(stageRoot, 'package-mac-'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8'),
).version;

for (const folder of ['dist', 'electron']) {
  fs.cpSync(path.join(root, folder), path.join(input, folder), { recursive: true, errorOnExist: true });
}
fs.mkdirSync(path.join(input, 'build'));
fs.copyFileSync(path.join(root, 'build/raven-logo.png'), path.join(input, 'build/raven-logo.png'));

const { name, version, description, author, main, type } = pkg;
const build = {
  ...pkg.build,
  npmRebuild: false,
  electronVersion,
  electronDist: path.join(root, 'node_modules/electron/dist'),
  directories: { output: path.join(root, 'release') },
  extraResources: [{ from: path.join(root, 'build/raven-logo.png'), to: 'raven-logo.png' }],
  // NowPlaying.exe 在 mac 包里没有任何用处（也编不出来了），不带。
  //
  // 但 audiotee 必须**解到 asar 外面**：它是可执行文件，被塞进 asar 之后没法 spawn
  // （Electron 只会把它当成一段压缩数据）。electron/audio-tap.cjs 的 binaryPath()
  // 会把 app.asar/ 换回 app.asar.unpacked/ 去找它。
  asarUnpack: ['electron/vendor/audiotee'],
  mac: {
    target: 'dir',
    category: 'public.app-category.music',
    // 512×512 的 PNG。electron-builder 会自己转成 .icns；
    // 项目里没有 1024 的原图，先这样，图标糊不糊等上手看了再决定要不要重画。
    icon: path.join(root, 'build/icon.png'),
    // ad-hoc 签名：没有开发者证书时的唯一选择。写 null 而不是去掉这个字段——
    // 去掉的话 electron-builder 会去找钥匙串里的证书，找不到就报错。
    identity: null,
    // 这几句会原样显示在 macOS 的授权弹窗上，所以必须说清「用来干什么」，
    // 不能留 electron-builder 的默认值（那里只有一句 "This app needs access
    // to audio capture"，用户只能看到一个要权限但不知道为什么的框）。
    //
    // 只留真正用得上的两项：
    //   · 系统音频录制 —— 「外部音乐」打开时用它抓播放器的声音，好让环境音自动避让
    //   · 麦克风       —— Electron 自己会声明，删了不影响（我们从不录麦克风）
    // 相机 / 蓝牙那几条是 electron-builder 的模板，这个应用一件都不做，
    // 留着只会在隐私面板里多出几条永远不会被问到的项目。
    extendInfo: {
      NSAudioCaptureUsageDescription:
        '打开「外部音乐」时，用它抓取播放器正在播放的声音，好让环境音自动避让。不录音，不上传。',
      NSMicrophoneUsageDescription:
        '只有在「外部音乐」需要确认音频输入时才会用到。不录音，不上传。',
    },
  },
};
fs.writeFileSync(
  path.join(input, 'package.json'),
  JSON.stringify({ name, version, description, author, main, type, private: true, build }, null, 2),
  'utf8',
);

const result = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/electron-builder/cli.js'), '--projectDir', input, '--mac', `--${ARCH}`, '--dir'],
  { cwd: input, stdio: 'inherit' },
);
fs.rmSync(input, { recursive: true, force: true });
if (result.error) throw result.error;

if (result.status === 0) {
  const app = path.join(outDir, 'Raven Ambient.app');
  if (!fs.existsSync(app)) {
    console.error(`打包返回成功但没找到 ${app}`);
    process.exitCode = 1;
  } else {
    console.log('已生成', app);
  }
}

process.exitCode = result.status ?? 1;
