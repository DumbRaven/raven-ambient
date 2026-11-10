// 相集的票根。
//
// 照 docs 里那六张参考图做的：米白纸、左侧画面四周一圈齿孔、右侧一条窄票根。
// 与参考图不同的只有两处，都是用户 m13607 / m13669 定的：
//   · 参考图是竖版单张票，这里一行四张、一页两行（八张），不用再往下滚；
//   · 票根顶上加了一条 ADMIT ONE 存根，点票时先把它撕走，才算选定。
//
// 撕存根不是装饰。这片子里「点格子」原本是瞬间换台的，点错一张就跳走了；
// 撕这一下既贴题，也给了 300ms 让人看见自己点的是哪张。
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { mediaSrc } from './media';
import { titleOf } from './media-text';
import {
  pageOf, slipPage, ticketBars, ticketNo, ticketSeat, ticketShowtime,
} from './ticket.ts';
import type { MediaItem } from './records';

/** 撕存根用多久。和 CSS 里 ticket-tear 的关键帧长度保持一致，改一处要改两处。 */
export const TEAR_MS = 300;

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

function Ticket({
  item, index, ready, picked, tearing, onTear,
}: {
  item: MediaItem;
  /** 它在整张列表里的位次——票号印的是这个，不是这一页里的第几张。 */
  index: number;
  ready: boolean;
  picked: boolean;
  tearing: boolean;
  onTear: () => void;
}) {
  const seat = ticketSeat(item.id);
  // 场次由 id 决定：同一个文件永远是同一场，翻页回来不会变。
  const show = ticketShowtime(item.id);
  return (
    <li data-id={item.id} className={tearing ? 'is-tearing' : undefined}>
      <button
        className={`ticket ${picked ? 'is-current' : ''}`}
        data-kind={item.kind}
        onClick={onTear}
        aria-pressed={picked}
        aria-label={`放映 ${titleOf(item)}`}
      >
        {/* 撕走的这一条。ADMIT ONE 印在存根上是真票的做法——检票员拿走的就是这半。 */}
        <span className="ticket-stub" aria-hidden="true">
          <span>ADMIT ONE</span>
          <span>{ticketNo(index)}</span>
        </span>
        <span className="ticket-body">
          <span className="ticket-shot">
            {!ready ? null : item.kind === 'image' ? (
              <img src={mediaSrc(item)} alt="" loading="lazy" decoding="async" />
            ) : (
              <VideoThumb src={mediaSrc(item)} alt="" />
            )}
            {item.kind === 'video' && <i className="media-badge">视频</i>}
          </span>
          <span className="ticket-panel">
            <span className="ticket-mark">CINEMA TICKET</span>
            <b className="ticket-name" title={item.name}>{titleOf(item)}</b>
            <span className="ticket-rule" />
            <span className="ticket-fields">
              <span>{show.date}</span>
              <span>{show.time}</span>
            </span>
            <span className="ticket-fields">
              <span>{seat.seat}</span>
              <span>{seat.row}</span>
            </span>
            <span className="ticket-no">{ticketNo(index)}</span>
            <Barcode id={item.id} />
          </span>
        </span>
      </button>
    </li>
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

export default function MediaTickets({ items, active, seen, currentId, listRef, page, onPage, onPick }: Props) {
  const [tearing, setTearing] = useState('');
  const timer = useRef(0);
  const pageInfo = pageOf(items.length, page);
  const slips = slipPage(items, pageInfo.index);

  // 筛选切到「视频」之后条目数会变，停在越界的页码上会看到一页空白。
  useEffect(() => {
    const safe = pageOf(items.length, page).index;
    if (safe !== page) onPage(safe);
  }, [items.length, page, onPage]);

  // 离开这一页时把还在撕的那张收尾掉，否则回来时会卡在「撕了一半」。
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function tear(id: string) {
    if (tearing) return;
    // 系统里关了动效就直接换台，不让人等一个看不见的 300ms。
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onPick(id);
      return;
    }
    setTearing(id);
    timer.current = window.setTimeout(() => {
      setTearing('');
      onPick(id);
    }, TEAR_MS);
  }

  return (
    <>
      <ul className="ticket-grid" ref={listRef}>
        {slips.map((item, offset) => (
          <Ticket
            key={item.id}
            item={item}
            index={pageInfo.from + offset}
            ready={active && seen.has(item.id)}
            picked={currentId === item.id}
            tearing={tearing === item.id}
            onTear={() => tear(item.id)}
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
          <div className="pager-numbers">
            {Array.from({ length: pageInfo.pages }, (_, index) => (
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
    </>
  );
}
