// 媒体库：页面侧的数据模型与主进程约定。
//
// 和 now-playing-bridge 同一套思路——页面 sandbox: true、没有 preload，
// 所以页面把请求压进 outbox，主进程轮询取走，处理完再调 window.__ravenMedia 推回来。
// 页面永远是被动的一方。
import type { MediaItem, MediaKind } from './records.ts';

type RavenWindow = Window & {
  __ravenMedia?: (raw: unknown) => void;
  __ravenMediaOutbox?: unknown[];
};

/**
 * 拿页面上的桥接对象。
 *
 * 写成函数而不是模块级的 `const raven = window as ...`：上面那些纯函数
 * （toMediaItem / mergeMedia / mediaSrc）要在 Node 的测试里跑，那里没有 window，
 * 模块一加载就炸。只有真正要跟主进程说话的函数才碰它。
 */
function raven(): RavenWindow {
  return window as RavenWindow;
}

/**
 * preload 暴露进来的通道（见 electron/preload.cjs）。
 *
 * 有它就走 IPC：调用即送达，不用等主进程那一轮 400ms 的轮询。
 * 没有它（探针自己建的窗口不会装 preload）就退回 window 全局量那一套，
 * 所以下面每个函数都保留了两条路，而不是换掉旧路。
 */
type RavenChannel = {
  send: (channel: string, payload: unknown) => boolean;
  on: (channel: string, handler: (payload: unknown) => void) => () => void;
};

function channel(): RavenChannel | undefined {
  return (window as Window & { raven?: RavenChannel }).raven;
}

/** 主进程扫出来的一个文件，比 MediaItem 多了绝对路径和可以直接用的 src。 */
export type ScannedFile = {
  path: string;
  name: string;
  kind: MediaKind;
  size: number;
  /** 修改时间（毫秒）。扫描时和 size 同一次 statSync 拿的，票面日期用它。 */
  mtime?: number;
  src: string;
};

export type MediaMessage =
  | { type: 'ready'; dirs: string[] }
  | { type: 'scan'; dir: string; files: Omit<ScannedFile, 'src'>[]; url: ScannedFile[] }
  | { type: 'files'; files: Omit<ScannedFile, 'src'>[]; url: ScannedFile[] }
  | { type: 'wallpapers'; roots: { dir: string; count: number }[]; items: WallpaperFile[] }
  /**
   * 主进程拒了一个动作。
   *
   * 有这一条是因为「点了什么也没发生」是最难查的一类坏掉：用户会以为是软件卡了，
   * 然后反复重试。主进程不静默吞掉，页面负责说清为什么。
   *
   * - `system`：选的是盘根或系统目录，不收。
   * - `empty`：挑完之后一个可用的都没剩下（常见于选中之后文件被别的程序删掉）。
   * - `missing`：要重扫的目录已经不在台账里了，通常是目录被改名/移动/删除。
   */
  | { type: 'rejected'; path: string; reason: 'system' | 'empty' | 'missing' }

/** 壁纸库里的一件。key 是作品目录，比标题和文件名都稳。 */
export type WallpaperFile = ScannedFile & { key: string; note: string };

/** 注册接收器。返回取消函数，组件卸载时调。 */
export function listenMedia(onMessage: (message: MediaMessage) => void): () => void {
  const bridge = raven();
  const receiver = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as MediaMessage;
    if (message.type !== 'ready' && message.type !== 'scan' && message.type !== 'files' && message.type !== 'wallpapers' && message.type !== 'rejected') return;
    onMessage(message);
  };
  // 收的方向与发的一致：有 preload 就只听 IPC，没有才挂全局量。
  // 两边都用「有没有 raven 通道」这一个判据，所以不会出现「发走 IPC、收回轮询」
  // 这种错配——主进程那边也是靠第一次收到 IPC 请求才切过去的。
  const ipc = channel();
  if (ipc) {
    return ipc.on('media:message', receiver);
  }
  bridge.__ravenMedia = receiver;
  return () => {
    if (bridge.__ravenMedia === receiver) delete bridge.__ravenMedia;
  };
}

