/**
 * 图层渲染：一份列表，两套皮肤。
 *
 * 合并前这里是两个文件——`OverlayLayer.tsx`（拼贴/照片版式的叠加元素）
 * 和 `DesktopWidgets.tsx`（透明版式的组件）。两边拖动手感、坐标算法、
 * 空状态处理完全一样，只是 className 与字号不同。用户 m12005 问能不能一套，
 * 所以合成这一个：**行为只有一份，皮肤由 `skin` 属性选**。
 *
 * 两套皮肤各自沿用原来的类名（`.overlay-*` / `.dw-*`），CSS 一行不改，
 * 拼贴版式的样子因此和合并前逐像素一致——那是条硬约束。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  clockText,
  dateText,
  findLayer,
  nudgeScale,
  nudgeSpot,
  scaleFromDrag,
  scaleLayer,
  settleAt,
  settleConfirm,
  settleScale,
  settleScaleConfirm,
  timerText,
  type LayerId,
  type LayerList,
  type ScaleMap,
  type SpotMap,
} from './layers';
import { nowLine } from './stage-text';
import type { StageDisc, StageNow } from './TemplateStage';

export type LayerSkin = 'overlay' | 'widgets';

type Props = {
  value: LayerList;
  onChange: (next: LayerList) => void;
  /** 番茄钟剩余毫秒。没有专注在跑时传 null。 */
  remaining: number | null;
  now: StageNow;
  disc?: StageDisc | null;
  title: string;
  /**
   * 能不能拖、能不能删。
   *
   * 两套皮肤的差别在这里：叠加元素一直可拖（它本来就是「摆着看、随手挪」的东西），
   * 组件只在编辑态可拖——放到桌面那个窗口平时是给眼睛看的，不该一点就挪。
   */
  editable: boolean;
  skin: LayerSkin;
  /**
   * 能不能拖右下角那个手柄改大小。
   *
   * 拼贴版式传 false：那套的字号写死在 CSS 里，拖了也不会变，出个手柄反而骗人。
   */
  scalabe?: boolean;
  /** 全屏时叠加元素字大一号（组件皮肤自己有缩放，不看这个）。 */
  big?: boolean;
};

type Drag = { id: LayerId };

type Resize = {
  id: LayerId;
  /** 起手时的倍率 */
  start: number;
  /** 起手时指针到中心的距离，作为 1 倍基准 */
  startDistance: number;
  /** 中心在视口里的坐标，每帧拿它算距离 */
  cx: number;
  cy: number;
};

/** 唱片那块在组件皮肤里的基准直径（相对屏幕高度），乘上各自的 scale。 */
const DISC_BASE = 0.22;

const removeWords: Record<LayerId, string> = {
  clock: '时间',
  date: '日期',
  title: '标题',
  timer: '番茄钟',
  disc: '唱片',
  now: '曲目',
};

