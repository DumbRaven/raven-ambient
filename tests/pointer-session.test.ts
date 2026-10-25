import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointerSession } from '../src/pointer-session.ts';

class Root extends EventTarget {
  listeners = new Set<EventListenerOrEventListenerObject>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) { this.listeners.add(listener); super.addEventListener(type, listener, options); }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject) { this.listeners.delete(listener); super.removeEventListener(type, listener); }
}
const pointer = (type: string, pointerId = 1) => Object.assign(new Event(type), { pointerId });
for (const ending of ['pointerup', 'pointercancel', 'blur', 'unmount']) test(`${ending} 清理全部拖动监听，旧事件不会再次提交`, () => {
  const root = new Root(), outcomes: boolean[] = []; let moves = 0;
  const cancel = pointerSession(root, 1, () => moves++, drop => outcomes.push(drop));
  root.dispatchEvent(pointer('pointermove', 2)); assert.equal(moves, 0);
  root.dispatchEvent(pointer('pointerup', 2)); assert.equal(outcomes.length, 0);
  root.dispatchEvent(pointer('pointermove')); assert.equal(moves, 1);
  if (ending === 'unmount') cancel(); else root.dispatchEvent(pointer(ending));
  assert.equal(root.listeners.size, 0); assert.deepEqual(outcomes, [ending === 'pointerup']);
  root.dispatchEvent(pointer('pointercancel')); root.dispatchEvent(pointer('pointermove')); cancel();
  assert.equal(moves, 1); assert.equal(outcomes.length, 1);
});
