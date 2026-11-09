import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginSwipe,
  moveSwipe,
  swipeFires,
  swipeFollow,
  SWIPE_FOLLOW_MAX,
  SWIPE_FOLLOW_RATIO,
  SWIPE_SLOPE,
  SWIPE_THRESHOLD,
} from '../src/disc-swipe.ts';

/** 从原点划到 (x, y) 之后的那份轨迹。 */
function drag(x: number, y = 0) {
  return moveSwipe(beginSwipe({ x: 500, y: 400 }), { x: 500 + x, y: 400 + y });
}

test('没到阈值不算滑动', () => {
  assert.equal(swipeFires(drag(SWIPE_THRESHOLD - 1)), 0);
  assert.equal(swipeFires(drag(-(SWIPE_THRESHOLD - 1))), 0);
});

test('刚好到阈值就触发', () => {
  // 「刚好」也要算——不然 48 会被判成没滑，用户得滑 49 才有反应。
  // 正的 dx 是往右，往右拿回来的是上一首。
  assert.equal(swipeFires(drag(SWIPE_THRESHOLD)), -1);
  assert.equal(swipeFires(drag(-SWIPE_THRESHOLD)), 1);
});

test('左滑下一曲、右滑上一曲', () => {
  assert.equal(swipeFires(drag(-120)), 1);
  assert.equal(swipeFires(drag(120)), -1);
});

test('纵向比横向更明显时不切歌', () => {
  // 斜着往右下甩：虽然横向也过了阈值，但纵向是它的 1.4 倍以上，
  // 这种手势在别处是「翻页/滚动」，在这里不该抢。
  assert.equal(swipeFires(drag(60, 60 * SWIPE_SLOPE)), 0);
  assert.equal(swipeFires(drag(-60, 60 * SWIPE_SLOPE)), 0);
});

test('纵向的多一点也还行，只要没超过斜率', () => {
  // 手指不可能划得笔直，允许七成左右的纵向抖动。
  assert.equal(swipeFires(drag(-120, 60)), 1);
});

test('跟手位移和手指同号，且被压小', () => {
  const left = swipeFollow(drag(-40));
  const right = swipeFollow(drag(40));
  assert.ok(left < 0, `左滑应为负，实际 ${left}`);
  assert.ok(right > 0, `右滑应为正，实际 ${right}`);
  assert.equal(left, -40 * SWIPE_FOLLOW_RATIO);
  assert.equal(right, 40 * SWIPE_FOLLOW_RATIO);
});

test('跟手位移钳在上下限内', () => {
  // 洞只比碟大 20.5px，再推就穿模了。两条边都要钳。
  assert.equal(swipeFollow(drag(-4000)), -SWIPE_FOLLOW_MAX);
  assert.equal(swipeFollow(drag(4000)), SWIPE_FOLLOW_MAX);
  assert.ok(Math.abs(swipeFollow(drag(-4000))) <= SWIPE_FOLLOW_MAX);
});

test('跟手上限可以按需要缩小', () => {
  assert.equal(swipeFollow(drag(1000), 4), 4);
  assert.equal(swipeFollow(drag(-1000), 4), -4);
});

test('moveSwipe 不改起点，只算相对位移', () => {
  const start = beginSwipe({ x: 10, y: 20 });
  const once = moveSwipe(start, { x: 30, y: 50 });
  const twice = moveSwipe(once, { x: 5, y: 5 });
  assert.deepEqual(once.origin, { x: 10, y: 20 });
  // 第二段是从原始起点算的，不是在 once 上累加——否则来回晃会越算越偏。
  assert.deepEqual(twice, { origin: { x: 10, y: 20 }, dx: -5, dy: -15 });
});

test('刚按下那一帧不触发', () => {
  assert.equal(swipeFires(beginSwipe({ x: 500, y: 400 })), 0);
});
