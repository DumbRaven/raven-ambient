import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, nowDetail, nowLine, timeOfDay } from '../src/stage-text.ts';

test('时段词按本机时钟切四段', () => {
  const at = (hour: number) => timeOfDay(new Date(2026, 10, 5, hour, 30));
  assert.equal(at(0), 'Late Night');
  assert.equal(at(4), 'Late Night');
  assert.equal(at(5), 'Morning');
  assert.equal(at(11), 'Morning');
  assert.equal(at(12), 'Afternoon');
  assert.equal(at(17), 'Afternoon');
  assert.equal(at(18), 'Evening');
  assert.equal(at(23), 'Evening');
});

test('没有在放的东西时 PLAYLIST 那行是空的，不留破折号', () => {
  assert.equal(nowLine(null), '');
  assert.equal(nowLine(undefined), '');
});

test('本地模式写唱片名和艺人，不写播放器名', () => {
  const line = nowLine({ kind: 'local', title: 'DROWNED DUSK', artist: 'DumbRaven', playing: true });
  assert.equal(line, 'DROWNED DUSK · DumbRaven');
});

test('外部模式三样都写：外部音乐没有封面可看，少一样就认不出', () => {
  const line = nowLine({
    kind: 'external',
    title: 'Ab Ovo',
    artist: 'Joep Beving',
    app: '网易云音乐',
    playing: true,
  });
  assert.equal(line, 'Ab Ovo · Joep Beving · 网易云音乐');
});

test('暂停时补一句，否则一行字看不出声音是停的', () => {
  assert.equal(
    nowLine({ kind: 'local', title: 'DROWNED DUSK', artist: 'DumbRaven', playing: false }),
    'DROWNED DUSK · DumbRaven · 已暂停',
  );
  assert.equal(
    nowLine({ kind: 'external', title: 'Ab Ovo', artist: '', app: 'QQ音乐', playing: false }),
    'Ab Ovo · QQ音乐 · 已暂停',
  );
});

test('缺字段时跳过而不是留下空的那一格', () => {
  assert.equal(
    nowLine({ kind: 'external', title: 'Ab Ovo', artist: '', app: '', playing: true }),
    'Ab Ovo',
  );
  assert.equal(
    nowLine({ kind: 'local', title: 'Only Title', artist: '', playing: true }),
    'Only Title',
  );
});

test('秒数写成 m:ss，超过一小时才补小时位', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(9), '0:09');
  assert.equal(clock(72), '1:12');
  assert.equal(clock(228), '3:48');
  assert.equal(clock(600), '10:00');
  assert.equal(clock(3661), '1:01:01');
});

test('时长拿不到时写 0:00，不写 NaN 也不写负数', () => {
  assert.equal(clock(NaN), '0:00');
  assert.equal(clock(-5), '0:00');
  assert.equal(clock(Infinity), '0:00');
});

test('本地模式的副行是进度加播放顺序', () => {
  assert.equal(
    nowDetail({ kind: 'local', title: 'Ocean', artist: 'DumbRaven', playing: true, at: 72, span: 228, order: '列表循环' }),
    '1:12 / 3:48 · 列表循环',
  );
});

test('没有时长时只写播放顺序，不写 0:00 / 0:00', () => {
  assert.equal(
    nowDetail({ kind: 'local', title: 'Ocean', artist: 'DumbRaven', playing: true, at: 0, span: 0, order: '随机播放' }),
    '随机播放',
  );
});

test('外部模式拿不到进度，副行如实写专辑——不编一个假进度', () => {
  assert.equal(
    nowDetail({ kind: 'external', title: 'Ab Ovo', artist: 'Joep Beving', app: '网易云音乐', playing: true, album: 'Henosis' }),
    'Henosis',
  );
  // 系统媒体会话不给播放位置，所以到这里也不该出现任何时间
  const line = nowDetail({ kind: 'external', title: 'Ab Ovo', artist: '', app: '', playing: true });
  assert.equal(line, '');
});

test('专辑跟歌名或歌手重复时不显示，否则等于同一句话说两遍', () => {
  assert.equal(
    nowDetail({ kind: 'external', title: 'Ab Ovo', artist: 'Joep Beving', app: '', playing: true, album: 'Ab Ovo' }),
    '',
  );
  assert.equal(
    nowDetail({ kind: 'external', title: 'Ab Ovo', artist: 'Joep Beving', app: '', playing: true, album: 'Joep Beving' }),
    '',
  );
});

test('什么都没有时副行是空串，调用方据此不渲染那一行', () => {
  assert.equal(nowDetail(null), '');
  assert.equal(nowDetail(undefined), '');
});
