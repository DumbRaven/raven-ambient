// 抓宣传素材。不复用 baseline.cjs，因为那边每张图都要等动画停、还要对齐
// 像素基线，节奏完全不一样；这里只要能看的、有内容的画面。
//
// 关键取舍：
//   - 主窗口按真实的 680×980 拍。界面本身是 680 宽居中的，拉宽只会得到
//     一整块留白（实测 1400×900 时内容还是 680 宽、右边空一大片）。
//     视频里这些图以卡片形式飘入，680×980 的原始比例正好。
//   - 放映全屏用 1280×800，那是 `.media-room.is-expanded` 的真实尺寸。
//   - 相集画面换成 public/landscape.svg 渲出来的风景图。探针自带的
//     MEDIA_IMG 是纯色块，当宣传素材太单调。
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const path = require('node:path');
const fs = require('node:fs');
const { launch, guard, wait, ROOT, MEDIA_AUDIO, MEDIA_DIR } = require('./harness.cjs');

const OUT = path.join(ROOT, '.qa', 'promo');
// media scheme 只放行 `MEDIA_DIR`（harness 里 allowDir 过），所以宣传图必须
// 先复制进去。直接指向 .qa/frames 会静默加载失败——画面里显示成
// 「这张图片找不到了」，而且不报错。
const SCENE = path.join(MEDIA_DIR, 'landscape.png');

// 跟 baseline.cjs 同一批唱片，配色是 recordColors 里挑过的，成组出现好看。
const colors = ['#879a91', '#aaa2b4', '#bd9b80', '#8c9caa', '#aaa481', '#b28e92'];
const NAMES = ['雨声', '夜航', '炉火', '打字', '海浪', '微风', '虫鸣', '城市'];
const records = NAMES.map((name, i) => ({
  id: `promo-${i}`,
  assetId: `promo-asset-${i}`,
  name,
  artist: '本地收藏',
  description: '',
  category: i < 5 ? 'music' : 'ambient',
  duration: 180 + i * 37,
  format: i % 2 ? 'FLAC' : 'MP3',
  size: 2_400_000 + i * 100_000,
  color: colors[i % colors.length],
  fingerprint: `promo-fingerprint-${i}`,
  volume: 60,
  pan: 0,
  warmth: 0,
  duckDepth: 9,
}));

const patch = {
  records,
  queue: records.filter(r => r.category === 'music').map(r => r.id),
  ambience: records.filter(r => r.category === 'ambient').map(r => r.id),
  // 相集里塞三张，票根才排得满。同一张风景图三次，靠散列出来的日期时刻区分开。
  media: [1, 2, 3].map(n => ({
    id: `image:${n}`,
    kind: 'image',
    path: SCENE,
    name: ['Ocean', 'Drowned Dusk', 'Slow Moments'][n - 1],
    size: 1,
  })),
};

