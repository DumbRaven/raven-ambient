/**
 * 探针：票根上的「移出」到底能不能真的移出去。
 *
 * 用户 m08501 的原话是「怎么只能删除文件夹不能单个的删除文件啊，而且图片完全
 * 没法删除」。修法分三处：条目上挂按钮、`App.forgetMediaItem` 过滤收藏、主进程
 * 撤掉那份文件授权。三处任何一处漏了，界面上都会**看不出差别**——
 *   - 只删界面不撤授权 → 条目没了，但 `media://` 仍然读得到那个文件；
 *   - 只撤授权不删收藏 → 下次启动重新扫码，条目又回来了；
 *   - 按钮没接上 → 点了什么都不发生，也不报错。
 * 所以必须起真窗口、点真按钮、再回读台账。
 *
 * 三种场景（对应用户说的「文件夹里的」和「单独导入的」两种来源）：
 *   1. 文件夹里的条目移出 → 条目消失，目录授权**必须留着**（否则那个文件夹里
 *      剩下的东西一起废掉）；
 *   2. 单独导入的条目移出 → 条目消失，那条文件授权被撤（它没有目录兜底）；
 *   3. 两次点击才算数：第一次只上膛（条目还在、按钮变 armed），第二次才删。
 *      另外浮层里删完必须自己关掉，否则用户看到一张已经不在的票。
 *
 * 台账路径：`harness.cjs` 把 userData 指到 mkdtemp，所以自己算一遍
 * `app.getPath('userData')/media-grants.json` 去读。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launch, guard, report, wait, MEDIA_DIR } = require('./harness.cjs');

/** 两张「单独导入」的图：不在 MEDIA_DIR 里，模拟用户从别处单张拖进来的文件。 */
const LOOSE_DIR = path.join(os.tmpdir(), 'probe-loose');
const LOOSE_A = path.join(LOOSE_DIR, 'SOLO ONE.png');
const LOOSE_B = path.join(LOOSE_DIR, 'SOLO TWO.png');