export default function LayerStack({ value, onChange, remaining, now, disc, title, editable, skin, scalabe = false, big = false }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // 拖到哪里先记本地，松手才写回存档：每帧写 localStorage 会卡。
  const [live, setLive] = useState<SpotMap>({});
  // 松手之后、上层确认之前，先把位置按在原地。
  // 桌面窗是另一个进程，位置要绕一圈才回来（见 layers.ts 的 settleAt 注释），
  // 不按住的话会先弹回原位再瞬移过去。
  const [settling, setSettling] = useState<SpotMap>({});
  // 缩放同理：松手后先钉住，等上层确认的那份回来再摘。
  const [settlingScale, setSettlingScale] = useState<ScaleMap>({});
  // 正在拖手柄的那一块（手柄按住时元素本身不该跟着拖）
  const [resize, setResize] = useState<Resize | null>(null);
  // 拖动中的倍率先记本地，松手才写回存档
  const [grow, setGrow] = useState<{ id: LayerId; scale: number } | null>(null);
  // 松手那一句不能从 setGrow 的 updater 里读（updater 必须纯函数，StrictMode 会跑两次）
  const resizingRef = useRef<number | null>(null);

  // 上层把新倍率送上来了，就摘掉那一条。
  useEffect(() => {
    setSettlingScale(current => settleScaleConfirm(current, value));
  }, [value]);

  // 上层把新位置送上来了，就把那几条从「等确认」里摘掉。
  // 返回同一个引用时 setState 不会触发重渲染，所以这里可以直接每帧调。
  useEffect(() => {
    setSettling(current => settleConfirm(current, value));
  }, [value]);

  const boxOf = useCallback(() => layer.current?.getBoundingClientRect(), []);

  // 拖动中的坐标同时留一份在 ref 里。
  // **松手那一句不能从 setLive 的 updater 里读**：updater 必须是纯函数，
  // StrictMode 下会被调用两次，`onChange` 会跟着发两条出去（桌面窗那边就是两条命令）。
  const liveRef = useRef<SpotMap>({});
  // 正在拖的那块元素本身。拖拽期间坐标直接写进它的 style，
  // 不走 React——理由见下面 onMove 里的注释。
  const dragEl = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!drag) return;
    /* 坐标写进元素自身，而不是 setLive 触发重渲染。
     *
     * 原来每一帧都 setLive，代价有两层：一是整个 LayerStack 连同它的
     * 「上层刚送来的值是否已确认」两个 effect 一起重跑 60 次/秒；
     * 二是 React 写完 CSS 变量后浏览器还要重新算布局（这几个变量的
     * 消费方是 `.overlay` 的 left/top 与 `.dw` 的 left/top）。
     *
     * 现在只留后者，前者没了。为什么不连 left/top 一起换成 transform：
     * 位置是「占容器的百分比」，而 transform 的百分比是相对元素自身的，
     * 换不过去；改写成像素又会在窗口尺寸变化时错位。这两块本来就是
     * 绝对定位、子节点只有一层，布局代价有限，先只摘掉确定没用的那半。
     *
     * 写的是 React 自己那一对变量名，所以松手后 setSettling 会让 React
     * 把同一个变量写成新值，两边不会打架（值相同，React 也不会重复写）。 */
    const xVar = skin === 'overlay' ? '--ox' : '--wx';
    const yVar = skin === 'overlay' ? '--oy' : '--wy';
    const onMove = (event: PointerEvent) => {
      const box = boxOf();
      if (!box || !box.width || !box.height) return;
      const spot = {
        x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
        y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
      };
      liveRef.current = { ...liveRef.current, [drag.id]: spot };
      const el = dragEl.current;
      if (el) {
        el.style.setProperty(xVar, `${spot.x * 100}%`);
        el.style.setProperty(yVar, `${spot.y * 100}%`);
      }
    };
    const onUp = () => {
      const spot = liveRef.current[drag.id];
      liveRef.current = {};
      // 清掉手里那块元素的引用：松手之后它交给 React 管，
      // 再往它的 style 里写就会和下一次渲染抢同一个变量。
      dragEl.current = null;
      setLive({});
      setDrag(null);
      if (!spot) return;
      // 先钉住，再报上去：这一步是桌面窗「不弹回原位」的全部原因。
      setSettling(pinned => settleAt(pinned, drag.id, spot));
      onChange(value.map(item => (item.id === drag.id ? { ...item, spot } : item)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, boxOf, onChange, value, skin]);

  function start(event: ReactPointerEvent<HTMLDivElement>, id: LayerId) {
    // 只认主键；右键和滚轮不该把元素拖走
    if (!editable || event.button !== 0) return;
    // 删除按钮、缩放手柄自己会处理，按住它们不该把整块拖走
    if ((event.target as HTMLElement).closest('.dw-kill')) return;
    if ((event.target as HTMLElement).closest('.layer-grip')) return;
    event.preventDefault();
    /* 上面那句 preventDefault 同时挡掉了「按下就聚焦」这个默认行为，
       于是鼠标点中一块图层之后焦点仍在别处，方向键挪不动它——键盘用户
       得先 Tab 一圈才轮到刚点的那块。这里把聚焦补回来。
       preventScroll 是必须的：拖动过程中聚焦若触发滚动，画面会跟着跳。 */
    if (editable) event.currentTarget.focus({ preventScroll: true });
    // 指针捕获抓不到就别抓（合成事件、或指针已经抬起时会抛 NotFoundError）。
    // **不能让这一句把后面的 setDrag 一起打断**——曾经没包 try/catch，
    // 探针里量到「按下去之后整块一动不动」。
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 抓不到也没关系：监听绑在 window 上，事件照样会冒上来 */
    }
    // 记下这块元素，pointermove 时直接把坐标写进它，不走 React。
    // 用 currentTarget 而不是 querySelector：同一块图层可能同时有
    // 外层容器与内层壳体两个节点，只有真正绑了指针事件的那个才是位移目标。
    dragEl.current = event.currentTarget;
    setDrag({ id });
  }

  /**
   * 按住右下角的手柄拖：往远离中心的方向拖变大，往里拖变小。
   *
   * 用「到中心的距离比」而不是「拖了多少像素」，是因为元素跟着变大变小、
   * 中心不动，比值正好是它们看到的那个东西（见 layers.ts 的 scaleFromDrag）。
   */
  function gripStart(event: ReactPointerEvent<HTMLButtonElement>, id: LayerId, scale: number) {
    if (!editable || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const box = (event.currentTarget.closest('.dw, .overlay') as HTMLElement | null)?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const startDistance = Math.hypot(event.clientX - cx, event.clientY - cy);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 同上：抓不到也不影响，监听绑在 window 上 */
    }
    setResize({ id, start: scale, startDistance, cx, cy });
  }

  /**
   * 键盘移动：方向键一次挪 1%，Shift + 方向键一次挪 5%。
   *
   * 与拖动走同一个出口（`onChange` + 先钉住再报上去），只是不用指针位置，
   * 而是在现有 spot 上加减。为什么是 1%：视口 1000px 时一格 10px，
   * 按住不放能连发，够细也够快；要快就用 Shift。
   */
  function nudge(event: React.KeyboardEvent<HTMLDivElement>, id: LayerId) {
    if (!editable) return;
    const step = (event.shiftKey ? 5 : 1) / 100;
    const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
    if (!dx && !dy) return;
    // 方向键在这些元素里默认是滚动容器；这里要的是「挪这块」
    event.preventDefault();
    const item = value.find(entry => entry.id === id);
    if (!item) return;
    const current = settling[id] ?? live[id] ?? item.spot;
    const spot = nudgeSpot(current, dx, dy);
    setSettling(pinned => settleAt(pinned, id, spot));
    onChange(value.map(entry => (entry.id === id ? { ...entry, spot } : entry)));
  }

  /**
   * 键盘改大小：+ / - 一次 10%（Shift 25%）。
   *
   * 拖手柄是「到中心的距离比」，键盘没有距离，所以直接改倍率。
   * 边界由 nudgeScale 里的 clampScale 兜，这里不再重复一遍判断。
   */
  function scaleBy(event: React.KeyboardEvent<HTMLButtonElement>, id: LayerId, scale: number) {
    if (!editable) return;
    const step = event.shiftKey ? 0.25 : 0.1;
    const delta = event.key === '+' || event.key === '=' ? step : event.key === '-' || event.key === '_' ? -step : 0;
    if (!delta) return;
    // 手柄在块里面，不拦住的话方向键会连带挪动整块
    event.preventDefault();
    event.stopPropagation();
    const next = nudgeScale(scale, delta);
    setSettlingScale(current => settleScale(current, id, next));
    onChange(scaleLayer(value, id, next));
  }

  useEffect(() => {
    if (!resize) return;
    const onMove = (event: PointerEvent) => {
      const distance = Math.hypot(event.clientX - resize.cx, event.clientY - resize.cy);
      const next = scaleFromDrag(resize.start, resize.startDistance, distance);
      resizingRef.current = next;
      setGrow({ id: resize.id, scale: next });
    };
    const onUp = () => {
      const scale = resizingRef.current;
      resizingRef.current = null;
      setResize(null);
      setGrow(null);
      if (scale === null) return;
      // 与拖动同理：先钉住，再报上去（桌面窗是另一个进程，见 layers.ts 的 settleAt）
      setSettlingScale(current => settleScale(current, resize.id, scale));
      onChange(value.map(item => (item.id === resize.id ? { ...item, scale } : item)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resize, onChange, value]);

  // 时钟看的是「分」，不是「秒」。20 秒一跳足够让分钟跟上（最坏晚 20 秒），
  // 而日期跨零点也在这条链上——所以这里不能真的写成「每分钟」，那样用户
  // 盯着表看时会发现分钟最多晚 60 秒才变。20 秒是刻意选的小一个量级。
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setAt(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!value.length) {
    // 一件都没有。组件皮肤在编辑态给一句「怎么开始」（空状态的第一步，
    // 「界面不加解释」允许的例外）；其余情况什么都不画。
    return editable && skin === 'widgets' ? (
      <div className="desktop-widgets desktop-widgets-empty">
        {/* 这句曾经写的是「用控制条上的「＋」加一个组件」——那个「＋」早就没了，
            现在加东西走「图层」那颗按钮（用户 m12760 第 4 条：「透明的界面
            说明文字改一下，不匹配了」）。空状态的第一步是「界面不加解释」
            允许的三类文字之一，所以留一句，但必须指着真实存在的东西。 */}
        <p>点控制条上的「图层」，加一块组件</p>
      </div>
    ) : null;
  }

  const text = (id: LayerId) => {
    if (id === 'clock') return clockText(at);
    if (id === 'date') return dateText(at);
    if (id === 'title') return title;
    if (id === 'timer') return remaining === null ? '--:--' : timerText(remaining);
    if (id === 'now') return nowLine(now);
    return '';
  };

  // 拼贴/照片：沿用原来的类名与结构，样式一行没动。
  if (skin === 'overlay') {
    return (
      <div className="overlay-layer" ref={layer} data-big={big ? 'true' : undefined}>
        {value.map(item => {
          const spot = live[item.id] ?? settling[item.id] ?? item.spot;
          const scale = grow?.id === item.id ? grow.scale : (settlingScale[item.id] ?? item.scale);
          return (
            <div
              key={item.id}
              className={`overlay overlay-${item.id} ${drag?.id === item.id ? 'is-dragging' : ''}`}
              style={
                {
                  '--ox': `${spot.x * 100}%`,
                  '--oy': `${spot.y * 100}%`,
                  /* 拼贴版式永远是 1 倍：它没有手柄，用户在那里改不了，
                     却跟着照片版式调过的倍率一起变，只会像「自己动了」。
                     用户 m12474 的原话是「拼贴不改，照片改」。 */
                  '--oscale': scalabe ? scale : 1,
                } as CSSProperties
              }
              onPointerDown={event => start(event, item.id)}
              onKeyDown={event => nudge(event, item.id)}
              tabIndex={editable ? 0 : undefined}
              role={editable ? 'group' : undefined}
              aria-label={editable ? `${removeWords[item.id]}，方向键移动位置` : undefined}
              title={findLayer(item.id) ? `拖动调整位置：${findLayer(item.id)!.name}` : undefined}
            >
              {item.id === 'clock' && <b className="ov-clock">{text('clock')}</b>}
              {item.id === 'date' && <span className="ov-date">{text('date')}</span>}
              {item.id === 'title' && <b className="ov-title">{text('title')}</b>}
              {item.id === 'timer' && (
                <span className="ov-timer">
                  <i aria-hidden="true" />
                  {text('timer')}
                </span>
              )}
              {item.id === 'now' && <span className="ov-now">{text('now') || '还没在放'}</span>}
              {item.id === 'disc' && (
                <span className={`ov-disc ${disc ? 'has-disc' : ''} ${disc?.spinning ? 'is-spinning' : ''}`}>
                  <span
                    className="ov-disc-label"
                    style={disc?.cover ? { backgroundImage: `url("${disc.cover}")` } : undefined}
                  />
                </span>
              )}
              {scalabe && editable && (
                <button
                  type="button"
                  className="layer-grip"
                  aria-label={`改变${removeWords[item.id]}的大小：拖动手柄，或用 + / - 键`}
                  onPointerDown={event => gripStart(event, item.id, scale)}
                  onKeyDown={event => scaleBy(event, item.id, scale)}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // 透明：原来 DesktopWidgets 的结构，逐字保留。
  return (
    <div className="desktop-widgets" ref={layer} data-editable={editable ? 'true' : undefined}>
      {value.map(item => {
        const spot = live[item.id] ?? settling[item.id] ?? item.spot;
        const scale = grow?.id === item.id ? grow.scale : (settlingScale[item.id] ?? item.scale);
        const style = {
          '--wx': `${spot.x * 100}%`,
          '--wy': `${spot.y * 100}%`,
          '--wscale': scale,
          '--disc-size': `${DISC_BASE * scale * 100}vh`,
        } as CSSProperties;
        const dragging = drag?.id === item.id;
        return (
          <div
            key={item.id}
            className={`dw dw-${item.id} ${dragging ? 'is-dragging' : ''}`}
            style={style}
            onPointerDown={event => start(event, item.id)}
            onKeyDown={event => nudge(event, item.id)}
            data-editable={editable ? 'true' : undefined}
            tabIndex={editable ? 0 : undefined}
            role={editable ? 'group' : undefined}
            aria-label={editable ? `${removeWords[item.id]}，方向键移动位置` : undefined}
          >
            {item.id === 'clock' && <b className="dw-clock">{text('clock')}</b>}
            {item.id === 'date' && <span className="dw-date">{text('date')}</span>}
            {item.id === 'title' && <b className="dw-title">{text('title')}</b>}
            {item.id === 'timer' && (
              <span className="dw-timer">
                <i aria-hidden="true" />
                {text('timer')}
              </span>
            )}
            {item.id === 'disc' && (
              <span className={`dw-disc ${disc ? 'has-disc' : ''} ${disc?.spinning ? 'is-spinning' : ''}`}>
                <span
                  className="dw-disc-label"
                  style={disc?.cover ? { backgroundImage: `url("${disc.cover}")` } : undefined}
                />
              </span>
            )}
            {item.id === 'now' && <span className="dw-now">{text('now') || '还没在放'}</span>}

            {scalabe && editable && (
              <button
                type="button"
                className="layer-grip"
                aria-label={`改变${removeWords[item.id]}的大小：拖动手柄，或用 + / - 键`}
                onPointerDown={event => gripStart(event, item.id, scale)}
                onKeyDown={event => scaleBy(event, item.id, scale)}
              />
            )}

            {editable && (
              <button
                type="button"
                className="dw-kill"
                aria-label={`移除${removeWords[item.id]}`}
                onClick={event => {
                  event.stopPropagation();
                  onChange(value.filter(entry => entry.id !== item.id));
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
