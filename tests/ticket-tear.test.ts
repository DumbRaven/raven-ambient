import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ashParticles, clipRect, flightOf, flightSelectors, foldShape,
  pickFlightRect, SHOT_SHARE, shouldTear, tearEase, tearProgress, TEAR_FOLD_DEG,
  TEAR_FOLD_EDGE, TEAR_HINGE_DEG, TEAR_PANEL_RATIO, TEAR_TRIGGER, TICKET_ASPECT,
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

// 归一化到「断开点」而不是 1：撕到 42% 就断了，1 永远走不到。以 1 为分母时
// 阈值那一刻形变只有 0.43^1.6 ≈ 0.26，掀开角不到 4 度，拖一路看着像没动。
test('缓动在断开点刚好走满，中途明显落后于手', () => {
  assert.equal(tearEase(0), 0);
  assert.equal(tearEase(-0.2), 0);
  assert.equal(tearEase(TEAR_TRIGGER), 1);
  assert.equal(tearEase(1), 1);
  // 手拖到阈值的一半（0.21），形变只走了约三分之一：前段绷住。
  const half = tearEase(TEAR_TRIGGER / 2);
  assert.ok(half > 0.25 && half < 0.4, `阈值一半处的形变应介于 0.25~0.4，实际 ${half}`);
  // 过阈值之后加速：后四分之一的手位移换到的形变比前四分之一多。
  assert.ok(tearEase(TEAR_TRIGGER * 0.9) - tearEase(TEAR_TRIGGER * 0.75)
    > tearEase(TEAR_TRIGGER * 0.25) - tearEase(TEAR_TRIGGER * 0.1));
});

test('缓动不会越过 1，也不会因为阈值传错而除出 NaN', () => {
  assert.equal(tearEase(0.42, 0), 1);          // 阈值非法时退回 TEAR_TRIGGER
  assert.equal(tearEase(2, TEAR_TRIGGER), 1);
  assert.equal(tearEase(Number.NaN, TEAR_TRIGGER), 0);
});

test('掀开角够在票面顶上让开一道看得见的 V', () => {
  // 1040×498 的浮层上 12 度能让顶端横向让开约 103px，再大像牌子被掀翻。
  assert.ok(TEAR_HINGE_DEG >= 8 && TEAR_HINGE_DEG <= 16, `掀开角应在 8~16 度，实际 ${TEAR_HINGE_DEG}`);
  assert.ok(Math.sin(TEAR_HINGE_DEG * Math.PI / 180) * 498 > 60);
});

// 撕开是把右半的**右下角**掀起来：折痕从右下角斜切过去，切下来的三角沿折痕
// 翻过去压在纸上（一个折痕、一次旋转，所以永远不裂，也永远飞不出纸面）。
// 下面这组测的就是这条狗耳折痕：静止时两个落点都缩在右下角（纸是平的），
// 越撕折痕越往左上走，折满时横到左边缘，翻起来的正好是面板右下角一半的面积。
test('没撕的时候折痕缩在右下角，两块拼满整张票', () => {
  const flat = foldShape(0);
  // x1 / y1 是折痕两个落点的比值：1 = 就在右下角，等于什么都没折。
  assert.equal(flat.x1, 1);
  assert.equal(flat.y1, 1);
  assert.equal(flat.edge, 0);
  // 不转 —— 否则静止态票面就是翘的。
  assert.equal(flat.deg, 0);
});

test('折满时那个角掀到最大，翻起来的是等腰直角三角形', () => {
  const full = foldShape(1);
  // 下边缘那个落点退到 TEAR_FOLD_EDGE 处（不是一直退到左边缘，
  // 否则掀走的是半张票，读起来像票根缺了一块而不是掀角）。
  assert.ok(Math.abs(full.x1 - (1 - TEAR_FOLD_EDGE)) < 1e-9, `下边缘落点应在 ${1 - TEAR_FOLD_EDGE}，实际 ${full.x1}`);
  assert.ok(
    Math.abs(full.y1 - (1 - TEAR_FOLD_EDGE * TEAR_PANEL_RATIO)) < 1e-9,
    `右边缘落点应在 ${1 - TEAR_FOLD_EDGE * TEAR_PANEL_RATIO}，实际 ${full.y1}`,
  );
  assert.equal(full.deg, TEAR_FOLD_DEG);
  assert.equal(full.edge, TEAR_FOLD_EDGE);
  // 两条直角边的像素长度必须相等，否则翻过去是个细长的三角、不像狗耳。
  // 统一把面板宽当 1 来算：横向一边 = (1 - x1) 个面板宽；
  // 纵向一边 = (1 - y1) 个面板高，而面板高 = 宽 / RATIO，所以要除掉 RATIO。
  for (let i = 1; i <= 10; i += 1) {
    const f = foldShape(i / 10);
    const alongX = 1 - f.x1;
    const alongY = (1 - f.y1) / TEAR_PANEL_RATIO;
    assert.ok(Math.abs(alongX - alongY) < 1e-9, `两条直角边应等长，bend=${i / 10}：${alongX} vs ${alongY}`);
  }
});

