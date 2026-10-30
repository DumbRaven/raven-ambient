import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AmbientEngine } from '../src/audio.ts';
import { RoomPlayer } from '../src/player.ts';
import { emptyCabinet, sanitizeCabinet } from '../src/records.ts';
import { useStore } from '../src/store.ts';
import { Context, Media, flushUntil, installAudio } from './helpers/audio-stubs.ts';

const rec = (id: string, category = 'music') => ({ id, assetId: id, name: id, artist: 'fixture', category, size: 1, fingerprint: id });
const cabinet = () => sanitizeCabinet({ ...emptyCabinet, records: [rec('a'), rec('b'), rec('rain', 'ambient')], queue: ['a', 'b'], ambience: ['rain'], transition: 'crossfade' });
function memory() { useStore({ name: 'preview-tests', getText: () => null, setText() {}, removeText() {}, readBlob: async () => new Blob(['fixture']), writeBlob: async () => {} }); }

test('试听用独立的声音，不占主唱盘', async t => {
  installAudio(t); memory();
  const engine = new AmbientEngine(); t.after(() => engine.dispose());
  await engine.loadMusic(new Blob(['x']));
  const decks = (engine as unknown as { decks: { el: Media }[] }).decks;
  const before = decks.map(deck => deck.el);
  assert.equal(before.length, 2, '主唱盘是两块');
  await engine.preview(new Blob(['y']));
  const made = Media.created[Media.created.length - 1];
  // 试听新建的是一个独立元素，两块唱盘都没被换掉
  assert.ok(!before.includes(made), '试听不该占用主唱盘的元素');
  assert.deepEqual(decks.map(deck => deck.el), before, '两块唱盘原样不动');
});

test('试听从 10% 处起播，到点自己停并通知一次', async t => {
  installAudio(t); memory();
  const engine = new AmbientEngine(); t.after(() => engine.dispose());
  let ended = 0;
  engine.onPreviewEnded(() => { ended += 1; });
  await engine.preview(new Blob(['x']), 8);
  const el = Media.created[Media.created.length - 1];
  assert.equal(el.currentTime, 6, '时长 60 秒，从 6 秒处起播');
  assert.equal(el.paused, false);
  t.mock.timers.tick(8000);
  t.mock.timers.tick(200);
  assert.equal(ended, 1);
});

test('试听期间环境音让到三成，停下后回到原样', async t => {
  installAudio(t); memory();
  const engine = new AmbientEngine(); t.after(() => engine.dispose());
  await engine.preview(new Blob(['x']));
  const ambient = (engine as unknown as { ambient: { gain: { value: number } } }).ambient;
  assert.ok(ambient.gain.value < 1, '试听时环境音被压低');
  engine.stopPreview();
  assert.equal(ambient.gain.value, 1);
});

test('再点一次停止，不会留下第二份试听', async t => {
  installAudio(t); memory();
  const engine = new AmbientEngine(); t.after(() => engine.dispose());
  let ended = 0;
  engine.onPreviewEnded(() => { ended += 1; });
  await engine.preview(new Blob(['x']));
  const first = Media.created[Media.created.length - 1];
  engine.stopPreview();
  await engine.preview(new Blob(['y']));
  t.mock.timers.tick(10000);
  assert.equal(ended, 2, '第一次停一次、第二次到点停一次');
  assert.equal(first.paused, true);
});

test('试听时暂停当前音乐，停下后把那一首接着放', async t => {
  installAudio(t); memory(); let status: any;
  const player = new RoomPlayer(cabinet(), s => { status = s; }, assert.fail);
  t.after(() => player.dispose());
  player.start(); await (player as unknown as { pending: Promise<void> }).pending;
  assert.equal(status.musicPlaying, true);
  await player.preview('b');
  assert.equal(status.musicPlaying, false, '试听期间音乐让开');
  player.stopPreview();
  // stopPreview 先淡出 120ms 再收尾，桩里的定时器是假的，得手动推进；
  // 恢复播放走的是 engine.playMusic()，不挂在 player.pending 上，得轮询等它落地。
  t.mock.timers.tick(200);
  await flushUntil(() => status.musicPlaying === true);
  assert.equal(status.musicPlaying, true, '试听结束，原来的那一首继续');
});

test('本来就没在放音乐时，试听完也不该自己响起来', async t => {
  installAudio(t); memory(); let status: any;
  const player = new RoomPlayer(cabinet(), s => { status = s; }, assert.fail);
  t.after(() => player.dispose());
  await player.preview('b');
  player.stopPreview();
  await Promise.resolve();
  assert.equal(status.musicPlaying, false);
});

test('找不到唱片文件时报错，而不是静默无声', async t => {
  installAudio(t);
  useStore({ name: 'empty', getText: () => null, setText() {}, removeText() {}, readBlob: async () => undefined, writeBlob: async () => {} });
  const player = new RoomPlayer(cabinet(), () => undefined, assert.fail);
  t.after(() => player.dispose());
  await assert.rejects(() => player.preview('b'), /找不到/);
});

test('暂停整体播放会顺手掐掉试听', async t => {
  installAudio(t); memory();
  const player = new RoomPlayer(cabinet(), () => undefined, assert.fail);
  t.after(() => player.dispose());
  await player.preview('b');
  const el = Media.created[Media.created.length - 1];
  player.pause();
  t.mock.timers.tick(200);
  assert.equal(el.paused, true);
});
