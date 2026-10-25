import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeightMotion } from '../src/height-motion.ts';

function fixture() {
  let visibleHeight = 240;
  const animations: { onfinish: (() => void) | null; cancel: () => void; cancelled: boolean; frames: Keyframe[] }[] = [];
  const element = {
    style: { height: '', removeProperty() { this.height = ''; } },
    dataset: {} as Record<string, string>,
    getBoundingClientRect: () => ({ height: visibleHeight }),
    animate(frames: Keyframe[]) {
      const a = { frames, onfinish: null as (() => void) | null, cancelled: false, cancel() { this.cancelled = true; } };
      animations.push(a); return a;
    },
  };
  return { element, animations, controller: new HeightMotion(element as unknown as HTMLElement), at(height: number) { visibleHeight = height; } };
}
test('切页先保留真实高度，新内容进入后才平滑改变高度', () => {
  const f = fixture(); f.controller.hold(); assert.equal(f.element.style.height, '240px');
  f.controller.to(400, 110);
  assert.deepEqual(f.animations[0].frames, [{ height: '240px' }, { height: '400px' }]);
  f.animations[0].onfinish!(); assert.equal(f.element.style.height, ''); assert.equal(f.element.dataset.sizeMotion, undefined);
});
test('快速切回时从当前画面接续，过期结束回调不能清掉新动画', () => {
  const f = fixture(); f.controller.to(400, 110); const oldFinish = f.animations[0].onfinish!;
  f.at(310); f.controller.to(200, 110); oldFinish();
  assert.equal(f.animations[0].cancelled, true); assert.equal(f.animations[1].cancelled, false);
  assert.equal(f.animations[1].frames[0].height, '310px'); assert.equal(f.element.style.height, '310px');
});
test('动画中再次退场时冻结当前高度，避免新内容把容器撑开', () => {
  const f = fixture(); f.controller.to(600, 110); f.at(350); f.controller.hold();
  assert.equal(f.element.style.height, '350px'); assert.equal(f.animations[0].cancelled, true);
});
test('减少动画或相同高度时立即恢复自适应布局', () => {
  const f = fixture(); f.controller.to(600, 110, true);
  assert.equal(f.animations.length, 0); assert.equal(f.element.style.height, '');
  f.controller.to(240, 110); assert.equal(f.animations.length, 0);
});
test('卸载取消动画并清理内联高度，不留下被裁剪的页面', () => {
  const f = fixture(); f.controller.to(600, 110); const oldFinish = f.animations[0].onfinish!;
  f.controller.reset(); oldFinish();
  assert.equal(f.animations[0].cancelled, true); assert.equal(f.element.style.height, '');
  assert.equal(f.element.dataset.sizeMotion, undefined);
});
