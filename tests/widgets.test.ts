/**
 * 透明模式组件存档的测试。
 *
 * 这些函数全是纯的（除了两个碰 localStorage 的读写），所以直接在这里跑，
 * 不用起 Electron。规则里最要紧的一条是「用户把组件全删了之后，刷新不该
 * 又冒出来」——那看起来像没记住，是这一块最容易写错的地方。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addWidget,
  canAddWidget,
  defaultWidgets,
  MAX_WIDGETS,
  moveWidget,
  readWidgets,
  removeWidget,
  SCALE_MAX,
  SCALE_MIN,
  scaleWidget,
  widgetMetas,
  type WidgetList,
} from '../src/widgets.ts';

const list = (): WidgetList => [
  { id: 'clock', spot: { x: 0.5, y: 0.4 }, scale: 1 },
  { id: 'date', spot: { x: 0.5, y: 0.6 }, scale: 1 },
];

test('没存过时给默认那两块', () => {
  const got = readWidgets(null);
  assert.deepEqual(got.map(widget => widget.id), ['clock', 'date']);
});

test('空数组是合法的：用户全删了就该是全删', () => {
  assert.deepEqual(readWidgets('[]'), []);
});

test('认不出的 id 丢掉，同 id 只留第一份', () => {
  const raw = JSON.stringify([
    { id: 'clock', spot: { x: 0.2, y: 0.3 }, scale: 1 },
    { id: 'nope', spot: { x: 0.1, y: 0.1 }, scale: 1 },
    { id: 'clock', spot: { x: 0.9, y: 0.9 }, scale: 2 },
  ]);
  const got = readWidgets(raw);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'clock');
  assert.deepEqual(got[0].spot, { x: 0.2, y: 0.3 });
});

test('坏 JSON 退回默认，不抛错', () => {
  assert.deepEqual(readWidgets('{{{').map(widget => widget.id), ['clock', 'date']);
});

test('位置越界会被钳回 0–1', () => {
  const raw = JSON.stringify([{ id: 'clock', spot: { x: -3, y: 9 }, scale: 1 }]);
  assert.deepEqual(readWidgets(raw)[0].spot, { x: 0, y: 1 });
});

test('缩放越界会被钳在 0.5–2.4', () => {
  const raw = JSON.stringify([
    { id: 'clock', spot: { x: 0.5, y: 0.5 }, scale: 99 },
    { id: 'date', spot: { x: 0.5, y: 0.5 }, scale: 0.01 },
  ]);
  const got = readWidgets(raw);
  assert.equal(got[0].scale, SCALE_MAX);
  assert.equal(got[1].scale, SCALE_MIN);
});

test('加一块：用默认位置，缩放回到 1', () => {
  const got = addWidget(list(), 'timer');
  assert.equal(got.length, 3);
  const timer = got[2];
  assert.equal(timer.id, 'timer');
  assert.equal(timer.scale, 1);
  assert.deepEqual(timer.spot, widgetMetas.find(meta => meta.id === 'timer')!.spot);
});

test('已经在的再加一次不会变两份', () => {
  const before = list();
  const after = addWidget(before, 'clock');
  assert.equal(after, before);
});

test('数量到上限就不再往里塞', () => {
  let current: WidgetList = [];
  for (const meta of widgetMetas) current = addWidget(current, meta.id);
  // 六个 id 都用完了，再试一次应该原样返回
  const after = addWidget(current, 'clock');
  assert.equal(after.length, current.length);
  assert.ok(current.length <= MAX_WIDGETS);
});

test('移除只去掉指定那一个', () => {
  const got = removeWidget(list(), 'date');
  assert.deepEqual(got.map(widget => widget.id), ['clock']);
});

test('移动只改指定那一个，并且钳回 0–1', () => {
  const got = moveWidget(list(), 'date', { x: 1.6, y: -0.4 });
  assert.deepEqual(got[1].spot, { x: 1, y: 0 });
  assert.deepEqual(got[0].spot, list()[0].spot);
});

test('缩放只改指定那一个', () => {
  const got = scaleWidget(list(), 'clock', 5);
  assert.equal(got[0].scale, SCALE_MAX);
  assert.equal(got[1].scale, 1);
});

test('canAddWidget：满了不给加，有了不给加', () => {
  assert.equal(canAddWidget(list(), 'clock'), false);
  assert.equal(canAddWidget(list(), 'title'), true);
});

test('默认那两块的位置互不重叠', () => {
  const [first, second] = defaultWidgets;
  assert.notDeepEqual(first.spot, second.spot);
  assert.ok(Math.abs(first.spot.y - second.spot.y) > 0.05);
});
