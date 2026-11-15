// 放映页上那几行「此刻」的文字。
//
// 单独放一个纯函数文件，是因为它们只做字符串拼接、不碰 DOM，
// 可以像别的逻辑一样直接测（tests/stage-text.test.ts）。
// 组件文件里塞着这些的话，测试就得连 React 一起拖进来。

/**
 * 此刻真正在响的是什么。
 *
 * 分两条路是必须的：本地模式的数据在 cabinet.records 里，
 * 外部模式的数据来自系统媒体会话（NowPlaying），字段名字都不一样。
 *
 * 主行之外还有一份「副行」：本地是进度 + 播放顺序，外部是专辑。
 * 两边的副行内容不一样，是因为能拿到的数据本来就不一样——
 * 外部播放器的媒体会话只给标题、歌手、专辑，不给播放位置。
 */

import { durationText } from './clock.ts';

export type StageNow =
  | {
      kind: 'local'; title: string; artist: string; playing: boolean;
      /** 播放进度，秒。拿不到时为 0。 */
      at?: number;
      /** 总时长，秒。拿不到时为 0。 */
      span?: number;
      /** 播放顺序的显示名，比如「列表循环」。 */
      order?: string;
    }
  | {
      kind: 'external'; title: string; artist: string; app: string; playing: boolean;
      album?: string;
    }
  | null;

/**
 * 面板主标题：一天里的哪一段。
 *
 * 原来是当前画面的文件名（Ocean、DROWNED DUSK）——那是给视频套版用的，
 * 用户原话「我觉得也不应该写视频的名字」。换成时段词之后，它和下面两行
 * Picked / Just for U 连读是「Late Night, Picked Just for U」，
 * 像一句杂志封面上的话；而且一天里会变，不像固定文案那样永远一个样。
 *
 * 直接用本地时钟，不引入时区库——这台机器就是用户看的那台。
 */
export function timeOfDay(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return 'Late Night';
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

/**
 * 信息条 PLAYLIST 那一行的文字。
 *
 * 外部音乐优先写全三样（歌名 · 歌手 · 播放器）：那时候没有封面可看，
 * 少一样就认不出是哪首。本地模式只写「唱片名 · 艺人」——
 * 播放器就是它自己，写上去是废话。
 * 暂停时补一句「已暂停」，否则一行字看不出声音其实是停的。
 */
export function nowLine(now: StageNow | undefined): string {
  if (!now) return '';
  const parts = now.kind === 'external'
    ? [now.title, now.artist, now.app]
    : [now.title, now.artist];
  const line = parts.filter(Boolean).join(' · ');
  return now.playing ? line : `${line} · 已暂停`;
}

/** 秒 → `m:ss`。超过 60 分钟分钟数继续加（`90:00`），不出小时位。 */
export function clock(seconds: number): string {
  return durationText(seconds);
}

/**
 * PLAYLIST 的副行：主行讲「是哪一首」，这一行讲「放到哪了」。
 *
 * 本地模式有进度也有播放顺序；外部模式两样都拿不到（系统媒体会话只给
 * 标题/歌手/专辑），所以如实换成专辑——**不要编一个假进度出来**，
 * 那会让人以为播放器真的在报位置。
 *
 * 两样都没有时返回空串，调用方据此不渲染这一行，不留一根空线。
 */
export function nowDetail(now: StageNow | undefined): string {
  if (!now) return '';
  if (now.kind === 'external') {
    // 专辑常常跟歌名、歌手重复（单曲、翻唱合辑里很常见），去掉就没信息量了。
    const album = (now.album ?? '').trim();
    if (!album) return '';
    const dupe = album === now.title.trim() || album === now.artist.trim();
    return dupe ? '' : album;
  }
  const parts: string[] = [];
  if ((now.span ?? 0) > 0) parts.push(`${clock(now.at ?? 0)} / ${clock(now.span ?? 0)}`);
  if (now.order) parts.push(now.order);
  return parts.join(' · ');
}
