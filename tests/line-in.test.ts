import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cablePattern, findCable, lineInError, rawAudio, type InputDevice } from '../src/line-in.ts';

test('三项音频处理必须关掉，否则避让分析会被 AGC 破坏', () => {
  assert.equal(rawAudio.echoCancellation, false);
  assert.equal(rawAudio.noiseSuppression, false);
  assert.equal(rawAudio.autoGainControl, false);
});

test('按立体声抓取，单声道设备会走 OverconstrainedError 分支', () => {
  assert.equal(rawAudio.channelCount, 2);
});

test('常见浏览器错误都翻成中文，不会把英文原名甩给用户', () => {
  const cases: Array<[string, string]> = [
    ['NotAllowedError', '系统拒绝了录音权限'],
    ['NotFoundError', '没找到虚拟声卡，先装好 VB-Cable 再打开这个开关'],
    ['NotReadableError', '虚拟声卡正被别的程序占用'],
    ['OverconstrainedError', '虚拟声卡不支持这个采样格式'],
  ];
  for (const [name, expected] of cases) {
    assert.equal(lineInError({ name }), expected);
  }
});

test('不认识的错误回落到原始 message', () => {
  assert.equal(lineInError({ name: 'WeirdError', message: '设备睡着了' }), '设备睡着了');
});

test('连 message 都没有时也有兜底文案', () => {
  assert.equal(lineInError(null), '未知原因');
  assert.equal(lineInError(undefined), '未知原因');
  assert.equal(lineInError({}), '未知原因');
});

const device = (label: string, id = label): InputDevice => ({ id, label });

test('优先挑名字里带 Cable Output 的那个端点', () => {
  const list = [device('麦克风 (USB Audio)'), device('CABLE Output (VB-Audio Virtual Cable)', 'cable'), device('线路输入')];
  assert.equal(findCable(list)?.id, 'cable');
});

test('名字里只有 VB-Audio 也能认出来（A+ 版驱动就是这样）', () => {
  const list = [device('麦克风'), device('VB-Audio Virtual Cable', 'vb')];
  assert.equal(findCable(list)?.id, 'vb');
});

test('一个都不像时返回 undefined，交给上层报「没找到虚拟声卡」', () => {
  assert.equal(findCable([device('麦克风 (BOYA CastMic G30)'), device('立体声混音')]), undefined);
  assert.equal(findCable([]), undefined);
});

test('设备名里的空格与大小写都不影响匹配', () => {
  assert.equal(cablePattern.test('cable   output (vb-audio)'), true);
  assert.equal(cablePattern.test('CABLE Out'), true);
  assert.equal(cablePattern.test('vb-audio virtual cable'), true);
  assert.equal(cablePattern.test('麦克风阵列'), false);
});
