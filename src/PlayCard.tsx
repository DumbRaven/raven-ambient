/**
 * 播放卡：点页签栏右边那颗圆碟弹出来的浮层。
 *
 * 为什么不做成页面的一部分：这一层要能盖在任何视图上面（唱片柜、正在听、专注），
 * 而且不该影响下面的排版。所以挂一个浮层，点外面或再点圆碟就收起来。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, Waves } from 'lucide-react';
import type { PlayOrder } from './records';
import { orderNames } from './records';

/** 波形柱子的数量。48 根在 640 宽的卡里每根间隔约 5px，够密也够轻。 */
const BARS = 32;

export default function PlayCard({
  open, playing, title, subtitle, cover, time, duration, timeValue, durationValue, level,
  musicOn, ambientOn, musicReady, lineMode, order, master,
  onClose, onToggle, onPrev, onNext, onSeek, onToggleMusic, onToggleAmbient, onOrder, onMaster,
}: {
  open: boolean;
  playing: boolean;
  title: string;
  subtitle: string;
  cover?: string;
  time: string;
  duration: string;
  /** 秒数形式的进度，画进度条用。字符串那份只拿来显示。 */
  timeValue: number;
  durationValue: number;
  /** 实时电平（0–1），由父组件每帧从引擎读出来后传下来。 */
  level: number;
  musicOn: boolean;
  ambientOn: boolean;
  musicReady: boolean;
  lineMode: boolean;
  order: PlayOrder;
  master: number;
  onClose: () => void;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onToggleMusic: () => void;
  onToggleAmbient: () => void;
  onOrder: () => void;
  onMaster: (value: number) => void;
}) {
  // 波形自己攒历史：引擎每帧给一个瞬时 RMS，滚成一条会动的曲线才像「在响」。
  // 用 ref 存数组、直接改 DOM 的 --h，不走 setState——每帧 setState 会把整棵树拖着重渲染。
  const bars = useRef<HTMLSpanElement[]>([]);
  const history = useRef<number[]>(new Array(BARS).fill(0));
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const tick = () => {
      const next = history.current.slice(1);
      // 开方是为了让小音量也看得见起伏：线性 RMS 在安静段几乎贴着底。
      // 再乘 2.1：纯开方在正常音量下也只到 0.3 左右，波形看着像一条直线。
      next.push(Math.min(1, Math.sqrt(Math.max(0, levelRef.current)) * 2.1));
      history.current = next;
      bars.current.forEach((bar, index) => { if (bar) bar.style.setProperty('--h', next[index].toFixed(3)); });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // 卡片收起时不能立刻从 DOM 摘掉：那样没有收回动画，是「啪」地消失。
  // 所以自己留一份挂载状态，先播完退出动画再卸载。
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const timer = window.setTimeout(() => { setMounted(false); setLeaving(false); }, 200);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!mounted) return null;

  const percent = durationValue > 0 ? Math.min(1, Math.max(0, timeValue / durationValue)) : 0;

  return (
    <>
      <div className={`play-card-veil ${leaving ? 'is-leaving' : ''}`} onClick={onClose} />
      <div
        className={`play-card ${leaving ? 'is-leaving' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label="正在播放"
      >
        <div className="play-card-head">
          <span className="play-card-cover" style={cover ? { backgroundImage: `url("${cover}")` } : undefined}>
            {!cover && <Music2 size={20} strokeWidth={1.4} />}
          </span>
          <div className="play-card-copy">
            <b title={title}>{title}</b>
            <small>{subtitle}</small>
          </div>
          <button className="play-card-close" aria-label="收起播放器" onClick={onClose}>×</button>
        </div>

        <div className="play-card-wave" aria-hidden="true">
          {Array.from({ length: BARS }, (_, index) => (
            <span key={index} ref={element => { if (element) bars.current[index] = element; }} />
          ))}
        </div>

        <div className="play-card-progress">
          <span>{time}</span>
          <input
            type="range" aria-label="音乐进度" min={0} max={1000} step={1} value={Math.round(percent * 1000)}
            disabled={durationValue <= 0} onChange={event => onSeek(Number(event.target.value) / 1000)}
            style={{ '--fill': `${percent * 100}%` } as CSSProperties}
          />
          <span>{duration}</span>
        </div>

        <div className="play-card-transport">
          <button className="icon-button order-button" aria-label={lineMode ? '外部音乐模式：顺序由播放器决定' : `播放顺序：${orderNames[order]}`} title={lineMode ? '顺序由外部播放器决定' : orderNames[order]} disabled={lineMode} onClick={onOrder}>
            {order === 'repeat-one' ? <Repeat1 size={15} /> : order === 'shuffle' ? <Shuffle size={15} /> : <Repeat size={15} />}
          </button>
          <button className="icon-button" aria-label="上一首" onClick={onPrev}><SkipBack size={16} /></button>
          <button className="main-play" aria-label={playing ? '暂停' : '播放'} onClick={onToggle}>
            <span className="main-play-icon" key={playing ? 'pause' : 'play'}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</span>
          </button>
          <button className="icon-button" aria-label="下一首" onClick={onNext}><SkipForward size={16} /></button>
          <button className={`icon-button channel-toggle ${ambientOn ? 'on' : ''}`} aria-label={ambientOn ? '暂停环境音' : '播放环境音'} aria-pressed={ambientOn} onClick={onToggleAmbient}>
            <Waves size={15} />
            {!ambientOn && <i className="channel-slash" />}
          </button>
        </div>

        <div className="play-card-foot">
          <button className={`icon-button channel-toggle ${musicOn ? 'on' : ''}`} aria-label={musicOn ? '暂停音乐' : '播放音乐'} aria-pressed={musicOn} disabled={!musicReady || lineMode} title={lineMode ? '外部音乐模式下不播放本地唱片' : undefined} onClick={onToggleMusic}>
            <Music2 size={14} />
            {!musicOn && <i className="channel-slash" />}
          </button>
          <Volume2 size={13} />
          <input className="master-slider" type="range" aria-label="总音量" min={0} max={100} value={master} onChange={event => onMaster(Number(event.target.value))} style={{ '--fill': `${master}%` } as CSSProperties} />
          <span className="play-card-order">{lineMode ? '顺序由外部播放器决定' : orderNames[order]}</span>
        </div>
      </div>
    </>
  );
}
