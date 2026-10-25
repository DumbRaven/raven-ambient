/** 把一次拖动的监听器绑在同一生命周期，结束、取消、卸载均完整清理。 */
export function pointerSession(root: EventTarget, pointerId: number, move: (event: PointerEvent) => void, finish: (drop: boolean) => void) {
  let active = true;
  const end = (drop: boolean) => {
    if (!active) return;
    active = false;
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onCancel);
    root.removeEventListener('blur', cancel);
    finish(drop);
  };
  const matches = (event: Event) => (event as PointerEvent).pointerId === pointerId;
  const onMove = (event: Event) => { if (matches(event)) move(event as PointerEvent); };
  const onUp = (event: Event) => { if (matches(event)) end(true); };
  const onCancel = (event: Event) => { if (matches(event)) end(false); };
  const cancel = () => end(false);
  root.addEventListener('pointermove', onMove, { passive: false });
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onCancel);
  root.addEventListener('blur', cancel);
  return cancel;
}
