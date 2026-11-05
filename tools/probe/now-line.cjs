/**
 * 放映页「此刻」两行字的探针。
 *
 * 它要回答三件事：
 *   1. 信息条 PLAYLIST 写的是不是真的在响的那一首（而不是画面文件名）；
 *   2. 本地模式写「唱片名 · 艺人」，外部模式写「歌名 · 歌手 · 播放器」；
 *   3. 面板主标题换成了时段词，不再是画面文件名。
 *
 * 两种模式在同一个窗口里切：`close()` 是直接 app.exit(0)，
 * 调一次进程就没了，所以不能「起两个窗口」。改成写完 localStorage 再 reload。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/now-line.cjs --no-sandbox
 */
const path = require('node:path');
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');

/**
 * 一张「正在播放」的音乐唱片 + 一张环境音。
 * 画面文件名故意叫 Ocean，和唱片名 DROWNED DUSK 不同——
 * 两者一旦混起来，读数立刻能看出来。
 */
const record = (id, name, category, artist) => ({
  id,
  assetId: `asset:${id}`,
  name,
  artist,
  description: '',
  category,
  duration: 600,
  format: 'WAV',
  size: 1,
  color: '#4b5a66',
  fingerprint: id,
  volume: 60,
  pan: 0,
  warmth: 0,
  duckDepth: 12,
});

const cabinet = {
  records: [
    record('music:1', 'DROWNED DUSK', 'music', 'DumbRaven'),
    record('ambient:rain', 'Rain', 'ambient', 'Field Recording'),
  ],
  queue: ['music:1'],
  ambience: ['ambient:rain'],
  muted: [],
  lineMode: false,
  media: [{ id: 'image:1', kind: 'image', path: path.join(MEDIA_DIR, 'DROWNED DUSK.png'), name: 'Ocean', size: 1 }],
  mediaDirs: [MEDIA_DIR],
};

const MEASURE = `(() => {
  const text = sel => document.querySelector(sel)?.textContent ?? null;
  return {
    playlist: text('.tpl-block-bar .tpl-list span'),
    // 信息条 TITLE 那一格仍然是画面名——它问的就是「这一页是什么」
    titleField: text('.tpl-block-bar .tpl-fields > div:first-child span'),
    heading: text('.tpl-title-text'),
    subA: text('.tpl-sub'),
    // 面板主标题不该再等于画面文件名，PLAYLIST 也不该等于它
    headingIsFileName: text('.tpl-title-text') === 'Ocean',
    playlistIsFileName: text('.tpl-block-bar .tpl-list span') === 'Ocean',
  };
})()`;

const ENTER = `(() => {
  [...document.querySelectorAll('.view-tabs > button')]
    .find(b => b.getAttribute('aria-label') === '放映')?.click();
  return 1;
})()`;

const EXPAND = `(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`;

/** 重载后重新进放映页并全屏。 */
async function reenter(probe) {
  probe.win.webContents.reload();
  await wait(2600);
  await probe.run(ENTER);
  await wait(1600);
  await probe.run(EXPAND);
  await wait(1400);
}

guard(async () => {
  const probe = await launch({ expand: true, patch: cabinet });
  await wait(500);

  // 本地模式：探针里没有音频引擎在跑，currentId 是空的，
  // 所以 PLAYLIST 应当留空而不是瞎写一个画面文件名。
  // 「本地模式在放的时候写什么」由 tests/stage-text.test.ts 覆盖。
  const localIdle = await probe.run(MEASURE);

  // 切到外部音乐模式。**必须从当前 localStorage 读出来再改**，不能用常量重建：
  // cabinet 里还有 version 这类字段，缺了会被 sanitizeCabinet 当成旧数据丢掉，
  // 媒体库跟着一起没了，页面退回空库分支——那时连画面都是占位块。
  await probe.run(`(() => {
    const cur = JSON.parse(localStorage.getItem('raven-cabinet-v2'));
    localStorage.setItem('raven-cabinet-v2', JSON.stringify(Object.assign({}, cur, { lineMode: true })));
    return 1;
  })()`);
  await reenter(probe);
  await probe.run(`(() => {
    window.__ravenNowPlaying?.({
      app: 'cloudmusic.exe', title: 'Ab Ovo', artist: 'Joep Beving',
      album: 'Solipsism', status: 'Playing', playing: true, cover: '',
    });
    return 1;
  })()`);
  await wait(400);
  const external = await probe.run(MEASURE);

  // 暂停之后应当补一句「已暂停」，否则一行字看不出声音是停的。
  await probe.run(`(() => {
    window.__ravenNowPlaying?.({
      app: 'cloudmusic.exe', title: 'Ab Ovo', artist: 'Joep Beving',
      album: 'Solipsism', status: 'Paused', playing: false, cover: '',
    });
    return 1;
  })()`);
  await wait(400);
  const paused = await probe.run(MEASURE);

  await probe.shot(path.join(__dirname, 'now-line.png'));

  report({ localIdle, external, paused });
});
