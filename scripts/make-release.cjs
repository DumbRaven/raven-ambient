// 把 win-unpacked 打包成「解压即用」的体验版目录，再压成一个 zip
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = 'F:/Vibe-bold';
const SRC = path.join(ROOT, 'release', 'win-unpacked');
const STAGE = path.join(ROOT, 'release', '体验版', 'Raven Ambient Bold 体验版');
const OUT = path.join(ROOT, 'release', '体验版');

if (!fs.existsSync(SRC)) throw new Error('还没有 win-unpacked，先跑 package:win');

// 先清空旧的分发目录，避免上一版的残留文件混进来
fs.rmSync(path.join(ROOT, 'release', '体验版'), { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// 1. 运行时文件
fs.cpSync(SRC, STAGE, { recursive: true });

// 2. 使用说明（含图片）
fs.cpSync(path.join(ROOT, 'docs', '使用说明.html'), path.join(STAGE, '使用说明.html'));
fs.cpSync(path.join(ROOT, 'docs', 'images'), path.join(STAGE, 'images'), { recursive: true });

// 3. 可选虚拟声卡：只带安装必需的文件，不带测试音频和 .sys 的旧版本
const cableSrc = path.join(ROOT, '.cable');
const cableDst = path.join(STAGE, '可选-虚拟声卡');
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

// 4. 顶层放一个先看这里
fs.writeFileSync(path.join(STAGE, '先看这里.txt'), [
  'Raven Ambient Bold · 体验版 0.3.0',
  '',
  '双击「Raven Ambient Bold.exe」开始。不用安装。',
  '',
  '第一次打开时 Windows 可能提示「已保护你的电脑」，',
  '点「更多信息」→「仍要运行」即可（这个版本没有签名证书）。',
  '',
  '使用方法见「使用说明.html」，双击就能用浏览器打开。',
  '',
  '如果想用「外部音乐」功能（让网易云之类的播放器当音乐来源），',
  '再装「可选-虚拟声卡」里的驱动。不装不影响其他功能。',
].join('\r\n'), 'utf8');

// 统计
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = walk(STAGE);
const bytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
console.log('文件数', files.length, '总大小', (bytes / 1024 / 1024).toFixed(1), 'MB');
console.log('目录', STAGE);

// 5. 压成 zip（用 .NET 的 ZipFile，不依赖外部工具）
const zipPath = path.join(OUT, 'Raven Ambient Bold 体验版.zip');
if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
try {
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${STAGE}', '${zipPath}', [System.IO.Compression.CompressionLevel]::Optimal, $true)`],
    { stdio: 'inherit' });
  console.log('zip', (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1), 'MB', zipPath);
} catch (error) {
  console.log('压缩失败（目录版已可用）:', error.message);
}