function push(action: unknown) {
  // 有 preload 就直接发：这条路上班即送达，主进程收到就处理，
  // 不必等轮询，也不必再敲一次门把那一轮提前。
  const ipc = channel();
  if (ipc) {
    ipc.send('media:request', action);
    return;
  }
  const bridge = raven();
  bridge.__ravenMediaOutbox = [...(bridge.__ravenMediaOutbox ?? []), action];
  knock();
}

/**
 * 推完动作后敲一下主进程的门，让它立刻来取，不等 400ms 那一轮。
 *
 * 借 media:// 协议递信号，不引 preload、不动沙箱设置。全屏这类动作对时机敏感：
 * 晚一百毫秒，用户就会看到「画面先在窗口里铺满、过一会儿窗口才变大」。
 *
 * 敲门失败无所谓——下一轮轮询照样会把动作取走，只是慢一点。
 * 用 keepalive 是怕页面正在卸载时请求被丢掉；这里其实不会，但代价为零。
 */
function knock() {
  try {
    void fetch(`media://local/__knock`, { method: 'HEAD', cache: 'no-store' }).catch(() => undefined);
  } catch {
    /* 敲门只是加速，失败就走轮询 */
  }
}

/** 问主进程要一份「当前放行了哪些目录」。页面刚挂载时调一次。 */
export function askMedia() {
  push({ type: 'ping' });
}

/** 弹出文件夹选择框，选完主进程会推回一条 scan。 */
export function pickMediaFolder() {
  push({ type: 'pick' });
}

/**
 * 挑单个文件，可以多选。
 *
 * 和 pickMediaFolder 分开：那个会把整棵树扫进来（挑一个素材盘就是几千个文件），
 * 这个只收点中的那几件，来源列表里也不会多出一个目录。
 */
export function pickMediaFiles() {
  push({ type: 'pick-files' });
}

/** 重新扫一遍某个已经放行的目录。 */
export function rescanMediaFolder(dir: string) {
  push({ type: 'rescan', dir });
}

/**
 * 把某个目录移出媒体库，并**撤销主进程的读取授权**。
 *
 * 两件事必须一起做：页面这边删掉收藏条目只是界面不再显示，那个目录仍然在
 * 主进程的台账里，`media://` 照样读得到。只做前者，用户以为东西删了，
 * 其实权限还在——「移出」就只是视觉上的。
 */
export function forgetMediaDir(dir: string) {
  push({ type: 'forget', dir });
}

/** 让窗口进/出真全屏。页面铺满只能盖住内容区，任务栏和窗口边框要主进程来收。 */
export function setWindowFullscreen(on: boolean) {
  push({ type: 'fullscreen', on });
}

/**
 * 把放映台摆到桌面上，或者收回来。
 *
 * 这件事只能由主进程做——页面开不了窗口。窗口本身住在 electron/desktop-stage.cjs，
 * 这里只是把请求压进 outbox。
 */
export function setDesktopStage(on: boolean) {
  push({ type: 'desktop', on });
}

/**
 * 读 Wallpaper Engine 的创意工坊库。
 *
 * 不弹对话框：它的位置是固定的，主进程自己去几个常见路径找。
 * 一件都没找到就回空列表，页面据此提示「没装」。
 */
export function scanWallpapers() {
  push({ type: 'wallpapers' });
}

/**
 * 启动时把上次记下的目录重新登记进主进程的白名单。
 *
 * 主进程的白名单只活在内存里，关掉软件就没了；但收藏里的路径还在。
 * 不补这一步，重启后卡片显示得出来、点开却是 403 —— 用户看到的是「一堆打不开的缩略图」。
 */
export function restoreMediaDirs(dirs: string[], files: string[] = []) {
  // 目录可以是空的：主进程那边还要补登记壁纸库的根目录，
  // 而壁纸条目从来不进 mediaDirs。所以不能因为 dirs 为空就跳过这次调用。
  push({ type: 'restore', dirs, files });
}

