import { type CSSProperties } from 'react';
import { Disc3, Headphones, ImagePlus, Timer } from 'lucide-react';
import { formatTime } from './model';

export type ViewId = 'cabinet' | 'listening' | 'focus' | 'media';

const TABS: { id: ViewId; label: string; Icon: typeof Disc3 }[] = [
  { id: 'cabinet', label: '唱片柜', Icon: Disc3 },
  { id: 'listening', label: '正在听', Icon: Headphones },
  { id: 'focus', label: '专注', Icon: Timer },
  { id: 'media', label: '相集', Icon: ImagePlus },
];

/**
 * 空间导航：四个页签 + 右边那颗圆碟。
 *
 * 圆碟放在页签栏里而不是独立成一行，因为它是「播放器」的开关，
 * 而播放器是这四个空间的公共状态——它不属于任何一个页签。
 * 播放中时圆碟显示当前封面，省掉一块「正在播放」的常驻区域。
 *
 * 黑色滑块用 --flip-x / --flip-width 跟着激活的页签走，由
 * useViewLayout 在尺寸变化时重算（用 offset* 而不是 getBoundingClientRect，
 * 因为外层 .view-stage 带着 transform: scale()）。
 */
export default function ViewTabs({ view, playing, cardOpen, discCover, sleepUntil, remaining, navigationRef, onSelect, onCard }: {
  view: ViewId;
  playing: boolean;
  cardOpen: boolean;
  discCover?: string;
  sleepUntil: number;
  remaining: number;
  navigationRef: React.RefObject<HTMLElement | null>;
  onSelect: (next: ViewId, trigger: HTMLElement) => void;
  onCard: () => void;
}) {
  return (
    <nav ref={navigationRef as React.RefObject<HTMLElement>} className="view-tabs" aria-label="空间导航">
      <span className="nav-marker" aria-hidden="true" />
      {TABS.map(({ id, label, Icon }) => (
        <button key={id} className={view === id ? 'active' : ''} onClick={event => onSelect(id, event.currentTarget)} aria-label={label}>
          <Icon size={15} />
          <span className="tab-label">{label}</span>
        </button>
      ))}
      <span className="dock-disc-slot">
        <button className={`dock-disc ${playing ? 'playing' : ''}`} aria-label={playing ? '打开播放器（正在播放）' : '打开播放器'} aria-expanded={cardOpen} onClick={onCard} style={discCover ? ({ backgroundImage: `url("${discCover}")` } as CSSProperties) : undefined}>
          {!discCover && <Disc3 size={17} strokeWidth={1.4} />}
          {sleepUntil > 0 && <i className="dock-disc-sleep" title={`${formatTime(remaining)} 后休息`} />}
        </button>
      </span>
    </nav>
  );
}
