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
  await engine.loadMusic(new Blob(['a'])); let count = 0; engine.subscribe(() => count++);
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
