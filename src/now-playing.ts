/**
 * 外部音乐正在播什么。
 *
 * Windows 的系统媒体会话（SMTC）是唯一能知道「别的播放器在放什么」的接口，
 * 浏览器里没有对应 API，所以由 electron/nowplaying/NowPlaying.exe 这个只读小程序
 * 常驻监听，把变化通过 IPC 推过来。这里只放类型和纯函数，不碰 IPC，
 * 这样测试可以直接跑，也方便以后换别的平台实现。
 */

/** 一次快照。cover 是 data URL，拿不到封面时是空串。 */
export type NowPlaying = {
  /** 播放器的可执行文件名，比如 cloudmusic.exe。 */
  app: string;
  title: string;
  artist: string;
  album: string;
  /** Playing / Paused / Stopped / None。 */
  status: string;
  playing: boolean;
  cover: string;
};

export const emptyNowPlaying: NowPlaying = {
  app: '', title: '', artist: '', album: '', status: 'None', playing: false, cover: '',
};

/** 播放器的显示名。认不出来的直接用可执行文件名，不编造。 */
const appNames: Record<string, string> = {
  cloudmusic: '网易云音乐',
  qqmusic: 'QQ 音乐',
  kugou: '酷狗音乐',
  kuwo: '酷我音乐',
  spotify: 'Spotify',
  applemusic: 'Apple Music',
  foobar: 'foobar2000',
  musicbee: 'MusicBee',
  aimp: 'AIMP',
  potplayer: 'PotPlayer',
  chrome: 'Chrome',
  msedge: 'Edge',
  firefox: 'Firefox',
  telegram: 'Telegram',
};

/**
 * macOS 的媒体会话给的是 bundle id，Windows 给的是可执行名。
 * `appNames` 只认可执行名（那是 Windows 侧真正的一等公民），所以在查表之前
 * 先把 bundle id 归一到可执行名——桥单独放在这里，不往 `appNames` 里塞
 * 长得像 exe 名的 key。
 *
 * 为什么要分开：将来遇到新的 Mac 播放器，只加一行桥；加的这一行天然带语义
 * （左边是 Apple 认的 id，右边是我们认的播放器），不会和「显示名」混在一起。
 * 左边的 key 一律小写（查表前已 toLowerCase），右边必须是 `appNames` 里的 key。
 */
const bundleIds: Record<string, string> = {
  'com.apple.music': 'applemusic',
  'com.netease.163music': 'cloudmusic',
  'com.tencent.qqmusicmac': 'qqmusic',
};

export function appLabel(app: string): string {
  if (!app) return '';
  const raw = app.replace(/\.exe$/i, '');
  // 先过桥，再查表：两边的 key 都已是小写，比较时不用再转。
  const key = bundleIds[raw.toLowerCase()] ?? raw.toLowerCase();
  if (appNames[key]) return appNames[key];
  const hit = Object.keys(appNames).find(name => key.includes(name));
  return hit ? appNames[hit] : raw;
}

/** 有没有歌在放。只有拿到标题才算数，空白字符串不算。 */
export function hasTrack(info: NowPlaying): boolean {
  return !!info.title.trim();
}

/**
 * 界面上的副标题：歌手 + 播放器名。
 * 宁可少显示，也不要显示成「  · 网易云音乐」这种前面空一截的样子。
 */
export function trackSubtitle(info: NowPlaying): string {
  const artist = info.artist.trim();
  const source = appLabel(info.app);
  if (artist && source) return `${artist} · ${source}`;
  return artist || source;
}

/** 暂停时界面要能看出来，给一句短提示。 */
export function playbackHint(info: NowPlaying): string {
  if (!hasTrack(info)) return '';
  if (info.playing) return '';
  if (info.status === 'Paused') return '已暂停';
  if (info.status === 'Stopped') return '已停止';
  return '';
}

/**
 * 把小程序的原始 JSON 收成 NowPlaying。
 * 字段缺了就给空串，绝不抛错——外部播放器写的标题里什么字符都可能有，
 * 让它把整个界面搞崩不值得。
 */
export function parseNowPlaying(raw: unknown): NowPlaying {
  if (!raw || typeof raw !== 'object') return emptyNowPlaying;
  const data = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const status = text(data.status) || 'None';
  const cover = text(data.cover);
  return {
    app: text(data.app),
    title: text(data.title),
    artist: text(data.artist),
    album: text(data.album),
    status,
    // 小程序已经算好了 playing，但状态字段更可信，防止两边不一致
    playing: status === 'Playing',
    // 只接受 data URL，避免把奇怪的东西塞进 img src
    cover: cover.startsWith('data:image/') ? cover : '',
  };
}

/** 能让外部播放器执行的动作。都不是回执型：发出去就不管成功没成功。 */
export type MediaAction = 'toggle' | 'next' | 'previous';