/**
 * 把扫出来的文件变成媒体库条目。
 * 用绝对路径做稳定 id：同一个文件反复扫描不会变成两条，
 * 用户把文件夹挪走再挪回来也能认出来（只是路径变了，那是另一条）。
 */
export function toMediaItem(file: ScannedFile): MediaItem {
  return {
    id: file.path,
    kind: file.kind,
    path: file.path,
    name: file.name,
    size: file.size,
    mtime: file.mtime,
  };
}

/**
 * 壁纸库里的一件 → 媒体库条目。
 *
 * id 用作品目录而不是文件路径：视频文件名和标题都可能被作者改，
 * 目录 id 是创意工坊的编号，作者改了也还在。
 */
export function toWallpaperItem(file: WallpaperFile): MediaItem {
  return {
    id: file.key,
    kind: file.kind,
    path: file.path,
    name: file.name,
    size: file.size,
    mtime: file.mtime,
    source: file.key,
    note: file.note || undefined,
  };
}

/**
 * 壁纸库结果整体替换进媒体库。
 *
 * 壁纸是「一次全量读」而不是「一个目录一个目录扫」，所以和 replaceMediaDir 一样
 * 走替换而不是合并：用户在 Wallpaper Engine 里取消订阅了，这里也该跟着消失。
 * 只动 source 非空的条目，用户自己加的文件夹不受影响。
 */
export function replaceWallpapers(current: MediaItem[], incoming: MediaItem[]): MediaItem[] {
  return [...current.filter(item => !item.source), ...incoming];
}

/**
 * 从库里拿掉壁纸库读进来的那批。
 *
 * 用户点了「移出壁纸库」时用。只删 source 非空的，自己加的文件夹和单独导入的
 * 文件一件都不动——那条路径和壁纸库没有关系。
 */
export function dropWallpapers(current: MediaItem[]): MediaItem[] {
  return current.filter(item => !item.source);
}

/** 一个条目该用什么地址显示。路径原样进编码，中文和空格由主进程那侧负责还原。 */
export function mediaSrc(item: MediaItem): string {
  return `media://local/${encodeURIComponent(item.path)}`;
}

/** 按 id 去重合并：新扫到的覆盖旧的（文件可能被改过大小），旧条目保持顺序。 */
export function mergeMedia(current: MediaItem[], incoming: MediaItem[]): MediaItem[] {
  const seen = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) seen.set(item.id, item);
  return [...seen.values()];
}

/**
 * 用一次扫描的结果替换某个目录下的条目。
 *
 * 不能用 mergeMedia：那个只增不减，用户在资源管理器里删掉的文件会一直留在库里，
 * 点开就是 404。重扫的语义是「这个目录现在长这样」，所以先清空再填。
 */
export function replaceMediaDir(current: MediaItem[], dir: string, incoming: MediaItem[]): MediaItem[] {
  const rest = current.filter(item => !isInside(item.path, dir));
  const seen = new Set(rest.map(item => item.id));
  return [...rest, ...incoming.filter(item => !seen.has(item.id))];
}

/** 路径在不在这个目录里。前后缀相似的目录（素材 / 素材二）不能误判。 */
export function isInside(file: string, dir: string): boolean {
  const root = dir.replace(/[\\/]+$/, '').toLowerCase();
  const lower = file.toLowerCase();
  return lower.startsWith(root + '\\') || lower.startsWith(root + '/');
}

/**
 * 哪些条目是单独导入的文件（不在任何目录里）。
 *
 * 重启后主进程的白名单要补回来，目录走 dirs、单文件走 files，
 * 混在一起传会让主进程对着文件调 statSync().isDirectory()，白跑一遍。
 */
export function looseMedia(items: MediaItem[], dirs: string[]): string[] {
  return items.filter(item => !dirs.some(dir => isInside(item.path, dir))).map(item => item.path);
}
