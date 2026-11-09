/**
 * 透明模式的小组件层。
 *
 * 这一层是那个模式的全部内容：没有画面块、没有底色，只有用户自己加上来的
 * 几块东西，浮在桌面壁纸上面。所以这里的每一块都要自己保证「压在任意壁纸上
 * 都读得出来」——壁纸可能是雪原也可能是黑洞，不能只靠颜色，得靠一层薄描边
 * 加阴影（见 skin-bold.css 的 `.dw` 那一组）。
 *
 * 拖动手感和放映页的叠加元素一致：按住就走、松手落位，不弹回、不加惯性。
 * 位置换算成 0–1 的比例写回，换屏幕不会跑。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { clockText, dateText, timerText } from './overlays';
import { nowLine } from './stage-text';
import type { StageDisc, StageNow } from './TemplateStage';
import type { WidgetId, WidgetList, WidgetSpot } from './widgets';

type Props = {
  value: WidgetList;
  onChange: (next: WidgetList) => void;
  /** 番茄钟剩余毫秒；没有专注在跑时传 null。 */
  remaining: number | null;
  now: StageNow;
  disc?: StageDisc | null;
  title: string;
  /** 编辑态：悬停出删除按钮、指针变抓手。放到桌面时不进编辑态。 */
  editable: boolean;
};

type Drag = { id: WidgetId };

/** 唱片那块的字号跟着缩放走，这里只给一个基准直径（相对屏幕高度）。 */
const DISC_BASE = 0.22;

export default function DesktopWidgets({ value, onChange, remaining, now, disc, title, editable }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // 拖到哪里先记本地，松手才写回存档：每帧写 localStorage 会卡。
  const [live, setLive] = useState<Partial<Record<WidgetId, WidgetSpot>>>({});

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
        if (spot) onChange(value.map(widget => (widget.id === drag.id ? { ...widget, spot } : widget)));
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

  function start(event: ReactPointerEvent<HTMLDivElement>, id: WidgetId) {
    if (!editable || event.button !== 0) return;
    // 删除按钮自己会处理点击，按住它不该把整块拖走
    if ((event.target as HTMLElement).closest('.dw-kill')) return;
    const box = boxOf();
    if (!box) return;
    event.preventDefault();
    // 指针捕获抓不到就别抓（合成事件、或指针已经抬起时会抛 NotFoundError）。
    // **不能让这一句把后面的 setDrag 一起打断**——第一版没包 try/catch，
    // 探针里量到「按下去之后整块一动不动」，就是这个原因。
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 抓不到也没关系：下面的监听绑在 window 上，事件照样会冒上来 */
    }
    setDrag({ id });
  }

  // 时钟每分钟跳一次就够。日期跟着分钟走，跨零点自然翻页。
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setAt(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!value.length) {
    // 一件都没有：编辑态给一句「怎么开始」，非编辑态（放到桌面）什么都不画。
    // 这是「界面不加解释」里允许的例外——空状态的第一步。
    return editable ? (
      <div className="desktop-widgets desktop-widgets-empty">
        <p>用控制条上的「＋」加一个组件</p>
      </div>
    ) : null;
  }

  const text = (id: WidgetId) => {
    if (id === 'clock') return clockText(at);
    if (id === 'date') return dateText(at);
    if (id === 'title') return title;
    if (id === 'timer') return remaining === null ? '--:--' : timerText(remaining);
    if (id === 'now') return nowLine(now);
    return '';
  };

  return (
    <div className="desktop-widgets" ref={layer} data-editable={editable ? 'true' : undefined}>
      {value.map(widget => {
        const spot = live[widget.id] ?? widget.spot;
        const style = {
          '--wx': `${spot.x * 100}%`,
          '--wy': `${spot.y * 100}%`,
          '--wscale': widget.scale,
          '--disc-size': `${DISC_BASE * widget.scale * 100}vh`,
        } as CSSProperties;
        const dragging = drag?.id === widget.id;
        return (
          <div
            key={widget.id}
            className={`dw dw-${widget.id} ${dragging ? 'is-dragging' : ''}`}
            style={style}
            onPointerDown={event => start(event, widget.id)}
            data-editable={editable ? 'true' : undefined}
          >
            {widget.id === 'clock' && <b className="dw-clock">{text('clock')}</b>}
            {widget.id === 'date' && <span className="dw-date">{text('date')}</span>}
            {widget.id === 'title' && <b className="dw-title">{text('title')}</b>}
            {widget.id === 'timer' && (
              <span className="dw-timer">
                <i aria-hidden="true" />
                {text('timer')}
              </span>
            )}
            {widget.id === 'disc' && (
              <span className={`dw-disc ${disc ? 'has-disc' : ''} ${disc?.spinning ? 'is-spinning' : ''}`}>
                <span
                  className="dw-disc-label"
                  style={disc?.cover ? { backgroundImage: `url("${disc.cover}")` } : undefined}
                />
                <i className="dw-disc-hole" />
              </span>
            )}
            {widget.id === 'now' && <span className="dw-now">{text('now') || '还没在放'}</span>}

            {editable && (
              <button
                type="button"
                className="dw-kill"
                aria-label={`移除${widget.id === 'clock' ? '时间' : widget.id === 'date' ? '日期' : widget.id === 'title' ? '标题' : widget.id === 'timer' ? '番茄钟' : widget.id === 'disc' ? '唱片' : '曲目'}`}
                onClick={event => {
                  event.stopPropagation();
                  onChange(value.filter(item => item.id !== widget.id));
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