// 把窗口里跟当天有关的文本钉死，画面才不会出现「WED · NOV 18」这种跑动的东西。
const FREEZE = `(() => {
  const stamp = document.querySelector('.today-stamp > span');
  if (stamp) stamp.textContent = 'FRI · NOV 14';
  const corner = document.querySelector('.tpl-corner-date');
  if (corner) corner.innerHTML = '2026<br>1114';
  return 1;
})()`;

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // 风景图必须落在 media scheme 的放行目录里（harness 只 allowDir 了 MEDIA_DIR）。
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.qa', 'frames', 'landscape.png'), SCENE);
  // 真全屏会把窗口撑到显示器尺寸（本机 1920×1080），而且页面会溢出、
  // 截图上带两条滚动条。这里只换「窗口怎么变大」那一步，页面侧的
  // 全屏链路照旧走，跟 baseline.cjs 的做法一致。
  const FULL = { width: 1600, height: 900 };
  const realSetFullScreen = BrowserWindow.prototype.setFullScreen;
  BrowserWindow.prototype.setFullScreen = function (on) {
    if (on) { this.setContentSize(FULL.width, FULL.height); return; }
    this.setContentSize(680, 980);
  };
  void realSetFullScreen;
  const probe = await launch({ width: 680, height: 980, expand: false, settle: 5200, patch });

  await probe.win.webContents.debugger.attach('1.3');
  await probe.win.webContents.debugger.sendCommand('Page.enable');
  // 种子要跟 baseline 一样钉死，否则封套每次跑配色都不同，重拍对不上。
  await probe.win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      let s = 0x9e3779b9;
      Math.random = () => {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const BASE = 1763164800000;
      const RealDate = Date;
      class FixedDate extends RealDate {
        constructor(...a) { if (!a.length) super(BASE); else super(...a); }
        static now() { return BASE; }
      }
      window.Date = FixedDate;
      return 1;
    })()`,
  });
  await probe.win.webContents.reload();
  await wait(5200);

  for (const r of records) await probe.seedAsset(r.assetId, MEDIA_AUDIO);
  console.log(`[promo] 资产已种：${records.length} 条`);

  const switchView = label => `(() => {
    const hit = [...document.querySelectorAll('.view-tabs > button')]
      .find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!hit) return 'missing:' + ${JSON.stringify(label)};
    hit.click();
    return 1;
  })()`;

  // 离屏窗口的 capturePage() 经常返回 0 字节，走 CDP 更稳。
  const shot = async name => {
    const dbg = probe.win.webContents.debugger;
    const res = await dbg.sendCommand('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    const { load } = require('../measure/pixels.cjs');
    const img = load(file);
    console.log(`[promo] ${name}.png ${img.W}x${img.H}`);
  };

  // ---- 1. 唱片柜：有内容的样子 ----
  await probe.run(switchView('唱片柜'));
  await wait(1400);
  await probe.run(FREEZE);
  await shot('01-cabinet');

  // ---- 2. 正在听：真的在播 ----
  await probe.run(switchView('正在听'));
  await wait(1200);
  try {
    await probe.run(`(() => { document.querySelector('.dock-disc')?.click(); return 1; })()`);
    await wait(600);
    await probe.run(`(() => { document.querySelector('.main-play')?.click(); return 1; })()`);
    await wait(1400);
    await probe.run(FREEZE);
    await shot('02-listening');
    await probe.run(`(() => {
      document.querySelector('.main-play')?.click();
      document.querySelector('.play-card-close')?.click();
      return 1;
    })()`);
    await wait(500);
  } catch (e) {
    console.log('[promo] 正在听跳过：' + e.message);
  }

  // ---- 3. 专注：运行中 ----
  await probe.run(switchView('专注'));
  await wait(1200);
  try {
    await probe.run(`(() => {
      document.querySelector('.focus-actions .primary-button')?.click();
      return 1;
    })()`);
    await wait(1200);
    await probe.run(FREEZE);
    await shot('03-focus');
  } catch (e) {
    console.log('[promo] 专注跳过：' + e.message);
  }

  // ---- 4. 相集：票根列表 ----
  await probe.run(switchView('相集'));
  await wait(1400);
  await probe.run(FREEZE);
  await shot('04-tickets');

  // ---- 5. 放映全屏：拼贴 ----
  // 窗口要撑到 1280×800，跟 `.is-expanded` 的真实尺寸一致。
  const pickTemplate = label => `(() => {
    const hit = [...document.querySelectorAll('.theater-templates button')]
      .find(b => b.textContent.trim() === ${JSON.stringify(label)});
    if (!hit) return 'missing';
    hit.click();
    return 1;
  })()`;

  await probe.run(pickTemplate('拼贴'));
  await wait(800);
  probe.win.setContentSize(1280, 800);
  await wait(1200);
  try {
    await probe.run(`(() => {
      const hit = [...document.querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === '全屏');
      if (!hit) return 'missing-expand';
      hit.click();
      return 1;
    })()`);
    await wait(2200);
    await probe.run(FREEZE);
    await shot('05-theater-collage');

    // ---- 6. 放映全屏：相集（满画面那张） ----
    await probe.run(pickTemplate('相集'));
    await wait(1200);
    await probe.run(FREEZE);
    await shot('06-theater-photo');

    // ---- 7. 透明版式：窗口态 ----
    await probe.run(`(() => {
      const hit = [...document.querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === '退出全屏');
      hit?.click();
      return 1;
    })()`);
    await wait(1800);
  } catch (e) {
    console.log('[promo] 全屏跳过：' + e.message);
  }

  await probe.run(pickTemplate('透明'));
  await wait(1000);
  await probe.run(FREEZE);
  await shot('07-transparent');

  console.log('[promo] 完成，输出在 .qa/promo');
  probe.close();
});
