/**
 * 图层存档的测试。
 *
 * 这些函数全是纯的（除了两个碰 localStorage 的读写），所以直接在这里跑，
 * 不用起 Electron。
 *
 * 合并之后最要紧的三条规则：
 *   ① 「用户把东西全删了」与「压根没存过」必须分开——前者不该在刷新后
 *      又冒出默认那两块（看起来像没记住，是这一块最容易写错的地方）；
 *   ② 旧的两份存档要能搬过来，而且叠加元素那份优先（它跟着用户更久）；
 *   ③ 同一个 id 只留一份——数组里出现两次会让 React 的 key 撞车。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addLayer,
  canAddLayer,
  clockText,
  dateText,
  defaultLayers,
  layerMetas,
  MAX_LAYERS,
  moveLayer,
  readLayers,
  removeLayer,
  SCALE_MAX,
  SCALE_MIN,
  scaleLayer,
  timerText,
  type LayerList,
} from '../src/layers.ts';

const list = (): LayerList => [
  { id: 'clock', spot: { x: 0.5, y: 0.4 }, scale: 1 },
  { id: 'date', spot: { x: 0.5, y: 0.6 }, scale: 1 },
];

test('没存过时给默认那两块', () => {
  assert.deepEqual(readLayers(null).map(layer => layer.id), ['clock', 'title']);
});

test('空数组是合法的：用户全删了就该是全删', () => {
  assert.deepEqual(readLayers('[]'), []);
});

test('认不出的 id 丢掉，同 id 只留第一份', () => {
  const raw = JSON.stringify([
    { id: 'clock', spot: { x: 0.2, y: 0.3 }, scale: 1 },
    { id: 'nope', spot: { x: 0.1, y: 0.1 }, scale: 1 },
    { id: 'clock', spot: { x: 0.9, y: 0.9 }, scale: 2 },
  ]);
  const got = readLayers(raw);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'clock');
  assert.deepEqual(got[0].spot, { x: 0.2, y: 0.3 });
});

test('坏 JSON 退回默认，不抛错', () => {
  assert.deepEqual(readLayers('{{{').map(layer => layer.id), ['clock', 'title']);
});

test('位置越界会被钳回 0–1', () => {
  const raw = JSON.stringify([{ id: 'clock', spot: { x: -3, y: 9 }, scale: 1 }]);
  assert.deepEqual(readLayers(raw)[0].spot, { x: 0, y: 1 });
});

test('缩放越界会被钳在 0.5–2.4', () => {
  const raw = JSON.stringify([
    { id: 'clock', spot: { x: 0.5, y: 0.5 }, scale: 99 },
    { id: 'date', spot: { x: 0.5, y: 0.5 }, scale: 0.01 },
  ]);
  const got = readLayers(raw);
  assert.equal(got[0].scale, SCALE_MAX);
  assert.equal(got[1].scale, SCALE_MIN);
});

test('旧存档搬家：叠加元素那边 on 为真的才搬过来', () => {
  // 老格式：Record<id, { on, spot }>，date/timer 没开
  const legacy = JSON.stringify({
    clock: { on: true, spot: { x: 0.4, y: 0.2 } },
    date: { on: false, spot: { x: 0.3, y: 0.3 } },
    timer: { on: true, spot: { x: 0.8, y: 0.1 } },
  });
  const got = readLayers(null, legacy, null);
  assert.deepEqual(got.map(layer => layer.id), ['clock', 'timer']);
  assert.deepEqual(got[0].spot, { x: 0.4, y: 0.2 });
});

test('旧存档搬家：叠加元素那份优先于组件那份', () => {
  const legacyOverlay = JSON.stringify({ clock: { on: true, spot: { x: 0.31, y: 0.22 } } });
  const legacyWidgets = JSON.stringify([{ id: 'clock', spot: { x: 0.5, y: 0.42 }, scale: 1 }]);
  const got = readLayers(null, legacyOverlay, legacyWidgets);
  assert.deepEqual(got[0].spot, { x: 0.31, y: 0.22 });
});

test('旧存档搬家：两份旧键都在但没有东西，就是空（不塞默认）', () => {
  assert.deepEqual(readLayers(null, JSON.stringify({ clock: { on: false } }), '[]'), []);
});

test('新键优先：新存档在的时候不去读旧的', () => {
  const fresh = JSON.stringify([{ id: 'date', spot: { x: 0.1, y: 0.1 }, scale: 1 }]);
  const legacy = JSON.stringify({ clock: { on: true, spot: { x: 0.4, y: 0.2 } } });
  assert.deepEqual(readLayers(fresh, legacy, null).map(layer => layer.id), ['date']);
});

test('加一块：用默认位置，缩放回到 1', () => {
  const got = addLayer(list(), 'timer');
  assert.equal(got.length, 3);
  const timer = got[2];
  assert.equal(timer.id, 'timer');
  assert.equal(timer.scale, 1);
  assert.deepEqual(timer.spot, layerMetas.find(meta => meta.id === 'timer')!.spot);
});

test('已经在的再加一次不会变两份', () => {
  const before = list();
  assert.equal(addLayer(before, 'clock'), before);
});

test('数量到上限就不再往里塞', () => {
  let current: LayerList = [];
  for (const meta of layerMetas) current = addLayer(current, meta.id);
  // 六个 id 都用完了，再试一次应该原样返回
  const after = addLayer(current, 'clock');
  assert.equal(after.length, current.length);
  assert.ok(current.length <= MAX_LAYERS);
});

test('移除只去掉指定那一个', () => {
  assert.deepEqual(removeLayer(list(), 'date').map(layer => layer.id), ['clock']);
});

test('移动只改指定那一个，并且钳回 0–1', () => {
  const got = moveLayer(list(), 'date', { x: 1.6, y: -0.4 });
  assert.deepEqual(got[1].spot, { x: 1, y: 0 });
  assert.deepEqual(got[0].spot, list()[0].spot);
});

test('缩放只改指定那一个', () => {
  const got = scaleLayer(list(), 'clock', 5);
  assert.equal(got[0].scale, SCALE_MAX);
  assert.equal(got[1].scale, 1);
});

test('canAddLayer：有了不给加，没有才能加', () => {
  assert.equal(canAddLayer(list(), 'clock'), false);
  assert.equal(canAddLayer(list(), 'disc'), true);
});

test('默认那两块的位置互不重叠', () => {
  const [first, second] = defaultLayers;
  assert.notDeepEqual(first.spot, second.spot);
  assert.ok(Math.abs(first.spot.y - second.spot.y) > 0.05);
});

test('文字：时钟补零、日期是月.日 星期、计时器按分:秒', () => {
  const morning = new Date(2026, 9, 26, 9, 4);
  assert.equal(clockText(morning), '09:04');
  assert.equal(dateText(morning), 'Oct.26 Monday');
  assert.equal(timerText(0), '00:00');
  assert.equal(timerText(25 * 60 * 1000), '25:00');
  assert.equal(timerText(-5000), '00:00');
  assert.equal(timerText(59_400), '00:59');
});