test('折痕随进度往左上走，不会回头也不会越界', () => {
  let prevX = Infinity;
  let prevY = Infinity;
  for (let i = 0; i <= 10; i += 1) {
    const f = foldShape(i / 10);
    assert.ok(f.x1 <= prevX, `下边缘落点不该往回退，bend=${i / 10}`);
    assert.ok(f.y1 <= prevY, `右边缘落点不该往回退，bend=${i / 10}`);
    assert.ok(f.x1 >= 0 && f.x1 <= 1, `下边缘落点越界 ${f.x1}`);
    assert.ok(f.y1 >= 0 && f.y1 <= 1, `右边缘落点越界 ${f.y1}`);
    prevX = f.x1;
    prevY = f.y1;
  }
});

test('旋转轴就是折痕方向：恒为 45 度的单位向量', () => {
  for (const bend of [0, 0.2, 0.5, 1]) {
    const f = foldShape(bend);
    // rotate3d 的轴必须是单位向量，否则 CSS 里的角度会被放大。
    assert.ok(Math.abs(Math.hypot(f.ax, f.ay) - 1) < 1e-9, `轴不是单位向量，bend=${bend}`);
    // 折痕在像素空间里横向与纵向走一样多 → 45 度 → 两个分量绝对值相等。
    assert.ok(Math.abs(Math.abs(f.ax) - Math.abs(f.ay)) < 1e-9, `轴应是 45 度，bend=${bend}`);
    // 折痕从右下角往**左上**走，所以 y 分量为负。若为正，翻的是右上角。
    assert.ok(f.ay < 0, `轴应指向左上，bend=${bend}`);
  }
});

test('旋转轴必须与折痕线平行，否则折痕会裂开', () => {
  for (const bend of [0.1, 0.3, 0.6, 1]) {
    const f = foldShape(bend);
    // 折痕在像素空间的走向：从下边缘 (x1, 1) 到右边缘 (1, y1)。
    // 统一把面板宽当 1：横向走 (1 - x1) 个面板宽，纵向走 (y1 - 1) 个面板高，
    // 而面板高 = 宽 / RATIO，所以纵向的像素量要除掉 RATIO。
    const dirX = 1 - f.x1;
    const dirY = (f.y1 - 1) / TEAR_PANEL_RATIO;
    const len = Math.hypot(dirX, dirY);
    const cross = (dirX / len) * f.ay - (dirY / len) * f.ax;
    assert.ok(Math.abs(cross) < 1e-9, `轴与折痕不平行，叉积 ${cross}，bend=${bend}`);
  }
});

test('折叠参数非法时退回平铺，不炸也不出 NaN', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 2]) {
    const f = foldShape(bad);
    for (const [key, value] of Object.entries(f)) {
      assert.ok(Number.isFinite(value), `${key} 不该是 NaN/Infinity，实际 ${value}`);
    }
    assert.ok(f.x1 >= 0 && f.x1 <= 1, `下边缘落点越界 ${f.x1}`);
    assert.ok(f.y1 >= 0 && f.y1 <= 1, `右边缘落点越界 ${f.y1}`);
    assert.ok(f.deg >= 0 && f.deg <= TEAR_FOLD_DEG, `折叠角越界 ${f.deg}`);
  }
  // 越界夹取：负数和超 1 都按端点算。
  assert.deepEqual(foldShape(-1), foldShape(0));
  assert.deepEqual(foldShape(2), foldShape(1));
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
