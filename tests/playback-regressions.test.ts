import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AmbientEngine } from '../src/audio.ts';
import { RoomPlayer } from '../src/player.ts';
import { emptyCabinet, sanitizeCabinet, cabinetMix } from '../src/records.ts';
import { useStore } from '../src/store.ts';
import { Context, Media, deferred, installAudio, flushUntil } from './helpers/audio-stubs.ts';

const rec = (id: string, category = 'music') => ({ id, assetId: id, name: id, artist: 'fixture', category, size: 1, fingerprint: id });
const cabinet = () => sanitizeCabinet({ ...emptyCabinet, records: [rec('a'), rec('b'), rec('c'), rec('rain', 'ambient')], queue: ['a', 'b', 'c'], ambience: ['rain'], transition: 'crossfade' });
function memory() { useStore({ name: 'audio-tests', getText: () => null, setText() {}, removeText() {}, readBlob: async () => new Blob(['fixture']), writeBlob: async () => {} }); }
// Intentionally inspect decks and queue completion: the regression is in real engine scheduling.
const inspect = (value: unknown): any => value;

for (const channel of ['Music', 'Ambient'] as const) test(`停止时点击 ${channel} 只开启所点通道；总暂停后亦然`, async t => {
  installAudio(t); memory(); let status: any; const errors: unknown[] = [];
  const player = new RoomPlayer(cabinet(), s => { status = s; }, e => errors.push(e)); t.after(() => player.dispose());
  for (let repeat = 0; repeat < 2; repeat++) {
    player[`toggle${channel}`](); await inspect(player).pending;
    assert.equal(status.running, true); assert.equal(status.musicPlaying, channel === 'Music'); assert.equal(status.playing, channel === 'Ambient');
    player.pause();
  }
  assert.deepEqual(errors, []);
});
test('只有音乐时通道按钮能启动，两路关闭后总播放恢复所选声音', async t => {
  installAudio(t); memory(); let status: any;
  const player = new RoomPlayer({ ...cabinet(), ambience: [] }, s => { status = s; }, assert.fail); t.after(() => player.dispose());
  player.toggleMusic(); await inspect(player).pending; assert.equal(status.musicPlaying, true);
  player.toggleMusic(); assert.equal(status.running, false);
  player.start(); await inspect(player).pending; assert.equal(status.musicPlaying, true);
});
test('换歌等元数据时总暂停：取消等待，旧请求不能恢复播放', async t => {
  installAudio(t); memory(); let status: any;
  const player = new RoomPlayer(cabinet(), s => { status = s; }, assert.fail); t.after(() => player.dispose());
  player.start(); await inspect(player).pending;
  const next = Media.created[1]; next.deferMetadata = true;
  player.next(); await flushUntil(() => next.waiting);
  player.pause(); await inspect(player).pending;
  next.ready(); await Promise.resolve();
  assert.equal(status.running, false); assert.equal(status.musicPlaying, false);
  assert.ok(Media.created.every(media => media.paused));
  next.deferMetadata = false; player.start(); await inspect(player).pending;
  assert.equal(status.currentId, 'b'); assert.equal(status.musicPlaying, true);
});
test('等待环境音解码时关闭音乐通道会立刻停掉旧音乐', async t => {
  installAudio(t); memory(); let status: any;
  const base = cabinet(), player = new RoomPlayer({ ...base, ambience: [] }, s => { status = s; }, assert.fail); t.after(() => player.dispose());
  player.start(); await inspect(player).pending;
  Context.current.decodeGate = deferred(); player.update(base);
  await flushUntil(() => Context.current.decodes === 1);
  player.toggleMusic(); assert.ok(Media.created.every(media => media.paused));
  Context.current.decodeGate.resolve(); await inspect(player).pending;
  assert.equal(status.musicPlaying, false); assert.equal(status.playing, true);
});
test('环境音 resume 尚未结束时暂停，随后不能创建声部', async t => {
  installAudio(t); memory(); const engine = new AmbientEngine(); t.after(() => engine.dispose());
  await engine.loadMusic(new Blob(['init'])); Context.current.resumeGate = deferred();
  const pending = engine.start(cabinetMix(cabinet())); engine.stopAll();
  Context.current.resumeGate.resolve(); await pending;
  assert.equal(Context.current.sources.length, 0); assert.equal(Context.current.decodes, 0);
});
for (const mode of ['load', 'swap', 'play'] as const) test(`${mode} 的异步播放/加载被暂停后不会复活`, async t => {
  installAudio(t); const engine = new AmbientEngine(); t.after(() => engine.dispose());
  await engine.loadMusic(new Blob(['a'])); await engine.playMusic();
  let pending: Promise<unknown>;
  if (mode === 'load') {
    Media.created[0].deferMetadata = true; pending = engine.loadMusic(new Blob(['b']));
    await flushUntil(() => Media.created[0].waiting); engine.pauseMusic();
  } else {
    const media = Media.created[mode === 'swap' ? 1 : 0]; media.playRequested = false; media.playGate = deferred();
    pending = mode === 'swap' ? engine.swapMusic(new Blob(['b']), 'crossfade', 1) : engine.playMusic();
    await flushUntil(() => media.playRequested); engine.pauseMusic(); media.playGate.resolve();
  }
  await pending;
  assert.ok(Media.created.every(media => media.paused));
  assert.ok(inspect(engine).decks.every((deck: any) => deck.gain.gain.value === 0));
});
test('交叉淡化中暂停会同时停两块唱盘并撤销延迟任务', async t => {
  installAudio(t); const engine = new AmbientEngine(); t.after(() => engine.dispose());
  await engine.loadMusic(new Blob(['a'])); await engine.playMusic(); await engine.swapMusic(new Blob(['b']), 'crossfade', 1);
  assert.ok(Media.created.every(media => !media.paused)); engine.pauseMusic();
  assert.ok(Media.created.every(media => media.paused));
  assert.ok(inspect(engine).decks.every((deck: any) => !deck.gain.gain.events.some((event: any) => event.kind === 'ramp')));
  await engine.playMusic(); t.mock.timers.tick(1100); assert.equal(Media.created[1].paused, false);
});
test('快速连续换歌的旧定时器不会提前停掉新一轮淡出', async t => {
  installAudio(t); const engine = new AmbientEngine(); t.after(() => engine.dispose());
  await engine.loadMusic(new Blob(['a'])); await engine.playMusic();
  await engine.swapMusic(new Blob(['b']), 'crossfade', 1); t.mock.timers.tick(200);
  await engine.swapMusic(new Blob(['c']), 'crossfade', 1); t.mock.timers.tick(200);
  await engine.swapMusic(new Blob(['d']), 'crossfade', 1); t.mock.timers.tick(650);
  assert.equal(Media.created[0].paused, false, 'A 的最早清理时刻已过，新的淡出还应继续');
  t.mock.timers.tick(400); assert.equal(Media.created[0].paused, true); assert.equal(Media.created[1].paused, false);
});
test('直接切歌会停止前一次过渡遗留的唱盘', async t => {
  installAudio(t); const engine = new AmbientEngine(); t.after(() => engine.dispose());
  await engine.loadMusic(new Blob(['a'])); await engine.playMusic(); await engine.swapMusic(new Blob(['b']), 'crossfade', 1);
  await engine.loadMusic(new Blob(['c'])); await engine.playMusic();
  assert.equal(Media.created.filter(media => !media.paused).length, 1);
});
test('卸载中断元数据等待，晚到的事件不再播放或创建定时器', async t => {
  installAudio(t); const engine = new AmbientEngine();
  await engine.loadMusic(new Blob(['a'])); Media.created[1].deferMetadata = true;
  const pending = engine.swapMusic(new Blob(['b']), 'crossfade', 1); await flushUntil(() => Media.created[1].waiting);
  engine.dispose(); await pending; Media.created[1].ready();
  assert.ok(Media.created.every(media => media.paused)); assert.equal(inspect(engine).timer, undefined);
});
test('空闲时停止轮询，同样状态不重复通知；恢复播放会重启', async t => {
  installAudio(t); const engine = new AmbientEngine(); t.after(() => engine.dispose());
  // loadMusic 现在会直接开始播（省掉「等元数据再 play」那段延迟），
  // 所以先手动暂停回空闲态，才能验证「空闲时不再轮询」这件事本身。
  await engine.loadMusic(new Blob(['a'])); engine.pauseMusic();
  let count = 0; engine.subscribe(() => count++);
  const before = count; for (let i = 0; i < 25; i++) inspect(engine).tick();
  assert.equal(count, before); assert.equal(inspect(engine).timer, undefined);
  await engine.playMusic(); assert.notEqual(inspect(engine).timer, undefined);
  engine.pauseMusic(); assert.equal(inspect(engine).timer, undefined);
});
test('多路环境音并发解码有上限，重复调度不会重解正在播放的声部', async t => {
  installAudio(t); memory(); const engine = new AmbientEngine(); t.after(() => engine.dispose());
  const mix = cabinetMix(cabinet()); mix.tracks.push({ ...mix.tracks[0], id: 'second' });
  await engine.start(mix); await engine.start(mix);
  // 解码改成 3 路并发后不再是串行，但仍有上限，不能无限铺开
  assert.ok(Context.current.maxDecodes > 1 && Context.current.maxDecodes <= 3, `并发上限应在 2–3 之间，实际 ${Context.current.maxDecodes}`);
  // 重复调度只解新声部，已经在播的不重解
  assert.equal(Context.current.decodes, 2);
});
test('浏览器晚送达的 pause 事件不能把已恢复播放标成暂停', async t => {
  installAudio(t); const engine = new AmbientEngine(); t.after(() => engine.dispose()); let status: any;
  engine.subscribe(value => { status = value; });
  await engine.loadMusic(new Blob(['a'])); await engine.playMusic();
  engine.pauseMusic(); await engine.playMusic(); Media.created[0].dispatchEvent(new Event('pause'));
  assert.equal(status.musicPlaying, true); assert.equal(Media.created[0].paused, false);
});

