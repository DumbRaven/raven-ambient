/**
 * 对比度的像素级取证 —— 不信计算样式，信屏幕上真实的那几个像素。
 *
 * 为什么要另起一个探针：tools/probe/contrast.cjs 走的是「从元素往上找第一个
 * 不透明祖先背景」。这套界面里有一类背景不是祖先画的，是兄弟元素画的：
 * 页签的激活态黑胶囊来自 .nav-marker（滑动指示条，绝对定位的兄弟节点），
 * 筛选胶囊的来自 .flip-marker，模板滑块来自 .template-marker。
 * 于是那个探针对这些元素量到的是页面底色，报出「白字在 #f0efea 上，1.15:1」
 * 这种假阳性——视觉上明明是黑底白字。
 *
 * 这里的做法：
 *   1. 页面里收集每个真正有文字的元素（选择器、矩形、字号、字重、文字色）
 *   2. 整页截一张图
 *   3. 回到 Node 里按矩形裁出那块，用像素算出「文字实际压着的底色」
 *      底色取矩形内**出现次数最多的颜色**（文字笔画占少数，背景占多数）
 *   4. 拿计算出来的文字色与该底色算 WCAG 对比度
 *
 * 已知局限（报告里要写明）：
 *   - 大字号遮住半个矩形时众数可能取到文字色本身，这类结果会带上
 *     `bgSuspect: true` 标记，需要人看截图复核
 *   - 背景是照片/视频时底色不是单一色，这里取众数只能算「最常见的那个底」
 *   - 只用物理像素，dpr=1
 */
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1';
const { app } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});

const fs = require('fs');
const path = require('path');
const { guard, report, wait, launch, CABINET } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'contrast-px');

const RECORD_COLORS = ['#879a91', '#aaa2b4', '#bd9b80', '#8c9caa', '#aaa481', '#b28e92'];
const NAMES = ['雨声', '夜航', '炉火', '打字', '海浪', '微风', '虫鸣', '城市'];
const records = NAMES.map((name, i) => ({
  id: 'probe-' + i, assetId: 'probe-asset-' + i, name,
  artist: i < 5 ? '本地收藏' : '环境音', description: '',
  category: i < 5 ? 'music' : 'ambient', duration: 180 + i, format: 'mp3', size: 4096,
  color: RECORD_COLORS[i % RECORD_COLORS.length], fingerprint: 'probe-' + i,
  volume: 0.6, pan: 0, warmth: 0.5, duckDepth: 12,
}));

const VIEWS = ['唱片柜', '正在听', '专注', '相集'];

const switchView = (view) => `(() => {
  const b = [...document.querySelectorAll('.view-tabs > button')]
    .find(x => x.getAttribute('aria-label') === ${JSON.stringify(view)});
  if (b) b.click();
  return !!b;
})()`;

/* 收集有文字的元素。只认自己直接持有文本节点的（不然整个 body 都算一个元素）。 */
const GATHER = String.raw`(() => {
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const label = (el) => {
    const cls = [...el.classList].slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const text = [...el.childNodes]
      .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const px = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    out.push({
      el: label(el),
      text: text.slice(0, 18),
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      px: Math.round(px * 10) / 10,
      weight,
      fg: [Math.round(fg.r), Math.round(fg.g), Math.round(fg.b)],
      fgA: fg.a,
      large: px >= 24 || (px >= 18.66 && weight >= 700),
    });
  }
  return out;
})()`;

const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/* 裁出的那块里出现最多的颜色 = 底色。文字笔画是少数，背景是多数。 */
function dominantColor(png, box) {
  const counts = new Map();
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
  const x1 = Math.min(png.width, box.x + box.w), y1 = Math.min(png.height, box.y + box.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (png.width * y + x) << 2;
      const k = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  let best = 0, bestN = 0, total = 0;
  for (const [k, n] of counts) { total += n; if (n > bestN) { bestN = n; best = k; } }
  return {
    rgb: [(best >> 16) & 255, (best >> 8) & 255, best & 255],
    share: total ? bestN / total : 0,
  };
}

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const probe = await launch({ width: 680, height: 980, settle: 4200 });
  const full = { ...CABINET, records, queue: records.slice(0, 5), ambience: records.slice(5) };
  await probe.run(`localStorage.setItem('raven-cabinet-v2', ${JSON.stringify(JSON.stringify(full))})`);
  await probe.run('location.reload()').catch(() => {});
  await wait(5200);

  const rows = [];
  for (const view of VIEWS) {
    await probe.run(switchView(view));
    await wait(1000);
    const items = await probe.run(GATHER);
    await probe.shot(path.join(OUT, `shot-${view}.png`));
    for (const it of items) rows.push({ view, file: `shot-${view}.png`, ...it });
  }

  fs.writeFileSync(path.join(OUT, 'elements.json'), JSON.stringify(rows, null, 2));
  report({
    total: rows.length,
    byView: VIEWS.map(v => ({ view: v, elements: rows.filter(r => r.view === v).length })),
    hint: '下一步跑 contrast-px.py 算像素底色与对比度',
  });
});
