import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { dialogTiming, MotionSequence, pageTiming, type MotionState, type MotionTiming } from './motion-state';

const media = '(prefers-reduced-motion: reduce)';
const getReduced = () => window.matchMedia(media).matches;
function subscribeReduced(notify: () => void) {
  const query = window.matchMedia(media);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}
export function useMotion<T>(target: T, timing: MotionTiming, order?: readonly T[], beforeChange?: (state: MotionState<T>) => void) {
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, () => true);
  const [state, setState] = useState<MotionState<T>>({ value: target, phase: 'idle', direction: 1 });
  const sequence = useRef<MotionSequence<T> | null>(null);
  if (!sequence.current) sequence.current = new MotionSequence(target, timing, next => { beforeChange?.(next); setState(next); });
  useLayoutEffect(() => {
    const controller = sequence.current!;
    const direction = order ? Math.sign(order.indexOf(target) - order.indexOf(controller.state.value)) || 1 : 1;
    controller.request(target, reduced, direction);
    return () => controller.cancel();
  }, [target, reduced, order]);
  return state;
}

const views = ['cabinet', 'listening', 'focus'] as const;
export function usePageMotion(view: typeof views[number]) { return useMotion(view, pageTiming, views); }

/** 唱片柜内部的筛选（已选择 / 音乐 / 环境音）：换内容时同样走一遍扩散。 */
const filters = ['selected', 'music', 'ambient'] as const;
export function useFilterMotion(filter: typeof filters[number]) { return useMotion(filter, pageTiming, filters); }

export function useDialogMotion<T extends string | null>(target: T) {
  const ref = useRef<HTMLDialogElement>(null);
  const motion = useMotion(target, dialogTiming, undefined, next => {
    const dialog = ref.current;
    if (!dialog || next.phase === 'idle') return;
    // Reverse from the actual frame when closed during entry or reopened during exit.
    const current = dialog.open ? getComputedStyle(dialog) : undefined;
    const veil = dialog.open ? getComputedStyle(dialog, '::backdrop') : undefined;
    const content = dialog.open ? getComputedStyle(dialog.querySelector<HTMLElement>('.modal-content')!) : undefined;
    // Read the full frame before changing any CSS variable (computed styles are live).
    const frame = {
      opacity: current?.opacity ?? '0', transform: current?.transform ?? 'translateY(12px) scale(.98)',
      veilOpacity: veil?.opacity ?? '0', veilFilter: veil?.backdropFilter ?? 'blur(0px)',
      contentOpacity: content?.opacity ?? '0', contentTransform: content?.transform ?? 'translateY(4px)',
    };
    dialog.style.setProperty('--modal-from-opacity', frame.opacity);
    dialog.style.setProperty('--modal-from-transform', frame.transform);
    dialog.style.setProperty('--veil-from-opacity', frame.veilOpacity);
    dialog.style.setProperty('--veil-from-filter', frame.veilFilter);
    dialog.style.setProperty('--content-from-opacity', frame.contentOpacity);
    dialog.style.setProperty('--content-from-transform', frame.contentTransform);
  });
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (motion.value !== null) { if (!dialog.open) dialog.showModal(); }
    else if (dialog.open) dialog.close();
  }, [motion.value]);
  return { ...motion, ref };
}
