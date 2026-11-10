import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ashParticles, flightOf, shouldTear, tearProgress, TEAR_TRIGGER,
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

test('飞行变换算的是中心点位移与宽度比', () => {
  const move = flightOf(
    { x: 100, y: 100, w: 200, h: 100 },
    { x: 400, y: 300, w: 600, h: 300 },
  );
  assert.equal(move.dx, 500); // 终点中心 (400+300) - 起点中心 (100+100)
  assert.equal(move.dy, 300); // 终点中心 (300+150) - 起点中心 (100+50)
  assert.equal(move.scale, 3);
});

test('宽度为 0 时不做缩放，免得除出 Infinity', () => {
  const move = flightOf({ x: 0, y: 0, w: 0, h: 0 }, { x: 10, y: 10, w: 20, h: 20 });
  assert.equal(move.scale, 1);
});
