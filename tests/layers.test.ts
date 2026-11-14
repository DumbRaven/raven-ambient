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
  nudgeScale,
  nudgeSpot,
  readLayers,
  removeLayer,
  SCALE_MAX,
  SCALE_MIN,
  scaleFromDrag,
  scaleLayer,
  settleAt,
  settleConfirm,
  settleScale,
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

test('松手先钉住：位置立刻生效，不等上层确认', () => {
  const pinned = settleAt({}, 'clock', { x: 0.4, y: 0.3 });
  assert.deepEqual(pinned.clock, { x: 0.4, y: 0.3 });
  // 再拖另一块，前一块还留着
  const both = settleAt(pinned, 'date', { x: 0.6, y: 0.7 });
  assert.deepEqual(both.clock, { x: 0.4, y: 0.3 });
  assert.deepEqual(both.date, { x: 0.6, y: 0.7 });
});

test('上层确认之后摘掉那一条，没对上的继续钉着', () => {
  const settling = {
    clock: { x: 0.4, y: 0.3 },
    date: { x: 0.6, y: 0.7 },
  };
  const confirmed = settleConfirm(settling, [
    { id: 'clock', spot: { x: 0.4, y: 0.3 }, scale: 1 },
    // date 还对不上（快照还没到）
    { id: 'date', spot: { x: 0.1, y: 0.1 }, scale: 1 },
  ]);
  assert.deepEqual(confirmed.clock, undefined);
  assert.deepEqual(confirmed.date, { x: 0.6, y: 0.7 });
});

test('没什么可摘时不产生新对象：useEffect 里 setState 不该白重渲染', () => {
  const settling = {};
  // 没有待确认的条目，返回的必须是同一个引用，否则每次重渲染都会再触发一次
  assert.equal(settleConfirm(settling, [{ id: 'clock', spot: { x: 0.4, y: 0.3 }, scale: 1 }]), settling);
  const pinned = { clock: { x: 0.4, y: 0.3 } };
  // 对不上的那条留着，也等于没变
  assert.equal(settleConfirm(pinned, [{ id: 'clock', spot: { x: 0.9, y: 0.9 }, scale: 1 }]), pinned);
});

test('容差之内也算对上：浮点数算出来的百分比没法逐位相等', () => {
  const settling = { clock: { x: 0.4000001, y: 0.3000001 } };
  const got = settleConfirm(settling, [{ id: 'clock', spot: { x: 0.4, y: 0.3 }, scale: 1 }]);
  assert.deepEqual(got, {});
});

test('拖手柄：离中心越远越大，越近越小', () => {
  // 起手时指针离中心 40px、当前倍率 1，拖到 80px 就是 2 倍
  assert.equal(scaleFromDrag(1, 40, 80), 2);
  // 反过来往里拖是变小
  assert.equal(scaleFromDrag(1, 40, 20), 0.5);
  // 原地不动就是原倍率
  assert.equal(scaleFromDrag(1.5, 40, 40), 1.5);
});

test('拖手柄：结果一样被钳在上下限里', () => {
  assert.equal(scaleFromDrag(1, 40, 4000), SCALE_MAX);
  assert.equal(scaleFromDrag(1, 40, 0.5), SCALE_MIN);
});

test('拖手柄：正好点在中心上时比值会炸，退回原倍率', () => {
  // 起手距离为 0，若直接除会得到 Infinity 再被钳成上限——那不是用户想要的
  assert.equal(scaleFromDrag(0.8, 0, 120), 0.8);
});

test('缩放松手先钉住：倍率立刻生效，不等上层确认', () => {
  const pinned = settleScale({}, 'clock', 1.8);
  assert.deepEqual(pinned, { clock: 1.8 });
  // 别的条目不受影响
  const both = settleScale(pinned, 'date', 0.7);
  assert.deepEqual(both, { clock: 1.8, date: 0.7 });
});

test('缩放松手也钳位：直接传越界值不会写进存档', () => {
  assert.deepEqual(settleScale({}, 'clock', 99), { clock: SCALE_MAX });
  assert.deepEqual(settleScale({}, 'clock', 0.01), { clock: SCALE_MIN });
});

test('键盘挪位置：一步就是一格，两个方向互不牵连', () => {
  const at = { x: 0.5, y: 0.5 };
  assert.deepEqual(nudgeSpot(at, 0.01, 0), { x: 0.51, y: 0.5 });
  assert.deepEqual(nudgeSpot(at, -0.05, 0), { x: 0.45, y: 0.5 });
  assert.deepEqual(nudgeSpot(at, 0, 0.01), { x: 0.5, y: 0.51 });
  assert.deepEqual(nudgeSpot(at, 0, -0.05), { x: 0.5, y: 0.45 });
});

test('键盘挪位置：到边上就停住，不会累积成欠账', () => {
  // 到右边缘后继续按右键，位置不动；此时按左键应当立刻往回走一格，
  // 而不是先把之前多按的几次「还」掉
  const edge = nudgeSpot({ x: 0.99, y: 0.5 }, 0.01, 0);
  assert.deepEqual(edge, { x: 1, y: 0.5 });
  const back = nudgeSpot(edge, -0.01, 0);
  assert.deepEqual(back, { x: 0.99, y: 0.5 });
});

test('键盘挪位置：已经在边上还能往外按，不越界也不改别的轴', () => {
  assert.deepEqual(nudgeSpot({ x: 0, y: 1 }, -0.01, 0.01), { x: 0, y: 1 });
});

test('键盘改倍率：一步 10%，上下限交给 clampScale', () => {
  assert.equal(nudgeScale(1, 0.1), 1.1);
  assert.equal(nudgeScale(1, -0.1), 0.9);
  assert.equal(nudgeScale(1, 0.25), 1.25);
});

test('键盘改倍率：到上下限就停住，不会越界', () => {
  assert.equal(nudgeScale(SCALE_MAX, 0.1), SCALE_MAX);
  assert.equal(nudgeScale(SCALE_MIN, -0.1), SCALE_MIN);
  // 差一步到顶时按一下，应当正好落在顶而不是冲过去
  assert.equal(nudgeScale(SCALE_MAX - 0.05, 0.1), SCALE_MAX);
});
