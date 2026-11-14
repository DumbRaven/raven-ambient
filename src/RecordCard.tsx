import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import Sleeve from './Sleeve';
import RollNumber from './roll-number';
import type { RecordItem } from './records';
import type { SleeveArt } from './sleeves';

/**
 * 唱片柜里的一格。封面可以掀开，黑胶从里面滑出来——这是这个软件最早的招牌动作。
 * 列表视图只是另一种排法，两种视图共用同一份数据和同一套交互。
 *
 * 唱片盒的开合是三态：'open' 钉住掀开、'closed' 钉住合上、undefined 交给鼠标悬停。
 * 之所以要 'closed'，是因为刚合上时鼠标还停在卡片上，光去掉 'open' 会被 hover
 * 立刻 again 掀开。
 */
export default function RecordCard({ record, cover, art, selected, justAdded, order, flip, playing, onFocus, onSelect }: { record: RecordItem; cover?: string; art?: SleeveArt; selected: boolean; justAdded?: boolean; order: number; flip?: 'open' | 'closed'; playing: boolean; onFocus: () => void; onSelect: () => void }) {
  const mark = useRef<HTMLButtonElement>(null);
  // 加进队列的那一下：圆圈弹一下，外面荡开一圈淡环。
  // 用 WAAPI 而不是切 class——同名 CSS animation 在同一元素上重加不会重播，
  // 而用户连着点同一张是完全可能的。
  useEffect(() => {
    const node = mark.current;
    if (!justAdded || !node || typeof node.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    node.animate(
      [
        { transform: 'scale(0.7)' },
        { transform: 'scale(1.16)', offset: 0.55 },
        { transform: 'scale(1)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
    const ring = document.createElement('span');
    ring.className = 'select-ring';
    node.append(ring);
    ring
      .animate(
        [
          { transform: 'scale(0.7)', opacity: 0.34 },
          { transform: 'scale(2)', opacity: 0 },
        ],
        { duration: 460, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      )
      .finished.then(
        () => ring.remove(),
        () => ring.remove(),
      );
  }, [justAdded]);
  return (
    <li className={`record-card ${selected ? 'selected' : ''}`} data-flip={flip}>
      <button className="record-preview" onClick={onFocus} aria-label={`打开 ${record.name} 的唱片盒`}>
        <Sleeve record={record} cover={cover} art={art} playing={playing} />
      </button>
      <p>
        <button ref={mark} className={`select-record ${selected ? 'on' : ''}`} aria-pressed={selected} aria-label={`${selected ? '取消选择' : '选择'}${record.name}`} onClick={onSelect}>
          {selected ? order > 0 && order <= 9 ? <RollNumber value={order} /> : <Check size={11} /> : null}
        </button>
        <span className="record-name">{record.name}</span>
        {playing && (
          <span className="playing-bars" aria-label="正在播放">
            <i />
            <i />
            <i />
          </span>
        )}
      </p>
    </li>
  );
}
