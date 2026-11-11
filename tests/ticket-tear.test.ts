import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ashParticles, clipRect, flightOf, flightSelectors, pickFlightRect, SHOT_SHARE,
  shouldTear, tearProgress, TEAR_TRIGGER, TICKET_ASPECT,
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

test('灰烬数量对得上，坐标都落在票根里', () => {
  const flakes = ashParticles('image:7', 28);
  assert.equal(flakes.length, 28);
  for (const flake of flakes) {
    assert.ok(flake.x >= 0 && flake.x <= 1, `x 越界 ${flake.x}`);
    assert.ok(flake.y >= 0 && flake.y <= 1, `y 越界 ${flake.y}`);
    assert.ok(flake.size > 0);
    assert.ok(flake.delay >= 0);
    // 往上飘：dy 必须是负的。
    assert.ok(flake.dy < 0, `dy 应该向上 ${flake.dy}`);
  }
});

test('同一张票每次都炸成同一片灰，换一张就不同', () => {
  const first = ashParticles('image:1');
  const again = ashParticles('image:1');
  const other = ashParticles('image:2');
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, other);
});

test('下面的灰片飘得更高、起飞更早，上面的最后散', () => {
  const flakes = ashParticles('image:3', 20);
  const top = flakes[0];
  const bottom = flakes[flakes.length - 1];
  assert.ok(top.y < bottom.y, `第一片应贴顶 ${top.y} < ${bottom.y}`);
  assert.ok(Math.abs(bottom.dy) > Math.abs(top.dy), `底片 ${bottom.dy} 应比顶片 ${top.dy} 飘得高`);
  assert.ok(bottom.delay < top.delay, `底片 ${bottom.delay} 应比顶片 ${top.delay} 起飞早`);
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