test('顺序播放接下一首：新的一首真的播起来，不是装上就停着', async t => {
  installAudio(t); memory(); let status: any;
  const player = new RoomPlayer(cabinet(), s => { status = s; }, assert.fail);
  t.after(() => player.dispose());
  player.start(); await inspect(player).pending;
  assert.equal(status.currentId, 'a');
  const deck = Media.created[0];
  assert.equal(deck.paused, false, '第一首应该在放');
  // 放完：引擎发 ended，播放器接下一首，走的正是 loadMusic 这条路
  deck.dispatchEvent(new Event('ended'));
  await inspect(player).pending;
  assert.equal(status.currentId, 'b');
  assert.equal(status.musicPlaying, true, '第二首应该已经在响');
  assert.equal(deck.paused, false, '接上的这一首不该停在暂停态');
});

test('一张唱片的文件读不出来：只停音乐，环境音继续流动', async t => {
  installAudio(t);
  // 让 'b' 的资产读不到，模拟用户把那个 mp3 删了。
  // broken 是个可变集合，后面要能「把文件补回来」再验一次。
  let restoreBlob: (key: string) => void = () => {};
  const missing = new Set(['b']);
  useStore({
    name: 'audio-tests', getText: () => null, setText() {}, removeText() {},
    readBlob: async (key: string) => (missing.has(key) ? undefined : new Blob(['fixture'])),
    writeBlob: async () => {},
  });
  restoreBlob = (key: string) => missing.delete(key);
  let status: any; const errors: unknown[] = [];
  const player = new RoomPlayer(cabinet(), s => { status = s; }, e => errors.push(e));
  t.after(() => player.dispose());
  player.start(); await inspect(player).pending;
  const ambientSources = () => Context.current.sources.length;

  assert.equal(status.currentId, 'a');
  assert.equal(status.musicPlaying, true);
  assert.ok(ambientSources() > 0, '环境音应该已经起来了');

  const before = ambientSources();
  // 切到那张坏唱片
  player.next(); await inspect(player).pending;

  // 关键：不能因为一首歌没了就把整间屋子关掉
  assert.equal(status.running, true, '总播放不该停');
  assert.equal(status.playing, true, '环境音应该还在响');
  assert.equal(ambientSources(), before, '环境音声部一个都不该被撤掉');
  assert.equal(status.musicPlaying, false, '音乐这一路要停下来');
  assert.equal(errors.length, 1, '要报一次错，不能静默');
  // 跳过了坏的那张，落在下一张好唱片上
  assert.equal(status.currentId, 'c');

  // 再点一次同一首：坏标记要清掉，不能永远跳过。
  // 这次让文件「修好了」，模拟用户把 mp3 放回原位。
  restoreBlob('b');
  player.playRecord('b'); await inspect(player).pending;
  assert.equal(status.currentId, 'b', '文件补回来后该能正常播这一张');
  assert.equal(status.musicPlaying, true, '补回来之后音乐要真的响');
});
test('文件补回来之后，按播放键或切下一首就能重新试一遍', async t => {
  // 拔掉移动硬盘又插回来，是这类问题最常见的真实形态：
  // 整条队列都被标成「读不出来」，用户按播放键想重试——必须真的重试。
  // 以前只有「点那张唱片本身」能清标记，按播放键和下一首都无反应，
  // 因为 wantsMusic() 先返回假，schedule() 连读文件那一步都走不到。
  installAudio(t);
  const missing = new Set(['a', 'b', 'c']);
  useStore({
    name: 'audio-tests', getText: () => null, setText() {}, removeText() {},
    readBlob: async (key: string) => (missing.has(key) ? undefined : new Blob(['fixture'])),
    writeBlob: async () => {},
  });
  let status: any; const errors: unknown[] = [];
  const player = new RoomPlayer(cabinet(), s => { status = s; }, e => errors.push(e));
  t.after(() => player.dispose());

  // skipBroken 每失败一张就递归排下一次，pending 会被替换成新的 promise，
  // 所以要多等几轮才拿到最终状态。
  player.start(); for (let i = 0; i < 5; i++) await inspect(player).pending;
  // 三首全坏：音乐停掉，环境音不受牵连
  assert.equal(status.musicPlaying, false);
  assert.equal(status.playing, true, '环境音不该被连累');
  assert.equal(errors.length, 3, '每一张读不出来都该说一声');

  // 硬盘插回来
  for (const id of missing) missing.delete(id);
  errors.length = 0;
  player.start(); await inspect(player).pending;
  assert.equal(status.musicPlaying, true, '按播放键必须能重新读到文件');
  assert.deepEqual(errors, []);
});

