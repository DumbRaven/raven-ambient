/**
 * 诊断：ticket-card.png 里票根字发灰，是不是 capturePage 抢在重绘前面了。
 *
 * 做法：滚到第一张票之后，分别等 2 帧 / 400ms / 1200ms 各截一次，
 *      量 .ticket-name 区域最暗值。若等待时间越长越深，就证实是截图时机问题。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

const OUT = path.join(__dirname, '..', '..', 'tools', 'probe');

guard(async () => {
  const media = seedImages(40);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;

  const scroll = () => run(`(async () => {
    const card = document.querySelector('.ticket-grid .ticket');
    card.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -70);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    return true;
  })()`);

  const grab = async name => {
    const r = await run(`(() => {
      const b = document.querySelector('.ticket-grid .ticket .ticket-name').getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    })()`);
    const png = await win.webContents.capturePage({ x: r.x, y: r.y, width: r.w, height: r.h });
    fs.writeFileSync(path.join(OUT, 'timing-' + name + '.png'), png.toPNG());
    return r;
  };

  await scroll();
  const a = await grab('frames');

  await wait(400);
  const b = await grab('400ms');

  await wait(1200);
  const c = await grab('1600ms');

  // 再滚走又滚回来，看是不是每次滚动都掉一次
  await run(`(async () => { window.scrollBy(0, 400); await new Promise(d => setTimeout(d, 200)); return 1; })()`);
  await scroll();
  const d = await grab('rescroll');

  report({ a, b, c, d });
});
