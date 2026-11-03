/**
 * 浮在画面上的那几块：时间、标题、日期、番茄钟。
 *
 * 关键约束：位置是用户自己拖的，所以每个元素单独记一份相对坐标（0–1），
 * 拖动时换算成百分比写回去。用比例而不是像素，换个窗口大小位置才不会跑。
 *
 * 拖动手感对齐软件里队列那一套：按住就走，松手落位，不弹回、不加惯性。
 * 这里不用长按——叠加元素本来就是「摆着看」的东西，多一步长按只会烦。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { clockText, dateText, overlays as metas, timerText, type OverlayId, type OverlaySpot, type Overlays } from './overlays';

type Props = {
  value: Overlays;
  onChange: (next: Overlays) => void;
  /** 番茄钟剩余毫秒。没有专注在跑时传 null。 */
  remaining: number | null;
  title: string;
  /** 全屏时字大一号；窗口里小一号。 */
  big: boolean;
};

type Drag = { id: OverlayId; box: DOMRect };

export default function OverlayLayer({ value, onChange, remaining, title, big }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // 拖到哪里先记在本地，松手才写回存档：拖动过程中每帧都写 localStorage 会卡。
  const [live, setLive] = useState<Partial<Record<OverlayId, OverlaySpot>>>({});

  const boxOf = useCallback(() => layer.current?.getBoundingClientRect(), []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const box = boxOf();
      if (!box || !box.width || !box.height) return;
      setLive(current => ({
        ...current,
        [drag.id]: {
          x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
          y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
        },
      }));
    };
    const onUp = () => {
      setLive(current => {
        const spot = current[drag.id];
        if (spot) onChange({ ...value, [drag.id]: { ...value[drag.id], spot } });
        return {};
      });
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, boxOf, onChange, value]);

  function start(event: ReactPointerEvent<HTMLDivElement>, id: OverlayId) {
    // 只认主键；右键和滚轮不该把元素拖走
    if (event.button !== 0) return;
    const box = boxOf();
    if (!box) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id, box });
  }

  // 时钟每分钟跳一次就够了，秒针在这里没有意义
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  const text = (id: OverlayId) => {
    if (id === 'clock') return clockText(now);
    if (id === 'date') return dateText(now);
    if (id === 'title') return title;
    return remaining === null ? '--:--' : timerText(remaining);
  };

  const shown = metas.filter(meta => value[meta.id].on);
  if (!shown.length) return null;

  return (
    <div className="overlay-layer" ref={layer} data-big={big ? 'true' : undefined}>
      {shown.map(meta => {
        const spot = live[meta.id] ?? value[meta.id].spot;
        return (
          <div
            key={meta.id}
            className={`overlay overlay-${meta.id} ${drag?.id === meta.id ? 'is-dragging' : ''}`}
            style={{ '--ox': `${spot.x * 100}%`, '--oy': `${spot.y * 100}%` } as CSSProperties}
            onPointerDown={event => start(event, meta.id)}
            title={`拖动调整位置：${meta.name}`}
          >
            {meta.id === 'clock' && <b className="ov-clock">{text('clock')}</b>}
            {meta.id === 'title' && <b className="ov-title">{text('title')}</b>}
            {meta.id === 'date' && <span className="ov-date">{text('date')}</span>}
            {meta.id === 'timer' && (
              <span className="ov-timer">
                <i aria-hidden="true" />
                {text('timer')}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
