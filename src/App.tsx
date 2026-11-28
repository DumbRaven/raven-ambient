import { type ChangeEvent, type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bird, ChevronLeft, ChevronRight, Disc3, Info, Plus, Search, Settings2, Sparkles, X } from 'lucide-react';
import FocusRoom from './FocusRoom';
import { cabinetRecords, clampPage, emptyCabinet, fingerprint, isAudioFile, nextOrder, orderNames, pageCount, paginate, removeRecord, toggleRecord, type Cabinet, type CabinetFilter, type RecordItem, type RecordType } from './records';
import { ambientCoverUrl, matchAmbientCover, type AmbientCover } from './ambient-covers';
import { CabinetStorage, CabinetWriteError, restoreSalvage, adoptEmptyCabinet } from './cabinet-storage';
import { RoomPlayer, type RoomStatus } from './player';
import { inspectAudio } from './importer';
import { prepareImage, readAsset, storeAsset } from './storage';
import { listAssetKeys } from './store';
import { formatTime } from './model';
import { launchSeed, pickSleeve } from './sleeves';
import Sleeve from './Sleeve';
import RecordCard from './RecordCard';
import RecordNotes from './RecordNotes';
import ViewTabs from './ViewTabs';
import { type TurntableDisc } from './RecordPlayer';
import PlayCard from './PlayCard';
import { dismissSplash } from './splash';
import RollNumber from './roll-number';
import { LineIn, isRetriable, lineInError } from './line-in';
import { systemAudioHint } from './system-audio';
import { appLabel, emptyNowPlaying, hasTrack, parseNowPlaying, type NowPlaying } from './now-playing';
import { askNowPlaying, commandNowPlaying, listenNowPlaying } from './now-playing-bridge';
import { askMedia, dropWallpapers, forgetMediaDir as forgetMediaDirGrant, forgetMediaFile as forgetMediaFileGrant, isInside, listenMedia, looseMedia, mergeMedia, pickMediaFiles, pickMediaFolder, replaceMediaDir, replaceWallpapers, rescanMediaFolder, restoreMediaDirs, scanWallpapers, toMediaItem, toWallpaperItem, type MediaMessage } from './media';
import MediaRoom from './MediaRoom';
import ListeningRoom from './ListeningRoom';
import type { StageNow } from './TemplateStage';
import { useDialogMotion, useFilterMotion, usePageMotion } from './use-motion';
import { useViewLayout } from './use-view-layout';
import MotionNotice from './MotionNotice';
import GuideModal from './GuideModal';
import SettingsModal from './SettingsModal';
import ImportModal from './ImportModal';
import EditModal from './EditModal';

const emptyStatus: RoomStatus = { running: false, playing: false, musicPlaying: false, ducked: false, level: 0, currentTime: 0, duration: 0, musicOn: true, ambientOn: true, lineInput: 0, lineLive: false, ambientIds: [] };
type Modal = 'import' | 'settings' | 'edit' | 'guide' | null;
/** 把任何抛出来的东西转成一句能给用户看的话。非 Error 的抛出（字符串、对象）也要有兜底。 */
function message(error: unknown) { return error instanceof Error ? error.message : '没有完成，请重试。'; }
// 大标题与右上角那个计数都跟着当前空间走。放在一张表里，
// 加第二个空间时不会漏掉其中一处（以前标题和计数是两段独立的三元表达式，
// 「专注」的计数一度写成了 Math.round(running ? 1 : 0)）。
const viewTitles: Record<'cabinet' | 'listening' | 'focus' | 'media', string> = { cabinet: 'Cabinet', listening: 'Listening', focus: 'Focus', media: 'Gallery' };
/**
 * 应用根。这里放的是「跨页」的状态：唱片柜、当前页签、播放器实例、开关的面板。
 * 单页内部的状态留在各自的组件里——根组件超过一千行时，多一个 state 都是负担。
 */
