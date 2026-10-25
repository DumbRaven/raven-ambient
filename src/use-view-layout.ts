import { useLayoutEffect, useRef } from 'react';
import { HeightMotion } from './height-motion';
import { heightTiming, type MotionState } from './motion-state';

export function useViewLayout(motion: MotionState<string>, selectedView: string) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const height = useRef<HeightMotion | null>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current, content = contentRef.current;
    if (!stage || !content) return;
    height.current ??= new HeightMotion(stage);
    if (motion.phase === 'exit') height.current.hold();
    else if (motion.phase === 'enter') height.current.to(content.getBoundingClientRect().height, heightTiming.enter);
    else height.current.reset();
  }, [motion.value, motion.phase]);
  useLayoutEffect(() => () => height.current?.reset(), []);

  useLayoutEffect(() => {
    const nav = navigationRef.current;
    if (!nav) return;
    const update = () => {
      const button = nav.querySelector<HTMLElement>('button.active');
      if (!button) return;
      const bounds = button.getBoundingClientRect(), origin = nav.getBoundingClientRect();
      nav.style.setProperty('--nav-marker-x', `${bounds.left - origin.left}px`);
      nav.style.setProperty('--nav-marker-width', `${bounds.width}px`);
    };
    update();
    const ready = requestAnimationFrame(() => { nav.dataset.markerReady = 'true'; });
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    nav.querySelectorAll('button').forEach(button => observer.observe(button));
    return () => { cancelAnimationFrame(ready); observer.disconnect(); };
  }, [selectedView]);
  return { stageRef, contentRef, navigationRef };
}
