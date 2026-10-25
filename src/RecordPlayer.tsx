/**
 * 唱盘上转动的那张碟。
 * 本地唱片走原来的唱片数据；外部音乐模式下换成「外部音乐」拼出来的虚拟唱片，
 * 一样取色、一样走彩胶工艺，只是封面和标题来自别的播放器。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { RecordItem } from './records';
import type { NowPlaying } from './now-playing';
import { hasTrack } from './now-playing';
import { coverPalette, recordPressing, vinylPalette } from './vinyl';
import { launchSeed, sleeveTones } from './sleeves';

export type TurntableDisc =
  | { kind: 'local'; record: RecordItem }
  | { kind: 'external'; info: NowPlaying };

/** 从封面里挑一个稳定的背景色，没有封面时用它兜底。 */
function externalColor(info: NowPlaying): string {
  let hash = 2166136261;
  const text = info.title || 'raven';
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return sleeveTones[(hash >>> 0) % sleeveTones.length].from;
}

export default function RecordPlayer({
  disc,
  spinning,
  leaving = false,
  cover: ownCover,
}: {
  disc: TurntableDisc;
  spinning: boolean;
  leaving?: boolean;
  /**
   * 本地唱片的封面。唱片数据里只有 coverId，真正的图在外面（IndexedDB 读出来的 blob URL）。
   * 不传就只有彩胶、盘心是纯色——之前就是这样漏的。
   */
  cover?: string;
}) {
  const external = disc.kind === 'external' && hasTrack(disc.info) ? disc.info : undefined;
  // 外部音乐没有唱片 id，用「来源 + 歌名」当身份，同一首歌重开也不会换一张胶
  const identity = external ? external.app + '|' + external.title : disc.kind === 'local' ? disc.record.id : 'empty';
  const cover = disc.kind === 'local' ? ownCover || undefined : external?.cover || undefined;
  const color = disc.kind === 'local' ? disc.record.color : externalColor(external ?? disc.info);
  const pressing = recordPressing(identity, launchSeed);
  const [colors, setColors] = useState<string[]>([]);

  useEffect(() => {
    if (!cover) { setColors([]); return; }
    let active = true;
    void coverPalette(cover).then(palette => { if (active) setColors(palette); });
    return () => { active = false; };
  }, [cover]);

  const palette = vinylPalette(colors, color);
  const style = {
    '--record-color': color,
    '--vinyl-base': palette.base,
    '--vinyl-accent': palette.accent,
    '--vinyl-accent-2': palette.accent2,
    '--vinyl-groove': palette.groove,
    '--vinyl-sheen': palette.sheen,
    '--vinyl-angle': pressing.angle + 'deg',
  } as CSSProperties;

  return (
    <span
      className={'vinyl pressing-' + pressing.style + (palette.light ? ' is-light' : '') + (spinning ? ' spinning' : '')}
      style={style}
      data-disc={leaving ? 'outgoing' : 'current'}
    >
      {/* 盘心标签只留底色（有封面时是封面），不再压 RAVEN / 33⅓ 的字样 */}
      <span className="vinyl-label" style={cover ? { backgroundImage: 'url("' + cover + '")' } : undefined} />
      <i className="spindle" />
    </span>
  );
}
