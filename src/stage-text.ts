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
 */
export type StageNow =
  | { kind: 'local'; title: string; artist: string; playing: boolean }
  | { kind: 'external'; title: string; artist: string; app: string; playing: boolean }
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
