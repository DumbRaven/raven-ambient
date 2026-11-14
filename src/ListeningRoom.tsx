import { ArrowLeft, X } from 'lucide-react';
import MusicQueue from './MusicQueue';
import RecordPlayer, { type TurntableDisc } from './RecordPlayer';
import AmbientMark from './AmbientMark';
import type { Cabinet, RecordItem } from './records';
import { orderNames } from './records';
import { appLabel, playbackHint } from './now-playing';

/**
 * 「正在听」视图：唱盘 + 标题 + 两条队列。
 *
 * 这个视图的重心是唱盘本身——它是整个软件的视觉中心，所以标题、队列都排在
 * 唱盘之后，而不是先列数据再看机器。外部音乐模式下唱盘上转的是别的播放器
 * 正在放的那首（没有真唱片，用封面和歌名拼一张）。
 */
export default function ListeningRoom({ cabinet, status, externalDisc, shownOutgoing, current, focused, titleRecord, coverFor, nowPlaying, onToggleAmbience, onChoose, onChange, onPlayRecord, onBack }: {
  cabinet: Cabinet;
  status: { running: boolean; musicPlaying: boolean; currentId?: string; ducked: boolean };
  externalDisc?: TurntableDisc;
  shownOutgoing?: RecordItem | null;
  current?: RecordItem;
  focused?: RecordItem;
  titleRecord?: RecordItem | null;
  coverFor: (record: RecordItem) => string | undefined;
  nowPlaying: { app: string; title: string; playing: boolean };
  onToggleAmbience: (record: RecordItem) => void;
  onChoose: (record: RecordItem) => void;
  onChange: (changes: Partial<Cabinet>) => void;
  onPlayRecord: (id: string) => void;
  onBack: () => void;
}) {
  // 外部音乐优先，其次是刚退场的那张，然后是当前播放的。
  // 三者的 key 不同，换碟动画才会重播。
  const externalInfo = externalDisc?.kind === 'external' ? externalDisc.info : undefined;
  const disc = externalInfo ? (
    <div className="platter-disc disc-swap" key={`ext:${externalInfo.app}:${externalInfo.title}`}>
      <RecordPlayer disc={externalDisc!} spinning={status.running && nowPlaying.playing} />
    </div>
  ) : shownOutgoing ? (
    <div className="platter-disc disc-leaving" key={`out:${shownOutgoing.id}`}>
      <RecordPlayer disc={{ kind: 'local', record: shownOutgoing }} cover={coverFor(shownOutgoing)} spinning={status.running && status.musicPlaying} leaving />
    </div>
  ) : (current ?? focused) ? (
    <div className="platter-disc disc-swap" key={`in:${(current ?? focused)!.id}`}>
      <RecordPlayer disc={{ kind: 'local', record: (current ?? focused)! }} cover={coverFor((current ?? focused)!)} spinning={status.running && status.musicPlaying} />
    </div>
  ) : (
    <div className="platter-disc disc-swap" key="empty" />
  );

  const heading = externalInfo
    ? `${appLabel(externalInfo.app)}${playbackHint(externalInfo) ? ' · ' + playbackHint(externalInfo) : ''}`
    : status.running
      ? '正在播放'
      : '待机';
  const title = externalInfo ? externalInfo.title : titleRecord?.name ?? (cabinet.ambience.length ? '环境音的合奏' : '等待一张喜欢的唱片');

  return (
    <section className="listening-room">
      <div className={`turntable ${status.running ? 'is-playing' : ''}`}>
        <div className="platter">{disc}</div>
        <div className="tonearm">
          <span />
          <i />
        </div>
        <span className={`power-light ${status.running ? 'on' : ''}`} />
        <span className="rpm">
          33 ⅓
          <br />
          <small>STEREO</small>
        </span>
      </div>

      <div className="playing-title" key={externalInfo ? `ext:${externalInfo.app}:${externalInfo.title}` : titleRecord?.id ?? 'empty'}>
        <span>{heading}</span>
        <h2>{title}</h2>
      </div>

      {cabinet.lineMode ? (
        <>
          <div className="queue-heading">
            <h3>正在流动的环境音</h3>
            <span>{cabinet.ambience.length} / 8 · 一起循环</span>
          </div>
          <MusicQueue variant="ambient" queue={cabinet.ambience} records={cabinet.records} muted={cabinet.muted} onToggle={onToggleAmbience} onPlay={() => undefined} onRemove={onChoose} onReorder={ambience => onChange({ ambience })} />
          {!cabinet.ambience.length && <p className="queue-empty">外部音乐已经在响了，再选几张环境音，让它有地方落脚。</p>}
          <p className="line-mode-hint">音乐来自外部播放器，{status.ducked ? '正在为你让路。' : '这里只负责环境音。'}</p>
        </>
      ) : (
        <>
          <div className="queue-heading">
            <h3>接下来听什么</h3>
            <span>
              {cabinet.queue.length} 张音乐 · {orderNames[cabinet.order]}
            </span>
          </div>
          <MusicQueue queue={cabinet.queue} records={cabinet.records} currentId={status.currentId} onPlay={onPlayRecord} onRemove={onChoose} onReorder={queue => onChange({ queue })} />
          {!cabinet.queue.length && <p className="queue-empty">还没有音乐唱片，纯粹的环境音也很好听。</p>}
          <div className="queue-heading">
            <h3>一起流动的环境音</h3>
            <span>{cabinet.ambience.length} / 8</span>
          </div>
          <div className="ambient-chips">
            {cabinet.ambience.map(id => {
              const record = cabinet.records.find(r => r.id === id)!;
              return (
                <button key={id} onClick={() => onChoose(record)}>
                  <AmbientMark record={record} />
                  {record.name}
                  <X size={12} />
                </button>
              );
            })}
            {!cabinet.ambience.length && <p className="queue-empty">从唱片柜选几张环境音，给音乐添一点风景。</p>}
          </div>
        </>
      )}

      <button className="text-button back-cabinet" onClick={onBack}>
        <ArrowLeft size={13} />回唱片柜，再挑一张
      </button>
    </section>
  );
}