export default function App() {
  const [cabinet, setCabinet] = useState<Cabinet>(structuredClone(emptyCabinet));
  const cabinetRef = useRef(cabinet); cabinetRef.current = cabinet;
  const cabinetStorage = useRef(new CabinetStorage());
  const [ready, setReady] = useState(false);
  // 收藏整份读不出来时为 true：界面照常开，但保存是锁着的，
  // 得先让用户决定「恢复原文件」还是「就从空柜开始」，见下面的恢复条。
  const [salvage, setSalvage] = useState(false);
  /** 读坏的具体原因。告不告诉人和「备份成没成功」是两件事，所以另存一个字段。 */
  const [salvageReason, setSalvageReason] = useState('');
  /**
   * 已经试过一次「恢复原文件」、而且那份原文照样读不出来。
   *
   * 恢复做的事情就是把备份原文写回主键，同样的原文再写一遍必然还是读不出来。
   * 为 true 时横幅里不再给「恢复原文件」那颗按钮——留着它，用户会一遍遍点。
   */
  const [salvageRetried, setSalvageRetried] = useState(false);
  const [status, setStatus] = useState<RoomStatus>(emptyStatus);
  const player = useRef<RoomPlayer | null>(null);
  const [view, setView] = useState<'cabinet' | 'listening' | 'focus' | 'media'>('cabinet');
  const [filter, setFilter] = useState<CabinetFilter>('selected');
  // 媒体库：主进程扫出来的文件直接进 cabinet.media，这里只留「这次启动扫到过哪些目录」。
  // 不放进 cabinet 是因为它是运行时状态，不该触发一次存储写入。
  const [mediaDirs, setMediaDirs] = useState<string[]>([]);
  // 主进程确认白名单已经登记好。在这之前不能渲染媒体元素，否则一次 403 就永久空着。
  const [mediaReady, setMediaReady] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [focusId, setFocusId] = useState<string>();
  // 唱片盒当前被点开的是哪一张。open=false 表示刚合上、正在压住鼠标悬停。
  const [flip, setFlip] = useState<{ id: string; open: boolean }>();
  // 刚加进队列的那一张，用来让加号弹一下。token 让同一张连续加两次也能重播动画。
  const [justAdded, setJustAdded] = useState<{ id: string; token: number }>();
  const justAddedTimer = useRef<number | undefined>(undefined);
  const [modal, setModal] = useState<Modal>(null);
  const [importType, setImportType] = useState<RecordType>('music');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  // 上一张唱片：切歌时留在唱盘上做退场，等动画走完再摘掉
  const [outgoing, setOutgoing] = useState<RecordItem | null>(null);
  const outgoingTimer = useRef(0);
  const [report, setReport] = useState<string[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [background, setBackground] = useState('');
  const urls = useRef(new Map<string, string>());
  const [draft, setDraft] = useState({ name: '', artist: '', description: '' });
  const [draftError, setDraftError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [sleepUntil, setSleepUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  // 外部音乐输入：开关一开就抓音频来源，不需要用户选
  const [lineError, setLineError] = useState('');
  // 「这台机器没有虚拟声卡」是常态而不是故障：它不占用 lineError（那个位置带「再试一次」），
  // 由设置面板的电表行单独说明。和 lineError 分开存，是为了两句话不会同时出现。
  // 只对 Windows 有意义——mac 上不存在「装没装声卡」这件事。
  const [noCable, setNoCable] = useState(false);
  // mac 那条路上「没接上」的原因，已经翻成给用户看的一句话。
  //
  // 为什么不用 noCable 那个布尔：mac 的失败有四种（不支持/没权限/缺程序/说不清），
  // 每一种要用户做的事都不一样，压成一个布尔就只能说一句笼统的话，等于没说。
  // 也不全塞进 lineError：那个位置带「再试一次」按钮，而「这台系统不支持」
  // 点一百次也不会变，给一个假出路比不给更糟（规则见 src/line-in.ts）。
  const [lineHint, setLineHint] = useState('');
  const line = useRef(new LineIn());
  // 正在试听哪一张。试听是「听一下就走」，8 秒后自己停，所以不放进 status 里。
  const [previewId, setPreviewId] = useState<string>();
  const previewTimer = useRef<number | undefined>(undefined);
  // 删除按钮的第一下：变成红色并等第二下。2 秒没跟上就自己撤销。
  const [confirmRemove, setConfirmRemove] = useState<string>();
  const confirmTimer = useRef<number | undefined>(undefined);
  // 外部播放器正在放什么。只有开了外部音乐模式才去问系统，
  // 因为读它要起一个辅助进程，平时没必要。
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>(emptyNowPlaying);
  // 播放卡：点页签栏右边那颗圆碟，从屏幕底部升上来。
  // 位置交给 CSS（水平居中贴底），这里只管开关。
  const [cardOpen, setCardOpen] = useState(false);
  // 定时到点要收全屏。全屏是 MediaRoom 的内部状态，这里只递请求号。
  const [exitFullscreen, setExitFullscreen] = useState(0);
  // 波形要每帧都新鲜的电平，走 status 会被 200ms 的节流卡住，所以单独用定时器推一个计数。
  const [levelTick, setLevelTick] = useState(0);
  const filesInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null), imageInput = useRef<HTMLInputElement>(null), coverInput = useRef<HTMLInputElement>(null);
  // 订阅系统媒体会话：模式开着才问，关掉就停掉辅助进程
  useEffect(() => {
    if (!cabinet.lineMode) { setNowPlaying(emptyNowPlaying); return; }
    const stop = listenNowPlaying(raw => setNowPlaying(parseNowPlaying(raw)));
    askNowPlaying('start');
    // 主进程可能早就启动了辅助程序、手上已经有歌了。挂上监听后立刻问一次，
    // 不然要等下一拍推送，刚切到「正在听」时卡片会先空着闪一下。
    askNowPlaying('ping');
    return () => { stop(); askNowPlaying('stop'); };
  }, [cabinet.lineMode]);
  // 媒体库：主进程扫完推过来，合并进 cabinet.media。
  // 扫到的目录记在 mediaDirs 里（运行时状态），媒体条目本身进 cabinet 才能跨启动留住。
  useEffect(() => {
    const stop = listenMedia((message: MediaMessage) => {
      // 收到 ready 说明主进程已经把白名单登记好了（用户目录 + 壁纸库根目录）。
      // 在这之前渲染 <img>/<video> 会拿到 403，而且是永久失败——浏览器不会因为
      // 后来白名单变了就重试同一个地址，格子会一直空着。所以等这一拍。
      if (message.type === 'ready') { setMediaDirs(message.dirs); setMediaReady(true); return; }
      if (message.type === 'rejected') {
        // 盘根、系统目录这类位置主进程不收。必须说出来：用户选了、点了确定、
        // 然后界面毫无反应，他会以为软件卡住了，再试几次还是一样。
        notify(message.reason === 'system'
          ? '这个位置不能收：请选你的素材文件夹，别选磁盘根目录或系统目录。'
          : message.reason === 'empty'
            ? '挑中的文件都读不到了，可能刚被移走或删除。再选一次试试。'
            : '这个文件夹找不到了，可能被改名或移动过。重新添加一次就好。');
        return;
      }
      if (message.type === 'wallpapers') {
        // 壁纸库是「一次全量读」，所以整体替换：在 Wallpaper Engine 里取消订阅的作品
        // 这里也该跟着消失。只动 source 非空的条目，用户自己加的文件夹不受影响。
        const incoming = message.items.map(toWallpaperItem);
        const next = replaceWallpapers(cabinetRef.current.media, incoming);
        if (next.length === cabinetRef.current.media.length && next.every((item, index) => item.id === cabinetRef.current.media[index]?.id)) return;
        change({ media: next });
        return;
      }
      if (message.type === 'files') {
        // 单独挑的文件只往库里加，不进 mediaDirs——它不属于任何目录。
        // 按 id 去重合并：同一张图挑两次不该变成两格。
        const incoming = message.url.map(toMediaItem);
        const next = mergeMedia(cabinetRef.current.media, incoming);
        if (next.length === cabinetRef.current.media.length && next.every((item, index) => item.id === cabinetRef.current.media[index]?.id)) return;
        change({ media: next });
        return;
      }
      setMediaDirs(dirs => (dirs.includes(message.dir) ? dirs : [...dirs, message.dir]));
      const incoming = message.url.map(toMediaItem);
      // 用扫描结果替换这个目录下的条目，不是合并：用户删掉的文件必须跟着消失，
      // 否则库里会留着点开就 404 的缩略图。目录外的条目原样保留。
      const next = replaceMediaDir(cabinetRef.current.media, message.dir, incoming);
      // 内容没变就别写盘：启动时每次都会重扫一遍，白写一次存储没必要。
      if (next.length === cabinetRef.current.media.length && next.every((item, index) => item.id === cabinetRef.current.media[index]?.id)) return;
      const dirs = cabinetRef.current.mediaDirs.includes(message.dir) ? cabinetRef.current.mediaDirs : [...cabinetRef.current.mediaDirs, message.dir];
      change({ media: next, mediaDirs: dirs });
    });
    askMedia();
    return stop;
  }, []);
  // 主进程的白名单只在内存里，重启就没了。把上次记下的目录补回去，
  // 否则卡片还在、点开是 403。等 cabinet 读出来再补，别抢在存储加载之前。
  //
  // 这里不能写成「mediaDirs 非空才补」：壁纸库的条目路径在 Steam 目录下，
  // 从来不进 mediaDirs，于是重启后一次 restore 都不会发生，一百多张壁纸全是 403。
  // 无条件调，主进程那边没有目录也只是一次空转。
  useEffect(() => {
    if (!ready) return;
    const dirs = cabinetRef.current.mediaDirs;
    // 单独导入的文件不在任何目录里，要单独补：否则重启后那几张图全是 403。
    restoreMediaDirs(dirs, looseMedia(cabinetRef.current.media, dirs));
  }, [ready]);
  // 波形电平：60ms 读一次引擎。不走 status 的 200ms 节流，否则波形一卡一卡的。
  useEffect(() => {
    if (!cardOpen) return;
    const timer = window.setInterval(() => setLevelTick(player.current?.level ?? 0), 60);
    return () => window.clearInterval(timer);
  }, [cardOpen]);
  const pageMotion = usePageMotion(view);
  const viewLayout = useViewLayout(pageMotion, view);
  // 圆形扩散的圆心与半径：点哪个页签就从哪个页签的位置铺开，
  const [wipe, setWipe] = useState({ x: 0, y: 0, r: 0 });
  // 圆心取触发元素的中心，而不是点击点：键盘切换、或者点在按钮边角时，
  // 铺开的起点也应该是一致的。半径取到内容区最远的那个角，保证结束时一定盖满。
  function circleFrom(trigger: HTMLElement, stage: HTMLElement) {
    const box = stage.getBoundingClientRect();
    const spot = trigger.getBoundingClientRect();
    // 触发元素可能在内容区上方（页签就在），圆心算出来 y 会是负的。
    // 收进内容区边界：扩散从内容区顶边对应的位置开始，不会先空转一小段。
    const x = Math.min(Math.max(spot.left + spot.width / 2 - box.left, 0), box.width);
    const y = Math.min(Math.max(spot.top + spot.height / 2 - box.top, 0), box.height);
    const r = Math.max(
      Math.hypot(x, y),
      Math.hypot(box.width - x, y),
      Math.hypot(x, box.height - y),
      Math.hypot(box.width - x, box.height - y),
    );
    return { x, y, r };
  }
    /**
    * 切页签。扩散动画的圆心取**触发元素**的位置，这样视觉上是从点的地方散开。
    * 同一页时不重来：连点当前页签不该再放一遍动画。
    */
  function selectView(next: 'cabinet' | 'listening' | 'focus' | 'media', trigger?: HTMLElement) {
    if (next === view) return;
    const stage = viewLayout.stageRef.current;
    if (stage && trigger) setWipe(circleFrom(trigger, stage));
    setView(next);
  }
  // 筛选切换只换唱片柜那一块，所以圆心就地取筛选按钮，作用域是 cabinet-layout。
  const shelfRef = useRef<HTMLDivElement>(null);
  const filterTabsRef = useRef<HTMLDivElement>(null);
  const [shelfWipe, setShelfWipe] = useState({ x: 0, y: 0, r: 0 });
  const filterMotion = useFilterMotion(filter);
  // 筛选按钮的黑色滑块：跟页签栏同一套做法，按钮宽度变了也跟得上。
  useLayoutEffect(() => {
    const tabs = filterTabsRef.current;
    if (!tabs) return;
    const sync = () => {
      const active = tabs.querySelector<HTMLElement>('button.active');
      if (!active) return;
      // 用 offset* 而不是 getBoundingClientRect：切回唱片柜时整块正处在扩散动画里，
      // 外层的 .view-stage 带着 transform: scale()，量出来会小一圈。
      tabs.style.setProperty('--flip-x', `${active.offsetLeft}px`);
      tabs.style.setProperty('--flip-width', `${active.offsetWidth}px`);
    };
    sync();
    const ready = requestAnimationFrame(() => { tabs.dataset.ready = 'true'; });
    const observer = new ResizeObserver(sync);
    observer.observe(tabs);
    tabs.querySelectorAll('button').forEach(button => observer.observe(button));
    return () => { cancelAnimationFrame(ready); observer.disconnect(); };
  }, [filter, cabinet.lineMode, pageMotion.value]);
    /** 切筛选。作用域是唱片柜那一块，所以圆心就地取筛选按钮，不用外层 stage。 */
  function selectFilter(next: CabinetFilter, trigger?: HTMLElement) {
    if (next === filter) return;
    const shelf = shelfRef.current;
    if (shelf && trigger) setShelfWipe(circleFrom(trigger, shelf));
    setFilter(next);
  }
  const dialogMotion = useDialogMotion(modal);
  const modalRef = dialogMotion.ref;
  const shownModal = dialogMotion.value;
  const notify = (text: string) => setNotice(text);
  // 右上角那一行小字：像杂志封面上的期号，跟着当天日期走。
  // 不用 Intl 的 day:'2-digit'（有的环境不给前导零），自己补。
  const todayStamp = (() => {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const month = now.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `${weekday} · ${month} ${String(now.getDate()).padStart(2, '0')}`;
  })();
  /**
   * 当前真正生效的筛选。
   *
   * 外部音乐模式下唱片柜里只剩环境音（`cabinetRecords` 会把音乐整类过滤掉），
   * 页签栏也不再有「音乐」这一格。`filter` 这个 state 还可能是 `'music'`：
   * 关掉外部模式的瞬间、或者用户上次就停在那儿。直接用原始 state 会得到
   * 「三个页签都不高亮、柜子空着、空态按钮还推你去导音乐」。
   *
   * 做成派生值而不是再写一处 `setFilter`：改 state 有先后顺序问题
   * （这一帧渲染用的还是旧值），派生值当帧就对。
   */
  const activeFilter: CabinetFilter = cabinet.lineMode && filter === 'music' ? 'ambient' : filter;
  const visible = cabinetRecords(cabinet, activeFilter, query);
  const pages = pageCount(visible.length);
  const currentPage = clampPage(page, visible.length);
  const shown = paginate(visible, currentPage);
  // 右侧永远有内容可看：点过哪张显示哪张，没点过就显示当前页第一张。
  const focused = (focusId && shown.find(r => r.id === focusId)) || shown[0];
  const current = cabinet.records.find(r => r.id === status.currentId);

  /**
   * 换碟分两拍：上一张先退场，走完才轮到下一张落下，两张不同时出现在唱盘上。
   * outgoing 有值时只渲染上一张，1 秒后清空，新的一张才挂载并播入场动画。
   */
  const lastShown = useRef<RecordItem | undefined>(undefined);
  useEffect(() => {
    // 依赖记录 id 而不是对象：cabinet 每次更新都会重建 records 数组
    const previous = lastShown.current;
    lastShown.current = current;
    if (!current || !previous || previous.id === current.id) return;
    window.clearTimeout(outgoingTimer.current);
    setOutgoing(previous);
    outgoingTimer.current = window.setTimeout(() => setOutgoing(null), 1020);
  }, [current?.id]);
  useEffect(() => () => window.clearTimeout(outgoingTimer.current), []);
  // 退场期间唱盘和标题都停在上一张，走完才换成新的一张
  // 外部音乐模式下唱盘上本来就不是本地唱片，切歌不该再放一遍换碟动画
  const shownOutgoing = cabinet.lineMode ? undefined : outgoing;
  // 标题必须跟着唱盘走：只让唱盘乘 lineMode 的话，外部音乐模式下没歌在放时，
  // 标题会显示 1 秒退场中的上一张，而唱盘已经空着了——两边对不上。
  const titleRecord = shownOutgoing ?? current;
  // 外部音乐模式下唱盘上转的是别的播放器正在放的那首：没有真唱片，就用封面和歌名拼一张
  const externalDisc: TurntableDisc | undefined = cabinet.lineMode && hasTrack(nowPlaying) ? { kind: 'external', info: nowPlaying } : undefined;
  // 外部音乐模式下唱片柜不显示音乐那一栏，所以「已选择」也只能算环境音。
  // 照旧把 queue 加进去的话，模式一开就会显示「已选择 7」而柜子里只有 2 张。
  const selectedCount = (cabinet.lineMode ? 0 : cabinet.queue.length) + cabinet.ambience.length;
  const coverFor = (record: RecordItem) => ambientCoverUrl(record.coverPreset) ?? (record.coverId ? covers[record.id] : undefined);

  // 圆碟和播放卡共用的「现在在放什么」。外部音乐优先，其次本地音乐，最后退回环境音。
  const playingNow = cabinet.lineMode ? nowPlaying.playing : status.running;
  const discRecord = cabinet.lineMode ? undefined : (current ?? focused ?? cabinet.records[0]);
  const discTitle = cabinet.lineMode
    ? (hasTrack(nowPlaying) ? nowPlaying.title : '等外部音乐')
    : (discRecord?.name ?? (cabinet.ambience.length ? cabinet.ambience.length + ' 路环境音' : '还没开始'));
  const discSubtitle = cabinet.lineMode
    ? (hasTrack(nowPlaying) ? appLabel(nowPlaying.app) + (nowPlaying.playing ? '' : ' · 已暂停') : '打开别的播放器')
    : (discRecord ? (discRecord.artist || discRecord.format) : '从唱片柜挑一张');
  const discCover = cabinet.lineMode
    ? (nowPlaying.cover || undefined)
    : (discRecord ? coverFor(discRecord) : undefined);
  // 桌面小窗计时圈里转的那张碟。身份用「模式 + 唱片 id / 歌名」，
  // 换了歌才换碟，暂停、改音量、翻页都不会让它重算一遍颜色。
  const miniDiscSource = cabinet.lineMode
    ? (hasTrack(nowPlaying)
      ? { key: 'ext:' + nowPlaying.app + '|' + nowPlaying.title, cover: nowPlaying.cover || undefined, color: '#9a8b78', spinning: nowPlaying.playing }
      : null)
    : (discRecord && status.running && status.musicPlaying
      ? { key: 'local:' + discRecord.id, cover: coverFor(discRecord), color: discRecord.color, spinning: true }
      : null);
  const canSkipDisc = cabinet.lineMode ? hasTrack(nowPlaying) : cabinet.queue.length > 1;

  // 放映页面板上半那块「此刻的环境音」。信息条已经写着 TITLE / PLAYLIST，
  // 面板再放一遍曲目就是重复；而环境音叠加 + 为音乐让位是这个软件独有的事，
  // 视频里根本不存在，放映页此前一处都没体现它。
  // 只数「在场且没被静音」的：静音的那几层不出声，算进去会让「3 层」变成谎话。
  const ambienceStage = useMemo(() => {
    const live = cabinet.ambience.filter(id => !cabinet.muted.includes(id));
    if (!live.length) return null;
    const layers = live
      .map(id => cabinet.records.find(record => record.id === id))
      .filter((record): record is RecordItem => Boolean(record));
    if (!layers.length) return null;
    // 最深的那一层决定「让出多少」：三层里有一层让 18 dB、两层让 6 dB，
    // 耳朵听到的是 18 dB 那一层，报平均值反而对不上听感。
    const depth = layers.reduce((most, record) => Math.max(most, record.duckDepth ?? 0), 0);
    // 「几层」与「几层静音」必须同一个分母：都只数**唱片还在柜里**的那些。
    // 原来静音数是 `cabinet.ambience.length - live.length`，按 id 数；而层数是
    // 按「还找得到这张唱片」数——某张环境音唱片被删了、id 还留在 ambience 里时，
    // 两个数各算各的，屏幕上就会出现「2 层 · 1 静音」而柜里其实只剩两张。
    const present = cabinet.ambience.filter(id => cabinet.records.some(record => record.id === id));
    const muted = present.filter(id => cabinet.muted.includes(id)).length;
    return {
      layers: layers.map(record => record.name),
      muted,
      ducked: status.ducked,
      depth,
    };
  }, [cabinet.ambience, cabinet.muted, cabinet.records, status.ducked]);

  // 信息条 PLAYLIST 那一行要的是「此刻真正在响的是什么」。
  // 之前用的是当前画面的文件名，画面和声音本来就没关系——
  // 画面放着 DROWNED DUSK、耳机里在放别的歌时，信息条会理直气壮地写错。
  // 两条路：外部音乐看媒体会话，本地看正在放的那张唱片。
  const stageNow = useMemo<StageNow>(() => {
    if (cabinet.lineMode) {
      if (!hasTrack(nowPlaying)) return null;
      return {
        kind: 'external',
        title: nowPlaying.title,
        artist: nowPlaying.artist,
        app: appLabel(nowPlaying.app),
        playing: nowPlaying.playing,
        // 系统媒体会话顺带给了专辑，拿来当 PLAYLIST 的副行。
        // 拿不到（很多本地文件没有这张标签）时是空串，副行自然不渲染。
        album: nowPlaying.album,
      };
    }
    const record = cabinet.records.find(item => item.id === status.currentId);
    if (!record) return null;
    return {
      kind: 'local',
      title: record.name,
      artist: record.artist,
      // musicPlaying 而不是 running：整间停止时 running 也会下去，
      // 但那和「这一首被暂停了」是两件事，这里只关心后者。
      playing: status.musicPlaying,
      // 进度来自 audio.ts 每次 tick 写入的 currentTime / duration，
      // 播放顺序是收藏柜自己的设置。两样都是现成的，不用新开数据源。
      at: status.currentTime,
      span: status.duration,
      order: orderNames[cabinet.order],
    };
  }, [cabinet.lineMode, cabinet.order, cabinet.records, status.currentId, status.musicPlaying, status.currentTime, status.duration, nowPlaying]);

  const artFor = (record: RecordItem) => pickSleeve(record.id, launchSeed);
  const selected = (record: RecordItem) => (record.category === 'music' ? cabinet.queue : cabinet.ambience).includes(record.id);
  // 「这一张在响吗」不能只看 status.playing：那是引擎级语义（任意一路在响就算），
  // 三张环境音坏了一张时它仍是 true，那张坏掉的封套照样转、队列里照样写「循环叠加」，
  // 用户会以为它在响、只是听不见。环境音这条按 ambientIds 逐张判。
  const isPlaying = (record: RecordItem) => status.running && (record.category === 'music' ? status.musicPlaying && status.currentId === record.id : status.ambientIds.includes(record.id));

    /**
    * 所有改动都从这里过：先落盘，成功了才更新内存与播放器。
    *
    * 顺序不能反。先 setCabinet 再 save 的话，落盘失败时界面已经变了
    * ——用户会以为自己改成功了，重启之后发现没保住。
    *
    * 抛出去是有意的：调用方（change）需要知道失败，但提示已经在这里发过了。
    */
  function commit(next: Cabinet) {
    try { cabinetStorage.current.save(next); cabinetRef.current = next; setCabinet(next); player.current?.update(next); }
    catch (error) { const reason = error instanceof CabinetWriteError ? error : new Error('设备存储空间不足，未保存这次修改。'); notify(message(reason)); throw reason; }
  }
    /** 改几个字段。落盘失败的提示由 commit 发，这里只负责不让异常冒到渲染层。 */
  function change(changes: Partial<Cabinet>) { try { commit({ ...cabinetRef.current, ...changes }); } catch { /* notice already shown */ } }
    /** 翻页。顺手清掉「当前展开的那张」：翻页之后它多半不在这一页了。 */
  function goToPage(next: number) { setPage(clampPage(next, visible.length)); setFocusId(undefined); }
  function turnPage(direction: number) { goToPage(currentPage + direction); }
  // 导入后要翻到最后一页；这里重新算一遍过滤结果，避免用到本次渲染前的 visible。
  function jumpToLastPage() { setPage(pageCount(cabinetRecords(cabinetRef.current, importType, query).length) - 1); setFocusId(undefined); }
  /**
   * 改一张唱片的元数据。
   *
   * 这里**必须用会抛的 commit**，不能走吞异常的 `change()`：编辑弹窗要根据
   * 成败决定关不关窗。走 change 的话，配额满 / 快照过期时用户点「保存介绍」
   * 只会闪一条 toast、窗立刻关、重开看到旧内容——他刚打的字全没了，
   * 而且没有任何东西告诉他保存失败过。
   */
  function editRecord(id: string, changes: Partial<RecordItem>) {
    commit({ ...cabinetRef.current, records: cabinetRef.current.records.map(r => r.id === id ? { ...r, ...changes } : r) });
  }
  /**
   * 开关外部音乐模式。
   *
   * 「接入外部播放器」不等于「接上了虚拟声卡」：歌名、封面来自系统媒体会话，
   * 跟声卡无关；声卡只决定**音频**能不能进来，也就是能不能做避让。
   * 所以抓不到声卡时不再整体失败——模式照开、歌名照显示，只是没有避让。
   * 反过来做的后果是：没装声卡的机器连「现在在放什么」都看不到，
   * 而这条信息本来就拿得到。
   *
   * 关：断开流，回到本地唱片。
   */
  async function toggleLineMode(next: boolean) {
    setLineError('');
    setNoCable(false);
    setLineHint('');
    if (!next) {
      line.current.close();
      player.current?.detachLineIn();
      change({ lineMode: false });
      return;
    }
    // 先把模式打开：订阅元数据这件事与音频来源无关，抓音频失败也不该把它拦下来。
    change({ lineMode: true });
    try {
      const stream = await line.current.open();
      player.current?.attachLineIn(stream);
      // 成功也可能是「接上了但没声音」（mac 的 silent：两秒半内没见到非零字节）。
      // 播放器暂停着的时候这是正常结果，所以不能算失败、不能弹提示；
      // 但如果用户正在放歌还没声音，那就是权限没给——把话留在设置面板里。
      if (line.current.lastReason) setLineHint(systemAudioHint(line.current.lastReason));
    } catch (error) {
      // 没接上只是「没有音频」，不是失败：歌名、封面来自系统媒体会话，与音频无关。
      // 原因交给设置面板的状态行说，不再用 toast 说「接不上外部音乐」——那句话会误导。
      //
      // 三种去处，规则是「用户能不能自己解决」：
      //   mac 的任何原因 → lineHint 一句具体的话（去设置开权限 / 重下安装包 / 就是没有）
      //   可重试的失败   → lineError（那个位置带「再试一次」，重试真的可能成）
      //   不可重试       → noCable（设备根本没装，重试必然再失败）
      if (line.current.lastReason) setLineHint(systemAudioHint(line.current.lastReason));
      else setLineError(isRetriable(error) ? lineInError(error) : '');
      setNoCable(!line.current.lastReason && error instanceof Error && error.name === 'NotFoundError');
    }
    // 不用在这里 setFilter 把「音乐」改掉：渲染时 activeFilter 会把
    // lineMode 下的 music 降级成 ambient（见那边的注释）。改 state 反而会
    // 把用户原来的选择吃掉——他关掉外部模式后回不到音乐那一栏了。
    // 打开外部音乐模式就等于「要听了」：环境音必须同时起来。
    // 否则外部音乐在响、环境音静音，避让没有任何东西可以压，
    // 用户只会觉得「避让没生效」。没接上声卡时也一样——那种情况下
    // 环境音是这个模式里唯一还会出声的东西。
    player.current?.startAmbientOnly();
  }
    /** 开合唱片卡片。右侧详情读的是 focusId，跟开合是两件事——合上了也仍停在这张上。 */
  function toggleFlip(id: string) {
    // 右侧读的是 focusId，跟开合是两件事：合上了也仍然停在这张上。
    setFocusId(id);
    setFlip(current => (current?.id === id && current.open ? { id, open: false } : { id, open: true }));
  }
  // 合上是「钉住」而不是「这一瞬间」：鼠标移开、焦点还在按钮上都不能把它掀开。
  // 之前这里会在指针离开时清掉状态，结果 :focus-within 立刻接管，卡片自己弹开。
  // 想再看悬停预览就点别的唱片，那张的锁定会随之让位。
  // 「刚刚加进去」的那一张留个记号，让圆圈弹一下再归位。
  // 只在「加进来」的时候放，取消选择不放——撤销不需要庆祝。
  function choose(record: RecordItem) {
    try {
      const wasSelected = selected(record);
      commit(toggleRecord(cabinetRef.current, record.id));
      setFocusId(record.id);
      if (!wasSelected) {
        setJustAdded({ id: record.id, token: (justAdded?.token ?? 0) + 1 });
        window.clearTimeout(justAddedTimer.current);
        justAddedTimer.current = window.setTimeout(() => setJustAdded(undefined), 460);
      }
    } catch (error) { notify(message(error)); }
  }
  /**
   * 单独开关某一路环境音。只改 muted 名单，不动 ambience——
   * 暂停的那一路留在队列里，随时能恢复，也不会把它从唱片柜里取消选择。
   */
  function toggleAmbience(record: RecordItem) {
    const muted = cabinetRef.current.muted.includes(record.id)
      ? cabinetRef.current.muted.filter(id => id !== record.id)
      : [...cabinetRef.current.muted, record.id];
    change({ muted });
  }
  /** 圆碟：开关播放卡。位置由 CSS 决定（底部抽屉），这里只切开关。 */
  function openCard() {
    setCardOpen(open => !open);
  }
  /** 传输键在两种模式下走不同链路：外部音乐交给系统媒体控制，本地走自己的播放器。 */
  function togglePlay() {
    if (cabinet.lineMode) { if (hasTrack(nowPlaying)) commandNowPlaying('toggle'); return; }
    player.current?.toggle();
  }
    /** 上一首。只在「总开关开着」时才动，否则按了会连环境音一起起——那不是用户要的。 */
  function previousTrack() {
    if (cabinet.lineMode) { if (hasTrack(nowPlaying)) commandNowPlaying('previous'); return; }
    player.current?.previous();
  }
    /** 下一首。只在总开关开着时动，否则按了会连环境音一起起。 */
  function nextTrack() {
    if (cabinet.lineMode) { if (hasTrack(nowPlaying)) commandNowPlaying('next'); return; }
    player.current?.next();
  }
    /**
    * 把用户选的图片处理成封面：缩放 + 取色，然后写回唱片。
    *
    * 取色失败不该让整个流程失败——封面图本身才是用户要的，颜色可以退回预设。
    */
  async function loadCover(id: string, coverId: string) {
    const blob = await readAsset(coverId); if (!blob) return;
    const previous = urls.current.get(coverId); if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob); urls.current.set(coverId, url); setCovers(old => ({ ...old, [id]: url }));
  }
  useEffect(() => {
    let active = true;
    const storage = new CabinetStorage(); cabinetStorage.current = storage;
    void (async () => {
      try {
        const loaded = await storage.load(); if (!active) return;
        const saved = loaded.cabinet;
        cabinetRef.current = saved; setCabinet(saved);
        // ready 必须在拿到 cabinet 后立刻置真，**不能等到整个流程跑完**。
        // 这里曾经是死锁来源：只有 try 末尾才 setReady(true)，而读盘一抛错就
        // 直接进 catch，结果界面永远停在「空柜 + 所有导入按钮全灰」。
        setReady(true);
        // 读坏和「丢了一两条」是两种严重程度，处理也不该一样：
        //   丢几条——自动跳过，一句话说清，然后照常用；
        //   整份读不出来——空柜摆在这儿，但保存是锁着的，等用户决定。
        //
        // 注意这里**不能**写成 `setSalvage(loaded.salvage)`：
        // 那个字段的意思是「备份有没有写成」，一旦备份失败（配额满、隐私模式）
        // 横幅就跟着不出现了——而备份失败恰恰是最需要告诉用户「你现在别乱动」的时候。
        // 备份成不成功是给「能不能还原」用的，不是用来决定「告不告诉人」的。
        if (loaded.broken) { setSalvage(true); setSalvageReason(loaded.reason); setSalvageRetried(loaded.retried); }
        else if (loaded.lost > 0) notify(`有 ${loaded.lost} 张唱片的数据不完整，已跳过；其余照常。`);
        player.current = new RoomPlayer(saved, state => { if (active) setStatus(state); }, error => { if (active) notify(message(error)); });
        const image = await readAsset('background'); if (!active) return;
        if (image) { const url = URL.createObjectURL(image); urls.current.set('background', url); setBackground(url); }
        // 封面并发读，不再一张一张排队：串行读 16 张要 1.5 秒，并发只要一个来回。
        const withCover = saved.records.filter(record => record.coverId);
        const worker = async () => {
          for (let next = withCover.shift(); next; next = withCover.shift()) {
            if (!active) return;
            await loadCover(next.id, next.coverId!);
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (!active) return;
        // 封面到位，界面已经能看了，这时才撤开屏，免得撤完再补一张张封面闪一下
        dismissSplash();
        // 上次开着外部音乐模式就自动接回来。
        // 抓不到声卡不再退回本地模式：模式（元数据）和音频是两件事，
        // 没声卡时歌名照样能显示，退回本地反而把拿得到的信息也关掉了。
        if (saved.lineMode) {
          try {
            const stream = await line.current.open();
            if (!active) { for (const track of stream.getTracks()) track.stop(); return; }
            player.current?.attachLineIn(stream);
            // 与 toggleLineMode 同一条规则：silent 也算接上了，只是把话留在面板里。
            if (line.current.lastReason) setLineHint(systemAudioHint(line.current.lastReason));
          } catch (error) {
            // 没接上只是「没有音频」。原因写进设置面板，不再每次启动弹一句 toast：
            // 没装声卡的机器每次开机都被提醒一遍，那是噪音，不是信息。
            // 与 toggleLineMode 同一条规则：只有用户能自己解决的原因才占用错误块。
            if (active) {
              if (line.current.lastReason) setLineHint(systemAudioHint(line.current.lastReason));
              else setLineError(isRetriable(error) ? lineInError(error) : '');
              setNoCable(!line.current.lastReason && error instanceof Error && error.name === 'NotFoundError');
            }
          }
          if (active) player.current?.startAmbientOnly();
        }
      } catch (error) {
        // 走到这里说明连「读盘」这一步本身都炸了（比如存储驱动不可用）。
        // 界面照样要能用：开屏撤掉、ready 置真、给一句提示。收藏读失败是数据问题，
        // 不该让整个软件变成一块点不动的空壳。
        dismissSplash();
        if (active) {
          setReady(true);
          notify(`本地收藏读取失败：${message(error)}。旧数据仍保留。`);
        }
      }
    })();
    return () => { active = false; line.current.close(); player.current?.dispose(); player.current = null; window.clearTimeout(justAddedTimer.current); window.clearTimeout(previewTimer.current); window.clearTimeout(confirmTimer.current); for (const url of urls.current.values()) URL.revokeObjectURL(url); urls.current.clear(); };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  // Escape 走自己的关闭路径：dialog 的 cancel 事件不冒泡，React 的 onCancel 收不到，
  // 浏览器会直接原生关闭，退出动画来不及播。在 document 上抢在它之前拦下。
  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      if (!busyRef.current) setModal(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [modal]);
  useEffect(() => {
    if (!sleepUntil) return;
      // 80ms 一拍，只读播放器的实时电平给波形用。
      // 不走 status：那是 200ms 推一次的节流数据，波形会一顿一顿。
    const tick = () => {
      const left = Math.max(0, Math.ceil((sleepUntil - Date.now()) / 1000));
      setRemaining(left);
      if (left) return;
      player.current?.pause();
      setSleepUntil(0);
      notify('定时结束，晚安。');
      // 定时到点是「该去睡了」，不光要停声音，还得把界面收回可预期的状态。
      // 只停播放的话：人回来时可能看到一张还开着的弹窗、一个还铺满的全屏、
      // 或者一个卡在半途的卡片——都不像「结束了」，得像「已经收好了」。
      // 这里只管界面，不碰数据：编辑中的草稿、正在导入的进度都原样留着。
      setModal(null);
      setCardOpen(false);
      setView('cabinet');
      // 全屏由 MediaRoom 自己管（窗口 + 页面要一起退，见它的 toggleFullscreen）。
      // 这里只递一个递增的请求号，它收到几号就执行一次。
      setExitFullscreen(at => at + 1);
    };
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [sleepUntil]);

    /**
    * 导入文件。逐张处理并在 report 里累积结果，**一张失败不中断整批**——
    * 用户拖了 20 个文件进来，其中一个格式不对，其他 19 个还是要进的。
    */
  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const all = [...(event.target.files ?? [])]; event.target.value = '';
    if (!all.length || busyRef.current) return;
    try { cabinetStorage.current.assertWritable(); } catch (error) { notify(message(error)); return; }
    busyRef.current = true;
    const files = all.filter(isAudioFile), errors: string[] = [];
    // 同一条失败原因只报一次。
    // 磁盘满的时候，二十个文件会依次在同一处失败，全照实列出就是二十行
    // 一模一样的「空间不足」——用户看不到「这其实是同一个问题」。
    // 相同文案合并成一条，后面挂个次数。
    //
    // 索引必须和计数一起记下来。曾经写成「第二次把元素替换成带后缀的文案、
    // 第三次再用 findIndex 找原文」——第三次就已经找不到（元素变了），
    // 于是写到 errors[-1] 上，20 个文件永远只显示「共 2 次」。
    const seen = new Map<string, { count: number; at: number }>();
      // 往导入报告里追加一条错误。报告是给用户看的清单，不是日志——
      // 每条都要是「哪个文件、为什么不行」这种能照着改的话。
    const pushError = (text: string) => {
      const hit = seen.get(text);
      if (!hit) {
        seen.set(text, { count: 1, at: errors.length });
        errors.push(text);
        return;
      }
      hit.count += 1;
      errors[hit.at] = `${text}（共 ${hit.count} 次）`;
    };
    let added = 0, duplicates = 0, unmatched = 0;
    try {
      const known = new Set(cabinetRef.current.records.map(r => r.fingerprint));
      for (const [index, file] of files.entries()) {
        setBusy(`正在收藏 ${index + 1} / ${files.length}`);
        if (known.has(fingerprint(file))) { duplicates++; continue; }
        try {
          const { record, cover } = await inspectAudio(file, importType, cabinetRef.current.records.length);
          cabinetStorage.current.assertWritable();
          await storeAsset(record.assetId, file);
          if (cover && record.coverId) await storeAsset(record.coverId, cover);
          try {
            commit({ ...cabinetRef.current, records: [...cabinetRef.current.records, record] });
          } catch (error) {
            // 资产已经写进 IndexedDB 了，但 cabinet 里没有这条记录——
            // 不收拾的话它就是永久孤儿：没人引用、没人删，一直吃配额。
            // 攒够了之后连正常保存都开始失败，用户看到的是「软件突然什么都存不进去了」。
            // 所以这一步失败必须把刚写进去的资产撤回。
            await storeAsset(record.assetId).catch(() => undefined);
            if (record.coverId) await storeAsset(record.coverId).catch(() => undefined);
            throw error;
          }
          if (record.coverId) await loadCover(record.id, record.coverId);
          known.add(record.fingerprint); added++; setFocusId(record.id);
          if (record.category === 'ambient' && !record.coverId && !record.coverPreset) unmatched++;
        } catch (error) { pushError(message(error)); }
      }
      if (!files.length) errors.push('没有找到支持的音频文件。');
      setReport(errors); setFilter(importType); setView('cabinet');
      // 新导入的唱片排在末尾，直接翻到最后一页，省得用户自己找。
      if (added > 0) jumpToLastPage();
      notify(`已收藏${added} 张唱片${duplicates ? `，跳过${duplicates} 个重复文件` : ''}${errors.length ? `，${errors.length} 项未导入` : ''}${unmatched ? `；${unmatched} 张未匹配封面，可点击「选择封面」` : ''}`);
      if (!errors.length) setModal(null);
    } finally { setBusy(''); busyRef.current = false; }
  }
  async function uploadPicture(event: ChangeEvent<HTMLInputElement>, forCover: boolean) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || busyRef.current) return;
    const record = focused; if (forCover && !record) return;
    busyRef.current = true; setBusy('正在拾取色彩');
    try {
      const { blob, color } = await prepareImage(file);
      cabinetStorage.current.assertWritable();
      const id = forCover ? `cover-${record!.id}` : 'background';
      // 先把文本落盘，再写资产。反过来的话，文本保存失败（配额满、快照过期）
      // 会留下「档案里有这张封面/背景的名字、资产却是刚写进去又没人认领」的半截状态。
      // 封面那条走 editRecord → change（吞异常），所以这里单独用 commit 确认能写。
      if (forCover) commit({ ...cabinetRef.current, records: cabinetRef.current.records.map(r => r.id === record!.id ? { ...r, coverId: id, coverPreset: undefined, color } : r) });
      else commit({ ...cabinetRef.current, theme: color, imageName: file.name });
      await storeAsset(id, blob);
      if (forCover) await loadCover(record!.id, id);
      else {
        const previous = urls.current.get('background'); if (previous) URL.revokeObjectURL(previous);
        const url = URL.createObjectURL(blob); urls.current.set('background', url); setBackground(url);
      }
      notify(forCover ? '唱片换上了新的封面。' : '空间已染上这张照片的色彩。');
    } catch (error) { notify(message(error)); } finally { busyRef.current = false; setBusy(''); }
  }
    /** 打开导入面板。清掉上一次的报告，否则用户会看到上一批的残留。 */
  function openImport(type?: RecordType) { setReport([]); if (type) setImportType(type); setModal('import'); }
  // 媒体库：把选中的目录移出。条目一起清掉，不然界面会留着一堆打不开的缩略图。
  function forgetMediaDir(dir: string) {
    const keep = cabinetRef.current.media.filter(item => !isInside(item.path, dir));
    setMediaDirs(dirs => dirs.filter(item => item !== dir));
    change({ media: keep, mediaDirs: cabinetRef.current.mediaDirs.filter(item => item !== dir) });
    // 主进程那边的读取授权也要撤掉。只删前端的条目，`media://` 照样读得到
    // 那个目录——「移出」就成了纯视觉的，用户以为删了其实权限还在。
    forgetMediaDirGrant(dir);
  }
  // 移出壁纸库：只清壁纸读进来的那批（带 source 的）。
  // 自己加的文件夹、单独导入的文件都不属于壁纸库，一件都不能动。
  //
  // 不清完就重扫：下次点「读取壁纸库」会重新读一遍，用户想找回来随时可以。
  // 但主进程那边的壁纸根目录白名单留着——重扫要读同一个位置。
  function forgetWallpapers() {
    const keep = dropWallpapers(cabinetRef.current.media);
    if (keep.length === cabinetRef.current.media.length) return;
    change({ media: keep });
  }
  /**
   * 移出**单个**条目（票根上的删除按钮）。
   *
   * 两种来源行为不同，这是有意的、也是用户选过的（2026-11-19）：
   *
   * - 文件夹里的条目：只从这份收藏里移出，**磁盘上不删**。下次他主动点
   *   「重新扫描」还会回来——扫描的语义就是「这个目录现在长这样」，让删除
   *   永久生效就得在收藏里额外记一份黑名单，代价是存储结构要改。用户明确
   *   选了「删的只是这一份收藏」，所以这里不记黑名单。
   * - 单独导入的文件：它不属于任何目录，没有东西能把它扫回来，所以移出就是
   *   真的走了。对应的读取授权必须一起撤，否则 `media://` 还读得到。
   *
   * 不撤目录授权：条目所在的目录是整批加进来的，删一张图不该连累别的。
   */
  function forgetMediaItem(id: string) {
    const item = cabinetRef.current.media.find(entry => entry.id === id);
    if (!item) return;
    const next = cabinetRef.current.media.filter(entry => entry.id !== id);
    change({ media: next });
    // 只对「不在任何目录里」的条目撤文件授权。文件夹里的条目靠目录授权读，
    // 在这里多撤一次不影响使用，但会白白写一次台账文件。
    if (!cabinetRef.current.mediaDirs.some(dir => isInside(item.path, dir))) forgetMediaFileGrant(item.path);
    // 当前正在放映的恰好是被删的那张：台面上会留着一个指向空条目的画面。
    // 这里不清 currentId——MediaRoom 内部自己按 `usable` 重新找 current，
    // 找不到就落到第一件，删完立刻切过去是它的既有行为。
  }
    /** 打开编辑面板。默认编辑「当前展开的那张」，也可以从别处直接指定。 */
  function openEdit(record = focused) { if (!record) return; setFocusId(record.id); setDraft({ name: record.name, artist: record.artist, description: record.description }); setDraftError(''); setModal('edit'); }
  /**
   * 换封面：封面库和「按名称重新匹配」都走这里。
   *
   * 调的是会抛的 `editRecord`，而这几颗按钮是直接挂在弹窗里的（不像保存那样
   * 有提交回调可以 catch），所以失败必须就地兜住：不兜的话异常会从 React 的
   * 事件处理里逃出去，封面没换成、界面也没提示。
   */
  function chooseCover(cover: AmbientCover) {
    if (!focused) return;
    try { editRecord(focused.id, { coverId: undefined, coverPreset: cover.id, color: cover.color }); }
    catch (error) { notify(message(error)); }
  }
    /** 自动配封面：给所有还没有封面的唱片按名字匹配预设。用户手动换过的不会被覆盖。 */
  function autoCover() {
    const cover = matchAmbientCover(draft.name);
    if (cover) { chooseCover(cover); notify(`已换成「${cover.name}」封面。`); }
    else notify('还没有匹配到，选一张你喜欢的封面吧。');
  }
  /**
   * 试听：点一下播 8 秒，再点一下停。
   *
   * 不用 status 里的状态判断，因为试听不改变「现在在放哪一首」——
   * 它只是一个临时冒出来的声音，播完自己收。
   */
  async function togglePreview(record: RecordItem) {
    window.clearTimeout(previewTimer.current);
    if (previewId === record.id) { setPreviewId(undefined); player.current?.stopPreview(); return; }
    try {
      setPreviewId(record.id);
      await player.current?.preview(record.id);
      previewTimer.current = window.setTimeout(() => setPreviewId(undefined), 8400);
    } catch (error) {
      setPreviewId(undefined);
      notify(message(error));
    }
  }
  /**
   * 从唱片柜移除：第一下只是把按钮变红，第二下才真的删。
   * 不弹确认框——删一张唱片不值得多一层窗口，但误触也不该直接丢东西。
   */
  function removeFromCabinet(record: RecordItem) {
    if (confirmRemove !== record.id) {
      setConfirmRemove(record.id);
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => setConfirmRemove(undefined), 2000);
      return;
    }
    window.clearTimeout(confirmTimer.current);
    setConfirmRemove(undefined);
    takeOffShelf(record);
  }
  /**
   * 清理封面缓存。
   *
   * 只删「不再被任何唱片引用的封面图」——换过封面之后，旧的那张还留在库里，
   * 攒多了就是几十兆的死重量。音频永远不碰：那是用户的原始素材，
   * 删错一张唱片就再也放不出声了，而这个按钮连碰都不该碰它们。
   */
  async function clearCoverCache() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('正在清理');
    try {
      const keys = await listAssetKeys();
      const current = cabinetRef.current;
      const used = new Set<string>();
      for (const record of current.records) if (record.coverId) used.add(record.coverId);
      used.add('background');
      // 封面图统一叫 cover-<唱片 id>，只认这个前缀，其余一律当音频留着
      const stale = keys.filter(key => key.startsWith('cover-') && !used.has(key));
      if (!stale.length) { notify('没有需要清理的封面缓存。'); return; }
      cabinetStorage.current.assertWritable();
      for (const key of stale) {
        await storeAsset(key);
        const url = urls.current.get(key);
        if (url) { URL.revokeObjectURL(url); urls.current.delete(key); }
      }
      notify(`已清理 ${stale.length} 张不再使用的封面缓存，音频没有动。`);
    } catch (error) {
      notify(message(error));
    } finally { setBusy(''); busyRef.current = false; }
  }
    /** 从唱片柜拿走一张（不是删文件）。队列与环境音里的引用一起清掉。 */
  function takeOffShelf(record: RecordItem) {
    // Remove only the catalog entry; preserve the stored asset and source file.
    try { commit(removeRecord(cabinetRef.current, record.id)); setFocusId(undefined); setModal(null); notify('已从唱片柜移除，源文件不受影响。'); } catch { /* notice already shown */ }
  }
    /** 清空放映背景。图片资源一并释放（IndexedDB 里那份），不要只把界面上的引用摘掉。 */
  async function clearBackground() {
    // 和 clearCoverCache 一样要挡住并发：这里会整份 commit，跑到一半和导入 /
    // 封面写入交错，两边各写一次完整 cabinet，后来者把前者的改动盖掉。
    if (busyRef.current) return;
    try {
      cabinetStorage.current.assertWritable();
      // 顺序反了会留下半截状态：先删资产、再存文本，如果存文本失败（配额满、
      // 快照过期），图没了但 imageName 还留着，下次保存就把「有名字没图」写进存档。
      // 所以先落文本，再动资产——文本成了之后资产删不干净最多是多占一点空间。
      //
      // 这里必须用会抛异常的 commit，不能用 change：change 把异常吞了，
      // 吞掉之后代码会继续往下删资产，等于又走回了「图没了、名字还在」。
      commit({ ...cabinetRef.current, theme: emptyCabinet.theme, imageName: '' });
      await storeAsset('background');
      const url = urls.current.get('background');
      if (url) URL.revokeObjectURL(url);
      urls.current.delete('background');
      setBackground('');
    } catch (error) { notify(message(error)); }
  }
  return <div className={`app ${background ? 'has-scenery' : ''}`} style={{ '--accent': cabinet.theme, '--scenery': background ? `url("${background}")` : 'none' } as CSSProperties}>
    <input ref={filesInput} type="file" multiple accept="audio/*,.flac,.ogg,.wav,.mp3,.m4a" className="hidden" aria-label="选择本地音频文件" onChange={importFiles} />
    <input ref={folderInput} type="file" multiple {...{ webkitdirectory: '', directory: '' }} className="hidden" aria-label="选择本地音频文件夹" onChange={importFiles} />
    <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="选择空间背景" onChange={e => void uploadPicture(e, false)} />
    <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="选择唱片封面" onChange={e => void uploadPicture(e, true)} />
    <div className="background-wash" /><div className="paper-grain" />
    <div className="portrait-shell">
      {salvage && (
        <div className="salvage-bar" role="alert">
          <p>
            {salvageReason ? `${salvageReason}，` : '收藏读不出来，'}保存已暂停——先别急着加东西，不然空柜会盖掉原来那份。
          </p>
          <div className="salvage-actions">
            {/* 已经试过一次「恢复原文件」而且照样读不出来时，不再给这颗按钮：
                恢复做的事情就是把那份原文写回主键，同样的原文再写一遍必然还是读不出来，
                点了只会重载一遍又回到这个横幅。留一颗注定失败的按钮，用户会一遍遍点它。 */}
            {!salvageRetried && <button type="button" className="text-button" onClick={() => {
              // 备份写回主键，然后整页重载从它重新读——比在这里手工重建
              // 播放器、封面、外部音乐那套状态安全得多。
              // 传的是**本组件正在用的实例**，不是模块单例：那个单例从来没人写盘，
              // 解它等于没解（见 cabinet-storage.ts 底部注释）。
              if (restoreSalvage(cabinetStorage.current)) location.reload();
              else notify('备份读不出来了，没法还原。你可以先另存一份数据再决定。');
            }}>恢复原文件</button>}
            <button type="button" className="text-button" onClick={() => {
              // 同上：必须解当前实例的锁，否则横幅消失、保存照样失败。
              adoptEmptyCabinet(cabinetStorage.current);
              setSalvage(false);
            }}>不要了，从空柜开始</button>
          </div>
        </div>
      )}
      <header className="masthead">
        <a href="#" className="brand" onClick={e => { e.preventDefault(); setView('cabinet'); }}>
          <Bird size={18} strokeWidth={1.3} />
          <span>RAVEN <i>ambient</i></span>
        </a>
        <div className="header-actions">
          <span className="local-status"><i />LOCAL ONLY</span>
          <button className="icon-button" aria-label="使用说明" onClick={() => setModal('guide')}>
            <Info size={16} />
          </button>
          <button className="icon-button" aria-label="空间设置" onClick={() => setModal('settings')}>
            <Settings2 size={17} />
          </button>
        </div>
      </header>
      <section className="today-head">
        <div className="today-row">
          <h1 key={view} className="today-title">{viewTitles[view]}</h1>
          <div className="today-stamp">
            <span>{todayStamp}</span>
            <i />
            <span className="today-count">
              <RollNumber value={view === 'cabinet' ? cabinet.records.length : view === 'listening' ? selectedCount : view === 'media' ? cabinet.media.length : Number(status.running)} minDigits={2} />
            </span>
          </div>
        </div>
      </section>
      <ViewTabs view={view} playing={playingNow} cardOpen={cardOpen} discCover={discCover} sleepUntil={sleepUntil} remaining={remaining} navigationRef={viewLayout.navigationRef} onSelect={selectView} onCard={openCard} />
      <div ref={viewLayout.stageRef} className="view-stage" data-motion={pageMotion.phase} data-view={pageMotion.value} inert={pageMotion.phase === 'exit'} style={{ '--page-direction': pageMotion.direction, '--wipe-x': `${wipe.x}px`, '--wipe-y': `${wipe.y}px`, '--wipe-r': `${wipe.r}px` } as CSSProperties}>
      <div ref={viewLayout.contentRef} className="view-content">
      {pageMotion.value === 'cabinet' ? <>
        <div className="collection-toolbar">
          <div ref={filterTabsRef} className="filter-tabs" role="group" aria-label="唱片分类">
            <span className="flip-marker" aria-hidden="true" />
            {(cabinet.lineMode ? (['selected', 'ambient'] as const) : (['selected', 'music', 'ambient'] as const)).map(type => <button
              key={type}
              aria-pressed={activeFilter === type}
              className={activeFilter === type ? 'active' : ''}
              onClick={event => selectFilter(type, event.currentTarget)}
            >{type === 'selected' ? '已选择' : type === 'music' ? '音乐' : '环境音'}</button>)}
          </div>
          <label className="search">
            <Search size={13} />
            <input aria-label="搜索唱片" placeholder="寻找一张唱片" value={query} onChange={e => setQuery(e.target.value)} />
          </label>
        </div>
        <div ref={shelfRef} className={`cabinet-layout ${!cabinet.records.length ? 'empty-cabinet-layout' : ''}`} data-motion={filterMotion.phase} style={{ '--wipe-x': `${shelfWipe.x}px`, '--wipe-y': `${shelfWipe.y}px`, '--wipe-r': `${shelfWipe.r}px` } as CSSProperties}>
          <section className="cabinet" aria-label="我的唱片柜"><div className="cabinet-corners"><i /><i /><i /><i /></div>
            {!cabinet.records.length ? <div className="empty-cabinet"><div className="empty-art"><Sleeve playing={false} preview /></div><span className="shelf-line" /><div className="empty-copy"><h2>唱片柜还是空的</h2><button className="primary-button" disabled={!ready || !!busy} onClick={() => openImport()}><Plus size={14} />放入第一张唱片</button></div></div> : <>
              <div className="shelf-label"><span>{activeFilter === 'ambient' ? '此刻的环境音' : '此刻的声音'}</span><span><RollNumber value={visible.length} minDigits={2} /></span></div>

              <ul className="record-grid">
                {shown.map(record => <RecordCard
                  key={record.id}
                  record={record}
                  cover={coverFor(record)}
                  art={artFor(record)}
                  selected={selected(record)}
                  justAdded={justAdded?.id === record.id}
                  order={cabinet.queue.indexOf(record.id) + 1}
                  flip={flip?.id === record.id ? (flip.open ? 'open' : 'closed') : undefined}
                  playing={isPlaying(record)}
                  onFocus={() => { if (!modal) toggleFlip(record.id); }}
                  onSelect={() => choose(record)}
                />)}
              </ul>
              {pages > 1 && <nav className="shelf-pager" aria-label="唱片分页">
                <button className="pager-arrow" aria-label="上一页" disabled={currentPage === 0} onClick={() => turnPage(-1)}><ChevronLeft size={13} /></button>
                <div className="pager-numbers">
                  {Array.from({ length: pages }, (_, index) => <button
                    key={index}
                    className={index === currentPage ? 'active' : ''}
                    aria-label={`第 ${index + 1} 页`}
                    aria-current={index === currentPage ? 'page' : undefined}
                    onClick={() => goToPage(index)}
                  >{String(index + 1).padStart(2, '0')}</button>)}
                </div>
                <button className="pager-arrow" aria-label="下一页" disabled={currentPage === pages - 1} onClick={() => turnPage(1)}><ChevronRight size={13} /></button>
              </nav>}
              {!visible.length && <div className="no-results">
                <Disc3 size={28} />
                <p>{query ? '还没有找到这张唱片。' : activeFilter === 'selected' ? '把喜欢的声音，加入此刻。' : '这一格，等一个新的声音。'}</p>
                {activeFilter === 'selected' && !query ? <>
                  <small>在音乐和环境音中点击 ＋，就会出现在这里。</small>
                  <div className="selection-links">
                    <button className="text-button" onClick={event => selectFilter('music', event.currentTarget)}>挑选音乐<ArrowRight size={12} /></button>
                    <button className="text-button" onClick={event => selectFilter('ambient', event.currentTarget)}>挑选环境音 <ArrowRight size={12} /></button>
                  </div>
                </> : <button className="text-button" onClick={() => openImport(activeFilter === 'ambient' ? 'ambient' : 'music')}>收藏本地音频 <Plus size={12} /></button>}
              </div>}
              <button className="add-to-shelf" disabled={!ready || !!busy} onClick={() => openImport(activeFilter === 'ambient' ? 'ambient' : 'music')}><Plus size={15} /><span>再收藏一个声音</span></button>
            </>}
            <div className="cabinet-base"><span>R / A</span><span>HANDLE WITH FEELING.</span><i /></div>
          </section>
          <aside className="record-notes" aria-label="唱片介绍">{focused ? <>
            <RecordNotes
              record={focused}
              cover={coverFor(focused)}
              playing={isPlaying(focused)}
              selected={selected(focused)}
              previewing={previewId === focused.id}
              confirming={confirmRemove === focused.id}
              onEdit={() => openEdit()}
              onPreview={() => void togglePreview(focused)}
              onRemove={() => removeFromCabinet(focused)}
              onSelect={() => choose(focused)}
              onChange={changes => { try { editRecord(focused.id, changes); } catch (error) { notify(message(error)); } }}
            />
          </> : <div className="empty-notes"><Sparkles size={25} strokeWidth={1} /><p>点开一张唱片，<br />它的介绍会出现在这里。</p></div>}</aside>
        </div>
      </> : pageMotion.value === 'listening' ? <ListeningRoom
        cabinet={cabinet}
        status={status}
        externalDisc={externalDisc}
        shownOutgoing={shownOutgoing}
        current={current}
        focused={focused}
        titleRecord={titleRecord}
        coverFor={coverFor}
        nowPlaying={nowPlaying}
        onToggleAmbience={toggleAmbience}
        onChoose={choose}
        onChange={change}
        onPlayRecord={id => player.current?.playRecord(id)}
        onBack={() => setView('cabinet')}
      /> : null}
      <div hidden={pageMotion.value !== 'focus'}><FocusRoom active={view === 'focus' && pageMotion.value === 'focus' && pageMotion.phase !== 'exit'} playing={status.running} hasSelection={selectedCount > 0} onPlaySelection={() => player.current?.start()} onNotice={notify} disc={miniDiscSource} onPrev={previousTrack} onNext={nextTrack} canSkip={canSkipDisc} /></div>
      <div hidden={pageMotion.value !== 'media'}>
        <MediaRoom
          items={mediaReady ? cabinet.media : []}
          dirs={mediaDirs}
          active={view === 'media' && pageMotion.value === 'media'}
          onPick={pickMediaFolder}
          onRescan={rescanMediaFolder}
          onForgetDir={forgetMediaDir}
          onForgetItem={forgetMediaItem}
          onScanWallpapers={scanWallpapers}
          onPickFiles={pickMediaFiles}
          onForgetWallpapers={forgetWallpapers}
          exitFullscreen={exitFullscreen}
          disc={miniDiscSource}
          ambience={ambienceStage}
          now={stageNow}
          onPrevTrack={canSkipDisc ? previousTrack : undefined}
          onNextTrack={canSkipDisc ? nextTrack : undefined}
        />
      </div>
      </div>
      </div>
    </div>
      <PlayCard
        open={cardOpen}
        playing={playingNow}
        title={discTitle}
        subtitle={discSubtitle}
        cover={discCover}
        time={formatTime(status.currentTime)}
        duration={formatTime(status.duration)}
        timeValue={status.currentTime}
        durationValue={status.duration}
        level={levelTick}
        musicOn={status.running && status.musicOn}
        ambientOn={status.running && status.ambientOn}
        musicReady={!!cabinet.queue.length}
        lineMode={cabinet.lineMode}
        order={cabinet.order}
        master={cabinet.master}
        onClose={() => setCardOpen(false)}
        onToggle={togglePlay}
        onPrev={previousTrack}
        onNext={nextTrack}
        onSeek={value => { if (cabinet.lineMode) return; player.current?.seek(value * (status.duration || 0)); }}
        onToggleMusic={() => player.current?.toggleMusic()}
        onToggleAmbient={() => player.current?.toggleAmbient()}
        onOrder={() => change({ order: nextOrder(cabinet.order) })}
        onMaster={value => change({ master: value })}
      />
      <dialog ref={modalRef} className="modal" data-motion={dialogMotion.phase} aria-labelledby="modal-title" onClick={e => { if (e.target === modalRef.current && !busy) setModal(null); }}><div className="modal-content" inert={dialogMotion.phase === 'exit'}><button className="modal-close icon-button" aria-label="关闭窗口" disabled={!!busy} onClick={() => setModal(null)}><X size={18} /></button>
      {shownModal === 'import' && <ImportModal importType={importType} busy={busy} ready={ready} report={report} onType={setImportType} onFiles={() => filesInput.current?.click()} onFolder={() => folderInput.current?.click()} />}
      {shownModal === 'edit' && focused && <EditModal
        record={focused}
        draft={draft}
        draftError={draftError}
        busy={busy}
        confirming={confirmRemove === focused.id}
        nameInputRef={nameInputRef}
        onDraft={setDraft}
        onSubmit={() => {
          setDraftError('');
          // 存不进去就别关窗：一关窗用户在弹窗里刚打的字就没了，重开看到的是
          // 旧内容，而他只会看到一闪而过的 toast。失败原因写进 draftError，
          // EditModal 会把名称框标红、把这句话放在框下面（那条支路本来就在）。
          try { editRecord(focused.id, { ...draft, name: draft.name.trim() }); }
          catch (error) { setDraftError(message(error)); return; }
          setModal(null);
        }}
        onChooseCover={chooseCover}
        onAutoCover={autoCover}
        onUploadCover={() => coverInput.current?.click()}
        onRemove={() => removeFromCabinet(focused)}
      />}
      {shownModal === 'settings' && <SettingsModal
        cabinet={cabinet}
        busy={busy}
        background={background}
        lineError={lineError}
        noCable={noCable}
        lineHint={lineHint}
        status={status}
        sleepUntil={sleepUntil}
        remaining={remaining}
        imageInput={imageInput}
        onChange={change}
        onClearBackground={() => void clearBackground()}
        onToggleLineMode={next => void toggleLineMode(next)}
        onClearCoverCache={() => void clearCoverCache()}
        onSetSleep={raw => setSleepUntil(Number(raw) ? Date.now() + Number(raw) * 60000 : 0)}
      />}
      {shownModal === 'guide' && <GuideModal onClose={() => setModal(null)} />}
    </div></dialog>
    <MotionNotice message={notice} onClose={() => setNotice('')} />
  </div>;
}
