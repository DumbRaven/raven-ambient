import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowLine, timeOfDay } from '../src/stage-text.ts';

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
