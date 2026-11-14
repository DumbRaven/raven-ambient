import { ArrowRight, Check, Play, Plus, Settings2, Square, Trash2 } from 'lucide-react';
import Slider from './Slider';
import Vinyl from './VinylDisc';
import { formatTime } from './model';
import { depthRange, describeDepth } from './ducking';
import type { RecordItem } from './records';

/**
 * 右侧的唱片介绍面板。
 *
 * 这一列是「选中一张唱片之后能对它做什么」的唯一入口：改介绍、试听、移除、
 * 加入此刻、调音量，环境音还多三项微调。所以它按「先看、再动、最后精调」
 * 从上往下排，而不是按数据字段的顺序。
 *
 * 试听和移除是两件事：试听播 8 秒自动收，移除要点两下才生效（第一下变红）。
 * 两个按钮都放在标题下面，因为「我现在要听它」和「我不想要它了」是看完
 * 介绍后最先产生的两个念头。
 */
export default function RecordNotes({ record, cover, playing, selected, previewing, confirming, onEdit, onPreview, onRemove, onSelect, onChange }: {
  record: RecordItem;
  cover?: string;
  playing: boolean;
  selected: boolean;
  previewing: boolean;
  confirming: boolean;
  onEdit: () => void;
  onPreview: () => void;
  onRemove: () => void;
  onSelect: () => void;
  onChange: (changes: Partial<RecordItem>) => void;
}) {
  return (
    <>
      <div className="notes-disc">
        <Vinyl record={record} color={record.color} cover={cover} spinning={playing} />
      </div>

      <div className="record-type">{record.category === 'music' ? 'SIDE A — 音乐' : 'SIDE B — 环境音'}</div>
      <h2>{record.name}</h2>
      <p className="artist">{record.artist}</p>
      <div className="fine-rule" />
      <p className="record-description">{record.description || '有些声音不必解释。\n也可以为它写下一段，\n只属于你的介绍。'}</p>

      <div className="notes-actions">
        <button className="text-button edit-notes" onClick={onEdit}>
          编辑介绍与封面
          <ArrowRight size={12} />
        </button>
        <button className={`icon-button notes-preview ${previewing ? 'on' : ''}`} aria-label={previewing ? '停止试听' : `试听 ${record.name}`} aria-pressed={previewing} onClick={onPreview}>
          {previewing ? <Square size={12} /> : <Play size={12} />}
        </button>
        <button className={`icon-button notes-remove ${confirming ? 'armed' : ''}`} aria-label={confirming ? `确认移除 ${record.name}` : `从唱片柜移除 ${record.name}`} onClick={onRemove}>
          {confirming ? <Check size={13} /> : <Trash2 size={13} />}
        </button>
      </div>

      <dl className="record-meta">
        <div>
          <dt>时长</dt>
          <dd>{record.duration ? formatTime(record.duration) : '—'}</dd>
        </div>
        <div>
          <dt>格式</dt>
          <dd>{record.format}</dd>
        </div>
        <div>
          <dt>播放</dt>
          <dd>{record.category === 'music' ? '顺序播放' : '循环叠加'}</dd>
        </div>
      </dl>

      <button className={`notes-select ${selected ? 'chosen' : ''}`} onClick={onSelect}>
        {selected ? <Check size={13} /> : <Plus size={13} />}
        {selected ? '已加入此刻' : '加入此刻'}
      </button>

      <Slider label="唱片音量" max={100} value={record.volume} onChange={volume => onChange({ volume })} />

      {record.category === 'ambient' && (
        <details className="sound-tweaks">
          <summary>
            声音微调 <Settings2 size={12} />
          </summary>
          <Slider label="左右位置" min={-100} value={record.pan} unit="" onChange={pan => onChange({ pan })} />
          <Slider label="柔和程度" value={record.warmth} onChange={warmth => onChange({ warmth })} />
          <Slider label="避让幅度" max={depthRange.max} value={record.duckDepth} unit=" dB" onChange={duckDepth => onChange({ duckDepth })} />
          <p className="tweak-help">{record.duckDepth === 0 ? '这张唱片保持原音量，不随音乐变轻。' : `音乐响起时，这张唱片让出 ${record.duckDepth} dB，${describeDepth(record.duckDepth)}。`}</p>
        </details>
      )}
    </>
  );
}