/** 造图。没有这两个文件就生成纯色块，有就复用。 */
function ensureLoose() {
  fs.mkdirSync(LOOSE_DIR, { recursive: true });
  const jobs = [
    [LOOSE_A, '0x6a7a86'],
    [LOOSE_B, '0x86735f'],
  ];
  for (const [file, color] of jobs) {
    if (fs.existsSync(file)) continue;
    require('node:child_process').execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${color}:s=1200x800:d=1`,
      '-frames:v', '1', file,
    ]);
  }
}

/** 读主进程台账（`userData/media-grants.json`）。文件不存在时给空集合。 */
function readGrants() {
  const file = path.join(require('electron').app.getPath('userData'), 'media-grants.json');
  if (!fs.existsSync(file)) return { dirs: [], files: [], file };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      dirs: Array.isArray(raw.dirs) ? raw.dirs : [],
      files: Array.isArray(raw.files) ? raw.files : [],
      file,
    };
  } catch {
    return { dirs: [], files: [], file, broken: true };
  }
}

/** 页面上所有票根的标题，按列表顺序。 */
const TITLES = `(() => [...document.querySelectorAll('.ticket-grid > li')]
  .map(li => {
    const shot = li.querySelector('.ticket');
    return (shot?.getAttribute('aria-label') || shot?.textContent || '').trim();
  }))()`;

/** 上膛并删除第 n 张（0 基）。返回两次点击之间与之后的现场。 */
const forgetAt = index => `(async () => {
  const lis = [...document.querySelectorAll('.ticket-grid > li')];
  const li = lis[${index}];
  if (!li) return { missing: true };
  const button = li.querySelector('.ticket-remove');
  if (!button) return { noButton: true };

  const before = {
    count: lis.length,
    opacity: getComputedStyle(button).opacity,
    pointer: getComputedStyle(button).pointerEvents,
    label: button.getAttribute('aria-label'),
    armed: button.classList.contains('armed'),
  };

  button.click();
  await new Promise(r => setTimeout(r, 260));
  const armedButton = [...document.querySelectorAll('.ticket-grid > li')][${index}]
    ?.querySelector('.ticket-remove');
  const armed = {
    count: document.querySelectorAll('.ticket-grid > li').length,
    armed: armedButton?.classList.contains('armed') ?? null,
    label: armedButton?.getAttribute('aria-label') ?? null,
    opacity: armedButton ? getComputedStyle(armedButton).opacity : null,
  };

  return { before, armed };
})()`;

/** 对第 n 张点第二次（真的删）。 */
const confirmAt = index => `(async () => {
  const lis = [...document.querySelectorAll('.ticket-grid > li')];
  const li = lis[${index}];
  if (!li) return { missing: true };
  const button = li.querySelector('.ticket-remove');
  if (!button) return { noButton: true };
  const label = button.getAttribute('aria-label');
  button.click();
  await new Promise(r => setTimeout(r, 420));
  return {
    label,
    count: document.querySelectorAll('.ticket-grid > li').length,
    armedLeft: document.querySelectorAll('.ticket-grid .ticket-remove.armed').length,
  };
})()`;

guard(async () => {
  ensureLoose();

  // 两条来自文件夹（MEDIA_DIR，已 allowDir），两条单独导入（没有目录兜底）。
  // `mediaDirs` 只写 MEDIA_DIR：这正是 App 的 'files' 分支做完之后的样子——
  // 单独导入的文件在 media 里，但不在 mediaDirs 里。
  const media = [
    { id: 'image:1', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Folder One', size: 1 },
    { id: 'image:2', kind: 'image', path: LOOSE_A, name: 'Solo One', size: 1 },
    { id: 'image:3', kind: 'image', path: LOOSE_B, name: 'Solo Two', size: 1 },
  ];

  const probe = await launch({
    width: 680, height: 980, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run } = probe;
  const out = { steps: [] };

  // 先让主进程认得这两张散图（等价于用户当初「导入」时走的那一步）
  const { allowFile } = require('../../electron/media.cjs');
  allowFile(LOOSE_A);
  allowFile(LOOSE_B);

  out.grantsBefore = readGrants();
  out.titlesBefore = await run(TITLES);

  // ---- 场景 1：文件夹里的条目，第一次点击只上膛
  out.step1 = await run(forgetAt(0));
  // ---- 第二次点击才真删
  out.step1done = await run(confirmAt(0));
  await wait(500);
  out.grantsAfterFolder = readGrants();
  out.titlesAfterFolder = await run(TITLES);

  // ---- 场景 2：单独导入的条目（现在索引 0 是原来第 2 条）
  out.step2 = await run(forgetAt(0));
  out.step2done = await run(confirmAt(0));
  await wait(500);
  out.grantsAfterLoose = readGrants();
  out.titlesAfterLoose = await run(TITLES);

  // ---- 场景 3：浮层里删。删完浮层必须自己关，否则用户看到一张已经不存在的票
  out.step3 = await run(`(async () => {
    const li = document.querySelector('.ticket-grid > li');
    if (!li) return { missing: true };
    li.querySelector('.ticket')?.click();
    await new Promise(r => setTimeout(r, 900));
    const stage = document.querySelector('.ticket-stage');
    const button = stage?.querySelector(':scope > .ticket-remove');
    if (!button) return { noStage: !stage, noButton: true, stageClass: stage?.className ?? null };
    const opened = {
      stage: true,
      label: button.getAttribute('aria-label'),
      text: button.textContent.trim(),
      count: document.querySelectorAll('.ticket-grid > li').length,
    };
    button.click();
    await new Promise(r => setTimeout(r, 280));
    const armed = {
      armed: button.classList.contains('armed'),
      label: button.getAttribute('aria-label'),
      text: button.textContent.trim(),
    };
    button.click();
    await new Promise(r => setTimeout(r, 700));
    return {
      opened, armed,
      stageGone: !document.querySelector('.ticket-stage'),
      count: document.querySelectorAll('.ticket-grid > li').length,
    };
  })()`);
  await wait(400);
  out.grantsAfterStage = readGrants();
  out.titlesAfterStage = await run(TITLES);

  report(out);
});
