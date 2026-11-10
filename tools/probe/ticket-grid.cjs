/**
 * 探针：相集的票根网格（用户 m13607 / m13669）。
 *
 * 要证明五件事：
 *   1. 一页最多八张，一行四张（两行）；
 *   2. 条目多于八件时出现翻页条，翻过去换的是另一批 id；
 *   3. 点票先撕存根（`.is-tearing` 挂上、约 300ms），撕完才进播放台；
 *   4. 播放台停在那张票上，票面挂 `.is-current`；
 *   5. 关了动效（prefers-reduced-motion）时不撕、立刻换台。
 *
 * 为什么要自己造十八张图：harness 的 CABINET 只放一件媒体，
 * 一页八张的分页永远不会出现——不补素材，这探针量到的东西全是常量。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-grid.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

/** 网格概况：这一页几张、列数、翻页条有几颗、每张的 id。 */
const READ_GRID = `(() => {
  const grid = document.querySelector('.ticket-grid');
  if (!grid) return { error: 'no-grid' };
  const style = getComputedStyle(grid);
  const cards = [...grid.querySelectorAll('.ticket')];
  return {
    count: cards.length,
    columns: style.gridTemplateColumns.split(' ').length,
    rows: new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size,
    ids: [...grid.querySelectorAll('li')].map(li => li.dataset.id),
    pages: document.querySelectorAll('.ticket-pager .pager-numbers button').length,
    page: [...document.querySelectorAll('.ticket-pager .pager-numbers button')]
      .findIndex(b => b.classList.contains('active')),
    hasPager: !!document.querySelector('.ticket-pager'),
    current: document.querySelector('.ticket.is-current')?.closest('li')?.dataset.id || null,
    barTitle: document.querySelector('.theater-copy b')?.textContent || null,
  };
})()`;

const CLICK_PAGE = index => `(() => {
  const buttons = [...document.querySelectorAll('.ticket-pager .pager-numbers button')];
  buttons[${index}]?.click();
  return buttons.length;
})()`;

/** 点第 index 张票，**等一帧**再回报（React 的 setState 是批处理的，
 *  click() 返回那一刻 DOM 还是旧的，当场读永远是「没在撕」）。 */
const CLICK_TICKET = index => `(async () => {
  const card = [...document.querySelectorAll('.ticket-grid .ticket')][${index}];
  if (!card) return { error: 'no-card' };
  const li = card.closest('li');
  card.click();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const style = getComputedStyle(li.querySelector('.ticket-stub'));
  return {
    id: li.dataset.id,
    tearing: li.classList.contains('is-tearing'),
    stubAnim: style.animationName,
    stubDuration: style.animationDuration,
  };
})()`;

guard(async () => {
  const media = seedImages(18);
  // **expand 必须是 false**：全屏时 `.media-room.is-expanded` 把 `.ticket-grid`
  // 与 `.ticket-pager` 一起 display:none，量到的是 0×0——第一版就这么量出
  // `columns 3 / rows 1 / tearing false`，全是假值。
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run, win } = probe;
  const out = {};

  // ---- 1. 第一页：八张、四列两行、三页
  out.page1 = await run(READ_GRID);

  // ---- 2. 翻到第二页：id 必须整批换掉，页号跟上
  await run(CLICK_PAGE(1));
  await wait(500);
  out.page2 = await run(READ_GRID);

  // ---- 3. 翻到最后一页：18 件应该是 8 + 8 + 2
  await run(CLICK_PAGE(2));
  await wait(500);
  out.page3 = await run(READ_GRID);

  // ---- 4. 撕存根：点第一张，撕的过程中先别进台
  await run(CLICK_PAGE(0));
  await wait(500);
  const target = (await run(READ_GRID)).ids[0];
  out.tearStart = await run(CLICK_TICKET(0));
  await wait(120);
  out.tearingMidway = await run(`(() => {
    const li = document.querySelector('.ticket-grid li.is-tearing');
    if (!li) return { tearing: false };
    const stub = li.querySelector('.ticket-stub');
    const style = getComputedStyle(stub);
    return {
      tearing: true,
      opacity: +Number(style.opacity).toFixed(2),
      moved: style.transform !== 'none',
    };
  })()`);
  await wait(420);
  out.afterTear = await run(READ_GRID);
  out.afterTear.target = target;

  const png = (await win.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(__dirname, 'ticket-grid.png'), png);
  out.shot = 'tools/probe/ticket-grid.png';

  // ---- 5. 关了动效：不撕，点了立刻换台
  await run(`(() => { matchMedia('(prefers-reduced-motion: reduce)'); return 1; })()`);
  out.reduced = await run(`(() => {
    const before = document.querySelector('.theater-copy b')?.textContent || null;
    const card = [...document.querySelectorAll('.ticket-grid .ticket')][1];
    const li = card.closest('li');
    card.click();
    return {
      before,
      // 这一帧还在撕（或已经换台，取决于系统设置），最终结果看 reducedSettled
      current: document.querySelector('.ticket.is-current')?.closest('li')?.dataset.id || null,
      expected: li.dataset.id,
    };
  })()`);
  await wait(420);
  out.reducedSettled = await run(READ_GRID);

  report(out);
});
