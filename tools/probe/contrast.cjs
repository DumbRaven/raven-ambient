/**
 * 对比度体检：把「哪个字看不清」变成一张带选择器和实测值的清单。
 *
 * 两件事必须按这个顺序做，否则探针会静默挂掉或量到错的底：
 *  1. app.commandLine.appendSwitch 必须在 require('./harness.cjs') 之前。
 *  2. 窗口只 launch 一次 —— media: 协议只能注册一次（electron/media.cjs），
 *     第二次 launch 报 "Failed to register protocol: media"。
 *     换数据靠改 localStorage + reload，不重建窗口。
 */
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1';
const { app } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', process.env.PROBE_DPR || '1');
app.on('window-all-closed', () => {});

const { launch, wait, CABINET } = require('./harness.cjs');
const { AUDIT, DATA } = require('./contrast-live.cjs');
const fs = require('fs');
const path = require('path');

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

app.whenReady().then(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  const probe = await launch({ width: 680, height: 980, settle: 4200 });
  const rows = [];

  for (const mode of ['full', 'empty']) {
    const next = mode === 'full'
      ? { ...CABINET, records, queue: records.slice(0, 5), ambience: records.slice(5) }
      : { ...CABINET, records: [], queue: [], ambience: [] };
    await probe.run(`localStorage.setItem('raven-cabinet-v2', ${JSON.stringify(JSON.stringify(next))})`);
    await probe.run('location.reload()').catch(() => {});
    await wait(5200);
    for (const view of VIEWS) {
      await probe.run(switchView(view));
      await wait(900);
      for (const r of await probe.run(AUDIT)) rows.push({ ...r, view, mode });
    }
  }

  const uniq = new Map();
  for (const r of rows) {
    const k = r.view + '|' + r.el + '|' + r.color + '|' + r.need;
    if (!uniq.has(k)) uniq.set(k, r);
  }
  const list = [...uniq.values()].sort((a, b) => a.ratio - b.ratio);
  fs.writeFileSync(path.join(DATA, 'report.json'), JSON.stringify(list, null, 2));
  console.log('@@CONTRAST@@' + JSON.stringify({ count: list.length, rows: list }, null, 2));
  app.exit(0);
});
