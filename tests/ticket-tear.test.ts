import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipRect, flightOf, flightSelectors, pickFlightRect, SHOT_SHARE, shouldTear,
  tearDrop, tearProgress, TEAR_TRIGGER, TICKET_ASPECT,
} from '../src/ticket-tear.ts';

test('撕开进度按票根高度换算，且夹在 0~1', () => {
  assert.equal(tearProgress(0, 200), 0);
  assert.equal(tearProgress(-30, 200), 0);
  assert.equal(tearProgress(100, 200), 0.5);
  assert.equal(tearProgress(400, 200), 1);
});

test('高度或位移非法时不让它炸', () => {
  assert.equal(tearProgress(50, 0), 0);
  assert.equal(tearProgress(50, Number.NaN), 0);
  assert.equal(tearProgress(Number.NaN, 200), 0);
  assert.equal(shouldTear(50, 0), false);
});

test('拖过阈值才算撕开，阈值本身算撕开', () => {
  assert.equal(shouldTear(200 * TEAR_TRIGGER - 1, 200), false);
  assert.equal(shouldTear(200 * TEAR_TRIGGER, 200), true);
  assert.equal(shouldTear(200, 200), true);
});

// 撕法是「直上直下」（用户 m01988）：整条票根整体往下平移，手拉多少就走多少。
// 这里不做缓动——缓动是给「折痕跟上手」用的，用在直接拖拽上只会读成「纸不跟手」。
test('票根位移就是手的位移本身，不做任何换算', () => {
  assert.equal(tearDrop(120), 120);
  assert.equal(tearDrop(0), 0);
  assert.equal(tearDrop(400), 400);
});

// 往上推不倒退：已经滑走的票根不会自己长回来，从别处移进来也一样。
// 手指越过起点往上跑时 clientY < startY，dy 是负数，这里必须压成 0。
test('往上推不倒退，负位移一律当 0', () => {
  assert.equal(tearDrop(-80), 0);
  assert.equal(tearDrop(-0.0001), 0);
});

test('位移非法时票根留在原位，且不出 NaN', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const drop = tearDrop(bad);
    assert.ok(Number.isFinite(drop), `drop 不该是 ${drop}`);
    // 非有限值一律当「没拖」——真手指给不出 Infinity，能出现只是代码写错了，
    // 那时候让票根留在原处比让它飞出去更安全。
    assert.equal(drop, 0);
  }
});

test('飞行位移取左上角差，不是中心点差（缩放绕左上角做）', () => {
  const move = flightOf(
    { x: 100, y: 100, w: 200, h: 100 },
    { x: 400, y: 300, w: 600, h: 300 },
  );
  // transform-origin: 0 0 + translate → scale，左上角只受 translate 影响。
  assert.equal(move.dx, 300);
  assert.equal(move.dy, 200);
  assert.equal(move.scale, 3);
});

test('宽度为 0 时不做缩放，免得除出 Infinity', () => {
  const move = flightOf({ x: 0, y: 0, w: 0, h: 0 }, { x: 10, y: 10, w: 20, h: 20 });
  assert.equal(move.scale, 1);
});

test('票根比例照参考图取 1.95:1，不再是 16:9 撑出来的 2.57', () => {
  // 整票 1098×562。别再乘 1/SHOT_SHARE——画面块已经改成 1.39:1，
  // 整票比例就是它本身，乘一次会算成 2.57，正是要丢掉的那个旧值。
  assert.ok(Math.abs(TICKET_ASPECT - 1098 / 562) < 1e-9);
  // 参考图上量到的就是 1098×562，允许一点点取整误差。
  assert.ok(TICKET_ASPECT > 1.9, `应贴合参考图的 1.95 ${TICKET_ASPECT}`);
  assert.ok(TICKET_ASPECT < 2.0, `不该比参考图更细长 ${TICKET_ASPECT}`);
  // 16:9 的素材放进 1.39:1 的框里靠 contain 完整显示，所以画面块自己
  // 必须比 16:9 高——矮了就变成裁掉两头。
  assert.ok(779 / 562 > 1, '画面块的宽高比');
  assert.ok(16 / 9 > 779 / 562, '16:9 比画面块更宽，才会上下留边而不是左右留边');
});

test('每种版式飞向自己的画面块，透明版式退回幕布', () => {
  assert.deepEqual(flightSelectors('collage'), ['.tpl-block-media']);
  assert.deepEqual(flightSelectors('photo'), ['.tpl-photo-media']);
  assert.deepEqual(flightSelectors('desktop'), ['.theater-screen']);
  // 认不出的版式也得有个落点，不能返回空数组让调用方飞不起来。
  assert.deepEqual(flightSelectors('没见过'), ['.theater-screen']);
});

test('落点被夹进幕布里，完全不相交时退回幕布', () => {
  const bounds = { x: 100, y: 100, w: 400, h: 300 };
  // 右边超出 50px：只截掉超出那部分，不整块作废。
  assert.deepEqual(clipRect({ x: 300, y: 200, w: 200, h: 100 }, bounds), {
    x: 300, y: 200, w: 200, h: 100,
  });
  assert.deepEqual(clipRect({ x: 400, y: 300, w: 400, h: 300 }, bounds), {
    x: 400, y: 300, w: 100, h: 100,
  });
  // 完全在幕布外面（拼贴画面滚出视口时会发生），飞进一条缝没有意义。
  assert.deepEqual(clipRect({ x: 900, y: 900, w: 50, h: 50 }, bounds), bounds);
});

test('挑落点时跳过没面积的那几个，全都没有就用幕布', () => {
  const bounds = { x: 0, y: 0, w: 800, h: 450 };
  const good = { x: 10, y: 10, w: 400, h: 225 };
  assert.deepEqual(pickFlightRect([null, { x: 0, y: 0, w: 0, h: 0 }, good], bounds), good);
  assert.deepEqual(pickFlightRect([null, undefined], bounds), bounds);
  assert.deepEqual(pickFlightRect([], bounds), bounds);
  // 有面积但整块在幕布外，退回幕布而不是返回那个矩形。
  assert.deepEqual(pickFlightRect([{ x: 900, y: 900, w: 50, h: 50 }], bounds), bounds);
});
