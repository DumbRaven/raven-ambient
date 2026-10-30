// 把 win-unpacked 打成一个「解压即用」的压缩包。
//
// 为什么是 zip：双击就能解压，用户不用先看说明再找个脚本跑。
//
// 关于体积的实测（release/win-unpacked 261.5 MB / 23 个文件）：
//   zip（deflate 9）      114.1 MB   5.6 秒
//   tar.gz（gzip 9）      110.9 MB   9   秒
// 差 1%～3%，为这点体积让用户多跑一个解压脚本不划算，所以用 zip。
// 之前用 tar.gz 是因为 zip 比 tar.gz 大 23 MB——那是在裁语言包之前测的，
// locales 从 45 MB 降到 1 MB 之后，两者的差距被抹平了。
const fs = require('node:fs');
const path = require('node:path');
const { pack } = require('./zip-pack.cjs');
const { verify } = require('./verify-zip.cjs');

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
  '解压后双击「Raven Ambient Bold.exe」开始，不用安装。',
  '',
  '第一次打开时 Windows 可能提示「已保护你的电脑」，',
  '点「更多信息」→「仍要运行」即可（这个版本没有签名证书）。',
  '',
  '使用方法见「使用说明.html」，双击就能用浏览器打开。',
  '',
  '如果想用「外部音乐」功能（让网易云之类的播放器当音乐来源），',
  '再装「可选-虚拟声卡」里的驱动。不装不影响其他功能。',
].join('\r\n'), 'utf8');

// 5. 压缩
//
// 不用系统的 tar 程序：bsdtar 在 GitHub Actions 的 runner 上压 260 MB 会以
// 0xC0000005（访问冲突）崩掉，本地每次成功；换成 xz 也一样崩。发版流程不能
// 押在一个「本地能跑、CI 崩」的二进制上，所以用 scripts/zip-pack.cjs 自己写。
const archive = path.join(OUT, `Raven-Ambient-${tag}-win-x64.zip`);

(async () => {
  const bytes = (function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum
      + (entry.isDirectory() ? walk(path.join(dir, entry.name)) : fs.statSync(path.join(dir, entry.name)).size), 0);
  })(STAGE);
  console.log('待压缩', (bytes / 1024 / 1024).toFixed(1), 'MB，开始 deflate');

  let lastShown = 0;
  const size = await pack(STAGE, archive, (done, total) => {
    const percent = Math.floor((done / total) * 100);
    if (percent >= lastShown + 25) {
      lastShown = percent;
      console.log(`  ${percent}%`);
    }
  }, bytes);

  // 压完必须自己验一遍。
  //
  // 0.3.1 和 0.3.2 的包都是坏的：zip 头里的 CRC 写成了「压缩后数据」的校验和，
  // 而规范要求的是「未压缩数据」的。Windows 资源管理器解压时不查 CRC，所以我当时
  // 用 Expand-Archive 验过就当没事；用 WinRAR / 7-Zip 的用户会看到一屏
  // 「雜湊驗算發生錯誤」和「壓縮檔已經毀損」。
  //
  // 这里的 verify 会逐条解压、重算 CRC 与长度，对不上就抛错。
  // 打包脚本自己挡住比等用户来报便宜得多。
  const checked = verify(archive);
  if (checked.bad.length) {
    throw new Error(`压缩包自检失败：${checked.bad.length} / ${checked.count} 条对不上\n  ${checked.bad.slice(0, 5).join('\n  ')}`);
  }
  console.log('自检通过：', checked.count, '条全部校验一致');

  // 暂存目录压完就没用了。不删的话 release/dist 里会留着 265 MB 的副本。
  fs.rmSync(STAGE, { recursive: true, force: true });

  console.log('分发包', (size / 1024 / 1024).toFixed(1), 'MB ->', archive);
  console.log('目录', OUT);
})().catch((error) => {
  console.error('打包失败：', error.message);
  process.exitCode = 1;
});
