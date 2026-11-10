/**
 * 相集的票根：只管截两张"近景"。
 *
 * 为什么单独一个：完整页面截图里票根只有两百来像素宽，纸纹、齿孔、
 * 票根里那几行小字全糊成一团，看不出跟参考图像不像。这里按
 * `.ticket-grid` 的矩形裁两块，一块两列、一块单张，放大到能看清为止。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-closeup.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

/** 按选择器矩形裁一块，外扩 pad 像素，放大到 width 宽。
 *  **必须先知道截图本身多大**：getBoundingClientRect 给的是视口坐标，
 *  元素滚出可视区时 y 会超出图片高度，ffmpeg 的 crop 直接报
 *  `Invalid argument` 然后一个字节都不写（早先就吃了这一下）。 */
function crop(shot, rect, out, width) {
  const [sw, sh] = probeSize(shot);
  const pad = 8;
  const x = Math.max(0, Math.min(sw - 2, Math.round(rect.x - pad)));
  const y = Math.max(0, Math.min(sh - 2, Math.round(rect.y - pad)));
  const w = Math.max(2, Math.min(sw - x, Math.round(rect.w + pad * 2)));
  const h = Math.max(2, Math.min(sh - y, Math.round(rect.h + pad * 2)));
  const target = Math.min(width, w * 3);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', shot,
    '-vf', `crop=${w}:${h}:${x}:${y},scale=${target}:-2:flags=lanczos`,
    out,
  ]);
  return { file: path.basename(out), crop: [x, y, w, h], target };
}

/** 截图的实际像素尺寸（DPR 可能是 1 也可能是 2，不许写死）。 */
function probeSize(file) {
  const text = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]).toString().trim();
  return text.split(',').slice(0, 2).map(Number);
}

/** 选择器 → 屏幕矩形（CSS 像素，与截图 1:1 因为 DPR=1）。 */
const rectOf = selector => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
})()`;

/** 把第一张票、以及它里面的每一块，都量一遍尺寸，确认排版没挤爆。 */
const READ_FIRST = `(() => {
  const ticket = document.querySelector('.ticket-grid .ticket');
  if (!ticket) return { error: 'no-ticket' };
  const box = el => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  };
  const name = ticket.querySelector('.ticket-name');
  const fields = [...ticket.querySelectorAll('.ticket-fields')];
  return {
    ticket: box(ticket),
    stub: box(ticket.querySelector('.ticket-stub')),
    shot: box(ticket.querySelector('.ticket-shot')),
    panel: box(ticket.querySelector('.ticket-panel')),
    bars: box(ticket.querySelector('.ticket-bars')),
    name: { ...box(name), fontSize: getComputedStyle(name).fontSize, lineClamp: getComputedStyle(name).webkitLineClamp },
    fields: fields.map(f => ({
      ...box(f),
      // 换行会让高度翻倍，这是"挤爆了"的直接证据
      text: f.textContent.trim(),
      lines: Math.round(f.getBoundingClientRect().height / parseFloat(getComputedStyle(f).lineHeight)),
    })),
    // 名字有没有被夹断：scrollHeight 明显大于 clientHeight 就是截了
    nameClipped: name.scrollHeight > name.clientHeight + 1,
  };
})()`;

guard(async () => {
  const media = seedImages(18);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;
  const out = {};

  await run(`(() => { document.querySelector('.ticket-grid')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -40); return 1; })()`);
  await wait(600);

  out.first = await run(READ_FIRST);

  const shot = path.join(__dirname, 'ticket-closeup-raw.png');
  fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());

  const row = await run(rectOf('.ticket-grid'));
  const one = await run(rectOf('.ticket-grid .ticket'));
  if (row) out.row = crop(shot, row, path.join(__dirname, 'ticket-closeup.png'), 1200);
  if (one) out.one = crop(shot, one, path.join(__dirname, 'ticket-one.png'), 760);
  fs.unlinkSync(shot);

  report(out);
});
