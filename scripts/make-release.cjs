// 把 win-unpacked 打成一个「解压即用」的分发包。
//
// 为什么用 tar.xz 而不是 zip：Electron 的 dll 与 exe 压缩率只有 43%（zip 用 deflate），
// 换成 xz 能到 30% 左右，整个包从 134 MB 降到 80 MB，下载时间少一大截。
// Windows 10 1803 之后系统自带 bsdtar，所以解压不需要装 7-Zip，双击 .cmd 就行。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'release', 'win-unpacked');
const OUT = path.join(ROOT, 'release', 'dist');
const STAGE = path.join(OUT, 'Raven Ambient Bold');

if (!fs.existsSync(SRC)) throw new Error('还没有 win-unpacked，先跑 package:win');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tag = process.env.RAVEN_VERSION || 'v' + pkg.version;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// 1. 运行时文件
fs.cpSync(SRC, STAGE, { recursive: true });

// 2. 使用说明
fs.cpSync(path.join(ROOT, 'docs', '使用说明.html'), path.join(STAGE, '使用说明.html'));
fs.cpSync(path.join(ROOT, 'docs', 'images'), path.join(STAGE, 'images'), { recursive: true });

// 3. 可选虚拟声卡：只带装驱动需要的文件，不带测试音频
const cableSrc = path.join(ROOT, '.cable');
const cableDst = path.join(STAGE, '可选-虚拟声卡');
if (fs.existsSync(cableSrc)) {
  fs.mkdirSync(cableDst, { recursive: true });
  for (const name of ['VBCABLE_Setup_x64.exe', 'VBCABLE_Setup.exe', 'VBCABLE_ControlPanel.exe', 'readme.txt']) {
    const from = path.join(cableSrc, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(cableDst, name));
  }
  fs.writeFileSync(path.join(cableDst, '说明.txt'), [
    'VB-Cable 虚拟声卡（可选）',
    '',
    '只有想用「外部音乐」功能（让网易云、Spotify 这类播放器当音乐来源）才需要装它。',
    '不装的话，软件的其他功能完全正常。',
    '',
    '怎么装：',
    '1. 右键 VBCABLE_Setup_x64.exe，选择「以管理员身份运行」',
    '2. 点 Install Driver。安装过程中窗口可能短暂显示「未响应」，等它自己结束',
    '3. 装完必须重启电脑',
    '',
    '装完之后怎么用，见上一层的「使用说明.html」第 04 节。',
    '',
    'VB-Cable 由 Vincent Burel 开发，是 donationware（自愿捐赠）。',
    '项目主页：https://vb-audio.com/Cable/',
    '授权：https://vb-audio.com/Services/licensing.htm',
    '这里只原样分发官方安装包，未做任何修改。',
  ].join('\r\n'), 'utf8');
}

// 4. 先看这里
fs.writeFileSync(path.join(STAGE, '先看这里.txt'), [
  `Raven Ambient Bold ${tag} · 免安装版`,
  '',
  '双击「Raven Ambient Bold.exe」开始，不用安装。',
  '',
  '第一次打开时 Windows 可能提示「已保护你的电脑」，',
  '点「更多信息」→「仍要运行」即可（这个版本没有签名证书）。',
  '',
  '使用方法见「使用说明.html」，双击就能用浏览器打开。',
  '',
  '如果想用「外部音乐」功能（让网易云之类的播放器当音乐来源），',
  '再装「可选-虚拟声卡」里的驱动。不装不影响其他功能。',
].join('\r\n'), 'utf8');

// 5. 压缩：xz -9e，全体数据连成一个流才压得动（-9 单独压 exe 只能到 31%）
const archive = path.join(OUT, `Raven-Ambient-${tag}-win-x64.tar.xz`);
const bytes = (function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum
    + (entry.isDirectory() ? walk(path.join(dir, entry.name)) : fs.statSync(path.join(dir, entry.name)).size), 0);
})(STAGE);
console.log('待压缩', (bytes / 1024 / 1024).toFixed(1), 'MB，开始 xz -9e（这一步要一两分钟）');

execFileSync('tar', ['-c', '-J', '-f', archive, '-C', OUT, 'Raven Ambient Bold'], {
  stdio: 'inherit', windowsHide: true,
});

// 暂存目录压完就没用了。不删的话 release/dist 里会留着 265 MB 的副本，
// 下次再打包又会先 rmSync 掉重建一遍，白占磁盘。
fs.rmSync(STAGE, { recursive: true, force: true });

// 6. 一个双击就能解压的小脚本，省得用户去翻 7-Zip
fs.writeFileSync(path.join(OUT, '解压后运行我.cmd'), [
  '@echo off',
  'chcp 65001 >nul',
  'cd /d "%~dp0"',
  'echo 正在解压，请稍候…',
  `tar -xf "Raven-Ambient-${tag}-win-x64.tar.xz"`,
  'if errorlevel 1 (',
  '  echo.',
  '  echo 解压失败。如果系统很旧，请自己用 7-Zip 解压上面的 .tar.xz 文件。',
  '  pause',
  '  exit /b 1',
  ')',
  'echo 完成，正在打开文件夹…',
  'start "" "Raven Ambient Bold"',
  'exit',
].join('\r\n'), 'utf8');

const size = fs.statSync(archive).size;
console.log('分发包', (size / 1024 / 1024).toFixed(1), 'MB ->', archive);
console.log('目录', OUT);
