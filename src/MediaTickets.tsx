// 相集的票根。
//
// 照 `.tools/ref-ticket/ref-1.jpg` 做的：米白纸、左侧画面四周一圈齿孔、
// 右侧一条窄票根。比例直接取自那张图（1124×563，画面 69.2%、票根 30.6%），
// 量法见 `.tools/ticket-props.cjs`。
//
// 用户 m14144 定的交互：
//   点击 → 票根浮起放大 → 用户自己按住票根往上撕 → 撕开的右半边烧成灰散掉
//   → 左半边画面飞进放映台，成为当前播放项。
//
// 「撕」必须是人拖出来的，不能自动播：这一下既是确认，也是让他看清自己点的是哪张。
// 判据（拖多少算撕开、灰烬怎么散、飞行落点）在 ticket-tear.ts，纯函数，有测试。
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { mediaSrc } from './media';
import { titleOf } from './media-text';
import {
  pageOf, pagerWindow, slipPage, ticketBars, ticketLayout, ticketNo, ticketSeat,
  ticketShowtime, ticketStamp,
} from './ticket.ts';
import {
  ashParticles, flightOf, flightSelectors, pickFlightRect, shouldTear, tearProgress,
} from './ticket-tear.ts';
import { PAPER_FILTER_ID, paperFilterMarkup } from './paper.ts';
import type { MediaItem } from './records';

/** 灰烬全部飘散要多久。和 CSS 里 ticket-ash 的关键帧长度一致，改一处要改两处。 */
export const ASH_MS = 900;
/** 画面从浮层飞进放映台要多久。 */
export const FLY_MS = 520;

/**
 * 视频封面：读元数据之后往后跳一点再画。
 *
 * 只写 preload="metadata" 的话 Chromium 只拿到时长和尺寸，不解第一帧，
 * 票面上就是一块黑。显式 seek 到 0.1 秒才会真的解码出一张画面。
 * 太短的片子退到中点，免得 0.1 秒已经越过末尾。
 */
