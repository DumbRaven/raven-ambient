import { useRef } from 'react';
import { X } from 'lucide-react';
import { useMotion } from './use-motion';

const noticeTiming = { enter: 180, exit: 140 };

export default function MotionNotice({ message, onClose }: { message: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotion(message || null, noticeTiming, undefined, next => {
    if (!ref.current || next.phase === 'idle') return;
    const current = getComputedStyle(ref.current);
    const opacity = current.opacity, transform = current.transform;
    ref.current.style.setProperty('--notice-from-opacity', opacity);
    ref.current.style.setProperty('--notice-from-transform', transform);
  });
  if (!motion.value) return null;
  return <div ref={ref} className="toast motion-notice" data-motion={motion.phase} role="status" inert={motion.phase === 'exit'}>
    <span>{motion.value}</span><button aria-label="关闭提示" className="icon-button" onClick={onClose}><X size={13} /></button>
  </div>;
}
