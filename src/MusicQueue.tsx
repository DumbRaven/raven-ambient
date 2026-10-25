import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Pause, Play, X } from 'lucide-react';
import { moveItem, type RecordItem } from './records';
import { formatTime } from './model';
import { pointerSession } from './pointer-session';
import { clampQueueOffset, queueDropIndex, queueOffsets, type QueueSlot } from './queue-layout';
import RollNumber from './roll-number';

type Drag = { id: string; queue: string[]; from: number; to: number; offset: number; slots: QueueSlot[]; settling: boolean };
type Props = {
  queue: string[]; records: RecordItem[]; currentId?: string;
  onPlay: (id: string) => void; onRemove: (record: RecordItem) => void; onReorder: (queue: string[]) => void;
  /** 环境音队列：没有「正在播放的那一首」，序号改成圈数，拖拽排序照旧。 */
  variant?: 'music' | 'ambient';
  /** 环境音里被单独关掉的那些（记录 id）。 */
  muted?: string[];
  /** 环境音单独开关。传了才渲染每行的播放 / 暂停。 */
  onToggle?: (record: RecordItem) => void;
};

export default function MusicQueue({ queue, records, currentId, onPlay, onRemove, onReorder, variant = 'music', muted = [], onToggle }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const cancelPointer = useRef<(() => void) | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const mounted = useRef(true);
  const [settledId, setSettledId] = useState<string | null>(null);
  const settleLineTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ queue, onReorder }); latest.current = { queue, onReorder };
  const publish = (next: Drag | null) => { dragRef.current = next; if (mounted.current) setDrag(next); };
  const cancel = () => {
    cancelPointer.current?.();
    clearTimeout(settleTimer.current); settleTimer.current = undefined;
    clearTimeout(settleLineTimer.current); settleLineTimer.current = undefined;
    if (mounted.current) setSettledId(null);
    publish(null); document.body.classList.remove('is-dragging-queue');
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
  }, []);
  useEffect(() => {
    const active = dragRef.current;
    if (active && (queue.length !== active.queue.length || queue.some((id, index) => id !== active.queue[index]))) cancel();
  }, [queue]);

  function beginDrag(event: ReactPointerEvent<HTMLLIElement>, from: number) {
    if (event.button !== 0 || !event.isPrimary || queue.length < 2 || dragRef.current?.settling) return;
    if ((event.target as HTMLElement).closest('.queue-remove, .queue-toggle')) return;
    cancel(); suppressClick.current = false;
    const target = event.currentTarget, pointerId = event.pointerId;
    const startY = event.clientY, scrollY = window.scrollY;
    let lastY = startY, armed = false;
    const original = [...queue];
    let holdTimer: ReturnType<typeof setTimeout>;
    const finish = (drop: boolean) => {
      clearTimeout(holdTimer); cancelPointer.current = null;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', abort);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      try { target.releasePointerCapture(pointerId); } catch { /* 已释放或未捕获 */ }
      document.body.classList.remove('is-dragging-queue');
      const current = dragRef.current;
      if (!armed || !drop || !current || !mounted.current) { publish(null); return; }
      const offsets = queueOffsets(current.slots, current.from, current.to);
      publish({ ...current, offset: offsets[current.from], settling: true });
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
      settleTimer.current = setTimeout(() => {
        settleTimer.current = undefined;
        publish(null);
        if (current.from !== current.to && original.length === latest.current.queue.length && original.every((id, index) => latest.current.queue[index] === id)) {
          latest.current.onReorder(moveItem(original, current.from, current.to));
          // 落位之后才画线：先让卡片停稳，再给一个「已确认」的收尾
          if (mounted.current) {
            setSettledId(current.id);
            clearTimeout(settleLineTimer.current);
            settleLineTimer.current = setTimeout(() => {
              settleLineTimer.current = undefined;
              if (mounted.current) setSettledId(null);
            }, 460);
          }
        }
      }, duration);
    };
    const moveTo = () => {
      const current = dragRef.current;
      if (!current || current.settling) return;
      const offset = clampQueueOffset(current.slots, from, lastY - startY + window.scrollY - scrollY);
      publish({ ...current, offset, to: queueDropIndex(current.slots, from, offset) });
    };
    const onMove = (move: PointerEvent) => {
      lastY = move.clientY;
      if (!armed) { if (Math.abs(lastY - startY) > 8) { suppressClick.current = true; cancelPointer.current?.(); } return; }
      move.preventDefault(); moveTo();
    };
    const abort = () => cancelPointer.current?.();
    const onKey = (key: KeyboardEvent) => { if (key.key === 'Escape') { key.preventDefault(); abort(); } };
    const onVisibility = () => { if (document.hidden) abort(); };
    const onScroll = () => { if (armed) moveTo(); else if (Math.abs(window.scrollY - scrollY) > 1) abort(); };
    cancelPointer.current = pointerSession(window, pointerId, onMove, finish);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', abort);
    window.addEventListener('scroll', onScroll);
    document.addEventListener('visibilitychange', onVisibility);
    holdTimer = setTimeout(() => {
      if (!list.current || original.some((id, index) => latest.current.queue[index] !== id)) { abort(); return; }
      const top = list.current.getBoundingClientRect().top;
      const slots = Array.from(list.current.children, row => { const box = row.getBoundingClientRect(); return { top: box.top - top, height: box.height }; });
      armed = true; suppressClick.current = true;
      publish({ id: original[from], queue: original, from, to: from, offset: 0, slots, settling: false });
      try { target.setPointerCapture(pointerId); } catch { /* 测试事件或已失去捕获 */ }
      document.body.classList.add('is-dragging-queue');
    }, 350);
  }

  const offsets = drag ? queueOffsets(drag.slots, drag.from, drag.to) : [];
  const slotStyle = drag ? { '--queue-slot-top': `${drag.slots[drag.from].top + offsets[drag.from]}px`, '--queue-slot-height': `${drag.slots[drag.from].height}px` } as CSSProperties : undefined;
  return <ol ref={list} className={`music-queue reorder-queue${drag ? ' is-reordering' : ''}${variant === 'ambient' ? ' ambient-queue' : ''}`} aria-label={variant === 'ambient' ? '环境音播放队列' : '音乐播放队列'} style={slotStyle}
    onPointerDownCapture={() => { if (!dragRef.current) suppressClick.current = false; }}
    onClickCapture={event => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } }}>
    {queue.map((id, index) => {
      const record = records.find(item => item.id === id)!;
      const lifted = drag?.id === id;
      return <li key={id} data-record-id={id}
        className={['queue-item', variant === 'ambient' ? 'ambient-item' : '', currentId === id ? 'current' : '', lifted ? 'dragging' : '', lifted && drag.settling ? 'settling' : '', settledId === id ? 'settled' : ''].filter(Boolean).join(' ')}
        onPointerDown={event => beginDrag(event, index)}
        style={{ '--queue-y': `${lifted ? drag.offset : offsets[index] ?? 0}px` } as CSSProperties}>
        <span className="queue-number"><RollNumber value={index + 1} minDigits={2} /></span>
        {variant === 'ambient'
          // 环境音是整组一起响的，没有「单独播这一首」，标题就只做展示
          ? <span className={`queue-title static ${muted.includes(id) ? 'is-muted' : ''}`}>{record.name}<small>{muted.includes(id) ? `${record.artist} · 已暂停` : `${record.artist} · 循环叠加`}</small></span>
          : <button className="queue-title" onClick={() => onPlay(id)}>{record.name}<small>{record.artist} · {formatTime(record.duration)}</small></button>}
        {variant === 'ambient' && onToggle && <button
          className={`icon-button queue-toggle ${muted.includes(id) ? '' : 'on'}`}
          aria-pressed={!muted.includes(id)}
          aria-label={`${muted.includes(id) ? '恢复' : '暂停'}${record.name}`}
          title={muted.includes(id) ? '恢复这一路环境音' : '单独暂停这一路环境音'}
          onClick={() => onToggle(record)}>
          {muted.includes(id) ? <Play size={12} fill="currentColor" /> : <Pause size={12} fill="currentColor" />}
        </button>}
        <button className="icon-button queue-remove" aria-label={`从队列移除${record.name}`} onClick={() => onRemove(record)}><X size={13} /></button>
      </li>;
    })}
  </ol>;
}