function VideoThumb({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const seek = () => {
      const span = Number.isFinite(video.duration) ? video.duration : 0;
      const at = span > 0.3 ? 0.1 : span / 2;
      try { video.currentTime = Math.max(0, at); } catch { /* 还没到可以 seek 的状态，等下一次事件 */ }
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [src]);
  return <video ref={ref} src={src} aria-label={alt} preload="metadata" muted playsInline />;
}

/**
 * 票根的抬头。
 *
 * 参考图里这个抬头有两种排法：ref-1 / ref-3 是**沿弧线**排的（两端低、中间高，
 * 每个字母朝外微微转开），两端还各有一个花饰；ref-2 / ref-4 / ref-5 是平平的
 * 两行。弧线版本用逐字 span + CSS transform 做——`text` 沿弧不是纯 CSS 能办的，
 * 而 SVG textPath 又要自己算字号，跟 cqw 那套比例对不上。
 *
 * 每个字母的角度与下沉量按二次曲线给：中间那个不转也不沉，越往两端转得越开
 * 沉得越多。数字序列写在 CSS 的 nth-child 里，这组件只负责拆字。
 */
function TicketMark({ arc = false }: { arc?: boolean }) {
  const text = 'CINEMA TICKET';
  if (!arc) return <span className="ticket-mark">CINEMA TICKET</span>;
  return (
    <span className="ticket-mark ticket-mark-arc" aria-label={text}>
      {[...text].map((char, index) => (
        <span key={index}>{char === ' ' ? '\u00a0' : char}</span>
      ))}
    </span>
  );
}

/** 条码。宽度百分比由 ticketBars 算好，这里只负责排。 */
function Barcode({ id }: { id: string }) {
  return (
    <span className="ticket-bars" aria-hidden="true">
      {ticketBars(id).map((width, index) => (
        <i key={index} style={{ flexGrow: width }} />
      ))}
    </span>
  );
}

/**
 * 票面文字那半边。列表与浮层共用，免得两处排版漂开。
 *
 * 四种骨架照用户给的六张参考图归纳（见 `src/ticket.ts` 的 `TicketLayout`）。
 * 版式由文件 id 定死，不是每次渲染随机的——翻页回来票面变了，一眼就假。
 */
function TicketFace({ item, index }: { item: MediaItem; index: number }) {
  const seat = ticketSeat(item.id);
  // 场次由 id 决定：同一个文件永远是同一场，翻页回来不会变。
  const show = ticketShowtime(item.id);
  const stamp = ticketStamp(item.id);
  const layout = ticketLayout(item.id);
  const name = <b className="ticket-name" title={item.name}>{titleOf(item)}</b>;
  const barcode = <Barcode id={item.id} />;

  if (layout === 'arc') {
    return (
      <span className="ticket-panel" data-layout="arc">
        <span className="ticket-mark">CINEMA TICKET</span>
        <span className="ticket-admit">★ ADMIT ONE ★</span>
        {name}
        <span className="ticket-split">
          <span><span className="ticket-label">DATE</span><span className="ticket-value">{stamp.date}</span></span>
          <span><span className="ticket-label">TIME</span><span className="ticket-value">{stamp.time}</span></span>
        </span>
        <span className="ticket-box">
          <span className="ticket-label">SEAT</span>
          <span className="ticket-value">{stamp.seat}</span>
        </span>
        <span className="ticket-no">{ticketNo(index)}</span>
        {barcode}
      </span>
    );
  }

  if (layout === 'stack') {
    return (
      <span className="ticket-panel" data-layout="stack">
        <span className="ticket-mark">CINEMA TICKET</span>
        <span className="ticket-admit">★ ADMIT ONE ★</span>
        {name}
        <span className="ticket-stack">
          <span><span className="ticket-label">DATE</span><span className="ticket-value">{stamp.date}</span></span>
          <span><span className="ticket-label">TIME</span><span className="ticket-value">{stamp.time}</span></span>
          <span><span className="ticket-label">THEATER</span><span className="ticket-value">{stamp.row}</span></span>
        </span>
        <span className="ticket-code">{stamp.code}</span>
        {barcode}
        <span className="ticket-venue">{stamp.venue}</span>
      </span>
    );
  }

  if (layout === 'editorial') {
    return (
      <span className="ticket-panel" data-layout="editorial">
        <span className="ticket-mark">THE ART OF LIGHT &amp; COLOR</span>
        {name}
        <span className="ticket-admit">★ ADMIT ONE ★</span>
        <span className="ticket-fine">{stamp.fine}</span>
        <span className="ticket-no">{ticketNo(index)}</span>
        {barcode}
        <span className="ticket-venue">{stamp.venue}</span>
      </span>
    );
  }

  // classic 照 ref-1 那张排：拱形抬头、ADMIT ONE、规则线、两三行大衬线片名、
  // 制片两行、规则线、DATE / TIME 各占一行、规则线、SEAT 与 ROW 同一行
  // 分列左右、规则线、砖红票号、条码。参考图上每一段之间都有那道细线，
  // 少了它整块会糊成一片字。
  return (
    <span className="ticket-panel" data-layout="classic">
      <TicketMark arc />
      <span className="ticket-admit">★ ADMIT ONE ★</span>
      <span className="ticket-rule" />
      {name}
      <span className="ticket-credit">A FILM BY</span>
      <span className="ticket-credit">{stamp.venue}</span>
      <span className="ticket-rule" />
      <span className="ticket-lines">
        <span>{show.date}</span>
        <span>{show.time}</span>
      </span>
      <span className="ticket-rule" />
      <span className="ticket-fields">
        <span>{seat.seat}</span>
        <span>{seat.row}</span>
      </span>
      <span className="ticket-rule" />
      <span className="ticket-no">{ticketNo(index)}</span>
      {barcode}
    </span>
  );
}

/** 画面那半边。齿孔由 CSS 的遮罩挖出来。 */
function TicketShot({ item, playing }: { item: MediaItem; playing: boolean }) {
  return (
    <span className="ticket-shot">
      {!playing ? null : item.kind === 'image' ? (
        <img src={mediaSrc(item)} alt="" loading="lazy" decoding="async" />
      ) : (
        <VideoThumb src={mediaSrc(item)} alt="" />
      )}
      {item.kind === 'video' && <i className="media-badge">视频</i>}
    </span>
  );
}

function Ticket({
  item, index, playing, picked, onOpen,
}: {
  item: MediaItem;
  /** 它在整张列表里的位次——票号印的是这个，不是这一页里的第几张。 */
  index: number;
  playing: boolean;
  picked: boolean;
  onOpen: () => void;
}) {
  return (
    <li data-id={item.id}>
      <button
        className={`ticket ${picked ? 'is-current' : ''}`}
        data-kind={item.kind}
        onClick={onOpen}
        aria-pressed={picked}
        aria-label={`放映 ${titleOf(item)}`}
      >
        <TicketShot item={item} playing={playing} />
        <TicketFace item={item} index={index} />
      </button>
    </li>
  );
}

type Phase = 'idle' | 'burning' | 'flying';

/**
 * 浮起来的那一张。
 *
 * 三个阶段各自占一个状态，不用一堆布尔：撕的时候不烧、烧完才飞，
 * 用布尔表达这三种互斥关系会写出八个组合，其中有几个不可能出现。
 */
function TicketStage({
  item, index, template, onClose, onDone,
}: {
  item: MediaItem;
  index: number;
  /** 当前版式。落点按它选：拼贴的画面只占屏幕左上角一块，和相集不是同一个矩形。 */
  template: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [pull, setPull] = useState(0); // 0~1 的撕开进度
  const [flying, setFlying] = useState<{ dx: number; dy: number; scale: number } | null>(null);
  const drag = useRef<{ id: number; startY: number; height: number } | null>(null);
  const timers = useRef<number[]>([]);
  const shotRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const flakes = useRef(ashParticles(item.id));

  useEffect(() => () => { timers.current.forEach(window.clearTimeout); }, []);

  const finish = () => {
    timers.current.push(window.setTimeout(() => onDone(item.id), FLY_MS));
  };

  function burn() {
    setPhase('burning');
    timers.current.push(window.setTimeout(() => {
      // 画面飞向放映台。落点按版式分别取：拼贴的画面块只占屏幕左上 63%×65%，
      // 拿 `.theater-screen` 的话会飞偏、还飞大一圈（用户 m14515 报的就是这个）。
      const from = shotRef.current?.getBoundingClientRect();
      const screen = document.querySelector('.theater-screen')?.getBoundingClientRect();
      if (from && screen) {
        const bounds = { x: screen.x, y: screen.y, w: screen.width, h: screen.height };
        const candidates = flightSelectors(template)
          .map(selector => document.querySelector(selector)?.getBoundingClientRect());
        const to = pickFlightRect(
          candidates.map(rect => (rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null)),
          bounds,
        );
        setFlying(flightOf(
          { x: from.x, y: from.y, w: from.width, h: from.height },
          to,
        ));
      }
      setPhase('flying');
      finish();
    }, ASH_MS));
  }

  function down(event: React.PointerEvent) {
    if (phase !== 'idle' || event.button !== 0) return;
    const panel = (event.currentTarget as HTMLElement).getBoundingClientRect();
    drag.current = { id: event.pointerId, startY: event.clientY, height: panel.height };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    setPull(tearProgress(state.startY - event.clientY, state.height));
  }

  function up(event: React.PointerEvent) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    const dy = state.startY - event.clientY;
    if (shouldTear(dy, state.height)) {
      setPull(1);
      burn();
    } else {
      setPull(0); // 没拖够就弹回去，不撕
    }
  }

  const style = {
    '--pull': pull.toFixed(3),
    ...(flying
      ? {
        '--fly-x': `${flying.dx.toFixed(1)}px`,
        '--fly-y': `${flying.dy.toFixed(1)}px`,
        '--fly-scale': flying.scale.toFixed(3),
      }
      : {}),
  } as React.CSSProperties;

  return (
    <div
      className="ticket-stage"
      data-phase={phase}
      ref={stageRef}
      onClick={event => { if (event.target === stageRef.current) onClose(); }}
    >
      <div className="ticket-lift" style={style}>
        <span className="ticket-lift-shot" ref={shotRef}>
          <TicketShot item={item} playing />
        </span>
        <span
          className="ticket-lift-panel"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <TicketFace item={item} index={index} />
        </span>
        {phase === 'idle' && <span className="ticket-tip">按住票根往上撕</span>}
        {phase !== 'idle' && (
          <span className="ticket-ash" aria-hidden="true">
            {flakes.current.map((flake, i) => (
              <i
                key={i}
                style={{
                  left: `${(flake.x * 100).toFixed(2)}%`,
                  top: `${(flake.y * 100).toFixed(2)}%`,
                  width: `${flake.size}px`,
                  height: `${flake.size}px`,
                  animationDelay: `${flake.delay}ms`,
                  '--ash-x': `${(flake.dx * 100).toFixed(1)}%`,
                  '--ash-y': `${(flake.dy * 100).toFixed(1)}%`,
                  '--ash-rot': `${flake.rot.toFixed(0)}deg`,
                } as React.CSSProperties}
              />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

type Props = {
  items: MediaItem[];
  /** 这一页现在是不是显示着。隐藏时不挂 <video>，免得几十个同时去读文件头。 */
  active: boolean;
  /** 已经进过视口的条目 id。票面图只给这批挂真实元素。 */
  seen: Set<string>;
  /** 播放台上那一件的 id。 */
  currentId: string;
  /** 网格宿主，MediaRoom 在上面挂 IntersectionObserver。 */
  listRef: React.RefObject<HTMLUListElement | null>;
  /** 当前版式。撕完飞向哪儿由它决定（拼贴与相集的画面块不是同一个矩形）。 */
  template: string;
  /**
   * 翻到第几页了。
   *
   * 页号存在外面（MediaRoom），因为它的视口观察器要拿页号当依赖重挂 ——
   * 不重挂的话新一页的 li 没人观察，八张票的封面会一直是空的。
   */
  page: number;
  onPage: (index: number) => void;
  onPick: (id: string) => void;
};

export default function MediaTickets({ items, active, seen, currentId, listRef, template, page, onPage, onPick }: Props) {
  const [openId, setOpenId] = useState('');

  // 纸纹滤镜只需要一份，抹在整个列表与浮层的票根上（CSS 里 filter: url(#id)）。
  // 插在 <body> 上而不是某个票根里：被 mask 裁过的容器里引用滤镜，
  // Chromium 会判它失效、静默退回 none——大理石那轮就是这么空转的。
  useEffect(() => {
    if (document.getElementById(PAPER_FILTER_ID)) return;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-tpl-paper', '');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    host.innerHTML = paperFilterMarkup();
    document.body.appendChild(host);
  }, []);
  const pageInfo = pageOf(items.length, page);
  const slips = slipPage(items, pageInfo.index);
  const opened = openId ? items.find(item => item.id === openId) : undefined;
  const openedIndex = opened ? items.findIndex(item => item.id === opened.id) : 0;

  // 筛选切到「视频」之后条目数会变，停在越界的页码上会看到一页空白。
  useEffect(() => {
    const safe = pageOf(items.length, page).index;
    if (safe !== page) onPage(safe);
  }, [items.length, page, onPage]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenId(''); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  return (
    <>
      <ul className="ticket-grid" ref={listRef}>
        {slips.map((item, offset) => (
          <Ticket
            key={item.id}
            item={item}
            index={pageInfo.from + offset}
            playing={active && seen.has(item.id)}
            picked={currentId === item.id}
            onOpen={() => setOpenId(item.id)}
          />
        ))}
      </ul>
      {pageInfo.pages > 1 && (
        <nav className="ticket-pager" aria-label="票根分页">
          <button
            className="pager-arrow"
            aria-label="上一页"
            disabled={pageInfo.index === 0}
            onClick={() => onPage(pageOf(items.length, pageInfo.index - 1).index)}
          >
            <ChevronLeft size={13} />
          </button>
          <div className="pager-numbers" data-pages={pageInfo.pages}>
            {pagerWindow(pageInfo.index, items.length).map(index => (
              <button
                key={index}
                className={index === pageInfo.index ? 'active' : ''}
                aria-label={`第 ${index + 1} 页`}
                aria-current={index === pageInfo.index ? 'page' : undefined}
                onClick={() => onPage(pageOf(items.length, index).index)}
              >
                {String(index + 1).padStart(2, '0')}
              </button>
            ))}
          </div>
          <button
            className="pager-arrow"
            aria-label="下一页"
            disabled={pageInfo.index === pageInfo.pages - 1}
            onClick={() => onPage(pageOf(items.length, pageInfo.index + 1).index)}
          >
            <ChevronRight size={13} />
          </button>
        </nav>
      )}
      {opened && (
        <TicketStage
          key={opened.id}
          item={opened}
          index={openedIndex}
          template={template}
          onClose={() => setOpenId('')}
          onDone={id => { setOpenId(''); onPick(id); }}
        />
      )}
    </>
  );
}