test('环境音起不来不能把正在正常播放的歌记成坏文件', async t => {
  // 以前环境音和音乐共用一个 catch：engine.start() 抛错也走 skipBroken()，
  // 而它第一行就把当前正在播的歌记进 broken —— 一首好歌被冤枉成文件丢失。
  installAudio(t); memory();
  let status: any; const errors: unknown[] = [];
  const player = new RoomPlayer(cabinet(), s => { status = s; }, e => errors.push(e));
  t.after(() => player.dispose());
  const engine = inspect(player).engine as { start: (mix: unknown) => Promise<void> };

  player.start(); await inspect(player).pending;
  assert.equal(status.musicPlaying, true);

  // 让环境音这一路单独失败，模拟某个环境音文件解码不了
  const original = engine.start.bind(engine);
  engine.start = async () => { throw new Error('decode failed'); };
  player.toggleAmbient(); player.toggleAmbient();
  await inspect(player).pending;
  engine.start = original;

  assert.equal(status.musicPlaying, true, '环境音失败不该停掉音乐');
  assert.equal(status.currentId, 'a', '正在播的那首不能被换掉');
  assert.ok(errors.length >= 1, '环境音失败也要说出来');
});

test('连着试听两张：中间不该把背景音乐放出来', async t => {
  // 换段时 engine.preview() 第一件事就是 stopPreview()，它会同步触发
  // previewEnded → restoreAfterPreview → playMusic()。于是「点第二张试听」
  // 这个动作会先把背景音乐唤醒，试听和音乐同时响。
  installAudio(t); memory();
  let status: any;
  const player = new RoomPlayer(cabinet(), s => { status = s; }, () => {});
  t.after(() => player.dispose());

  player.start(); await inspect(player).pending;
  assert.equal(status.musicPlaying, true, '前置条件：音乐在放');

  await player.preview('a');
  assert.equal(status.musicPlaying, false, '试听期间音乐该停');

  // 换第二张：这一步不能把音乐放出来
  await player.preview('b');
  assert.equal(status.musicPlaying, false, '换段中间不能放出背景音乐');

  // 真正停下之后，才按原样恢复
  player.stopPreview();
  // playMusic 是 fire-and-forget，不在这条 pending 链上，等它落地。
  await flushUntil(() => status.musicPlaying);
  assert.equal(status.musicPlaying, true, '试听结束后音乐恢复');
});

test('试听读到一半按了总暂停，声音不许冒出来', async t => {
  installAudio(t); memory();
  let status: any;
  const player = new RoomPlayer(cabinet(), s => { status = s; }, () => {});
  t.after(() => player.dispose());
  player.start(); await inspect(player).pending;

  // 不 await：让 preview 卡在 await readAsset 之后
  const pending = player.preview('a');
  player.pause();
  await pending;
  await inspect(player).pending;

  const live = Media.created.filter(el => !el.paused);
  assert.deepEqual(live, [], '总暂停之后不该有任何元素还在播');
});
