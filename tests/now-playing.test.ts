import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appLabel, emptyNowPlaying, hasTrack, parseNowPlaying, playbackHint, trackSubtitle,
  type NowPlaying,
} from '../src/now-playing.ts';

const track = (patch: Partial<NowPlaying> = {}): NowPlaying => ({ ...emptyNowPlaying, ...patch });

test('认得的播放器给中文名，认不出的原样显示文件名', () => {
  assert.equal(appLabel('cloudmusic.exe'), '网易云音乐');
  assert.equal(appLabel('QQMusic.exe'), 'QQ 音乐');
  assert.equal(appLabel('Spotify.exe'), 'Spotify');
  assert.equal(appLabel('SomeNewPlayer.exe'), 'SomeNewPlayer');
  assert.equal(appLabel(''), '');
});

test('可执行名带前缀也能认出来（Chromium 打包的播放器常见）', () => {
  assert.equal(appLabel('NetEase.CloudMusic.exe'), '网易云音乐');
});

test('没有标题就算没在放，空白字符串也不算', () => {
  assert.equal(hasTrack(track()), false);
  assert.equal(hasTrack(track({ title: '   ' })), false);
  assert.equal(hasTrack(track({ title: 'Final Touch' })), true);
});

test('副标题按「歌手 · 播放器」拼，缺一半就不留空当', () => {
  assert.equal(trackSubtitle(track({ title: 'A', artist: 'Ef', app: 'cloudmusic.exe' })), 'Ef · 网易云音乐');
  assert.equal(trackSubtitle(track({ title: 'A', artist: 'Ef' })), 'Ef');
  assert.equal(trackSubtitle(track({ title: 'A', app: 'cloudmusic.exe' })), '网易云音乐');
  assert.equal(trackSubtitle(track({ title: 'A', artist: ' ', app: 'cloudmusic.exe' })), '网易云音乐');
});

test('只在暂停或停止时给提示，正在放的时候不打扰', () => {
  assert.equal(playbackHint(track({ title: 'A', status: 'Playing' })), '');
  assert.equal(playbackHint(track({ title: 'A', status: 'Paused' })), '已暂停');
  assert.equal(playbackHint(track({ title: 'A', status: 'Stopped' })), '已停止');
  assert.equal(playbackHint(track()), '');
});

test('解析原始 JSON：字段缺失不炸，playing 以 status 为准', () => {
  const parsed = parseNowPlaying({
    app: 'cloudmusic.exe', title: 'Final Touch', artist: 'Ef',
    status: 'Playing', playing: false, cover: 'data:image/jpeg;base64,AAAA',
  });
  assert.equal(parsed.title, 'Final Touch');
  assert.equal(parsed.playing, true, 'playing 应该跟着 status 走，别被上游的布尔值带偏');
  assert.equal(parsed.cover, 'data:image/jpeg;base64,AAAA');

  const bare = parseNowPlaying({ title: '只有标题' });
  assert.equal(bare.title, '只有标题');
  assert.equal(bare.status, 'None');
  assert.equal(bare.playing, false);
  assert.equal(bare.cover, '');
});

test('非对象输入一律当成空快照，不抛错', () => {
  assert.deepEqual(parseNowPlaying(null), emptyNowPlaying);
  assert.deepEqual(parseNowPlaying(undefined), emptyNowPlaying);
  assert.deepEqual(parseNowPlaying('字符串'), emptyNowPlaying);
  assert.deepEqual(parseNowPlaying(42), emptyNowPlaying);
});

test('只接受 data:image 封面，别的东西不能塞进 img 的 src', () => {
  assert.equal(parseNowPlaying({ cover: 'https://example.com/x.jpg' }).cover, '');
  assert.equal(parseNowPlaying({ cover: 'javascript:alert(1)' }).cover, '');
  assert.equal(parseNowPlaying({ cover: 'data:text/html;base64,AAAA' }).cover, '');
  assert.equal(parseNowPlaying({ cover: 'data:image/png;base64,BBBB' }).cover, 'data:image/png;base64,BBBB');
});
