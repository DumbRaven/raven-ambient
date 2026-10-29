import { type ChangeEvent, type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Bird, Check, CheckCheck, ChevronLeft, ChevronRight, Disc3, FolderOpen, Headphones, ImagePlus, Info, LoaderCircle, Music2, Plus, RotateCcw, Search, Settings2, Sparkles, Timer, Trash2, Waves, X } from 'lucide-react';
import FocusRoom from './FocusRoom';
import { cabinetRecords, clampPage, emptyCabinet, fingerprint, isAudioFile, nextOrder, orderNames, pageCount, paginate, removeRecord, toggleRecord, trackTransitions, transitionHints, transitionNames, type Cabinet, type CabinetFilter, type RecordItem, type RecordType } from './records';
import { ambientCovers, ambientCoverUrl, matchAmbientCover, type AmbientCover } from './ambient-covers';
import { CabinetStorage, CabinetWriteError } from './cabinet-storage';
import { RoomPlayer, type RoomStatus } from './player';
import { inspectAudio } from './importer';
import { prepareImage, readAsset, storeAsset } from './storage';
import { formatTime } from './model';
import { depthRange, describeDepth } from './ducking';
import { launchSeed, pickSleeve, type SleeveArt, type SleeveMotif } from './sleeves';
import { coverPalette, recordPressing, vinylPalette } from './vinyl';
import { coverMarks } from './cover-marks';
import MusicQueue from './MusicQueue';
import RecordPlayer, { type TurntableDisc } from './RecordPlayer';
import PlayCard from './PlayCard';
import { dismissSplash } from './splash';
import RollNumber from './roll-number';
import { LineIn, lineInError } from './line-in';
import { appLabel, emptyNowPlaying, hasTrack, parseNowPlaying, playbackHint, type NowPlaying } from './now-playing';
import { askNowPlaying, commandNowPlaying, listenNowPlaying } from './now-playing-bridge';
import { useDialogMotion, useFilterMotion, usePageMotion } from './use-motion';
import { useViewLayout } from './use-view-layout';
import MotionNotice from './MotionNotice';

const emptyStatus: RoomStatus = { running: false, playing: false, musicPlaying: false, ducked: false, level: 0, currentTime: 0, duration: 0, musicOn: true, ambientOn: true, lineInput: 0, lineLive: false };
type Modal = 'import' | 'settings' | 'edit' | 'guide' | null;
function message(error: unknown) { return error instanceof Error ? error.message : '没有完成，请重试。'; }
/**
 * 滑杆 + 可直接输入的数字。
 *
 * 只给滑杆时，用户想精确调到某个值只能一格一格蹭；尤其「避让幅度」以 dB 计、
 * 差 1 dB 听感就不同。数字和滑杆绑同一份值，两边都能改。
 *
 * 平时它看起来就是一行文字（标签在左、数字在右），点上去才变成输入框。
 * 常驻一个带边框的 number input 会把右侧面板弄得像张表单 —— 这是用户明确否掉的。
 *
 * 输入过程中的中间态（清空、只打了负号）不能直接往上游写，否则值会在
 * 「没输入完」时被夹到 min，输入框自己跳数字。所以草稿单独存一份，
 * 失焦或回车时才提交；期间滑杆仍按上一个有效值画。
 */
function Slider({ label, value, onChange, min = 0, max = 100, unit = '%' }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; unit?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  function commit(text: string) {
    const parsed = Number.parseInt(text, 10);
    setDraft(null);
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(max, Math.max(min, parsed));
    if (next !== value) onChange(next);
  }

  return (
    <label className="slider-field">
      <span>
        <span className="slider-label">{label}</span>
        {/* 不编辑时是一个只读的 <span>，点上去才换成 <input>。
            这样平时它和「11%」是同一行文字，不会凭空多出一个框。 */}
        <span className={`slider-value ${editing ? 'is-editing' : ''}`}>
          {editing ? (
            <input
              className="slider-number"
              type="number"
              inputMode="numeric"
              step={1}
              min={min}
              max={max}
              autoFocus
              aria-label={label}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onBlur={event => commit(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); commit((event.target as HTMLInputElement).value); }
                else if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
              }}
            />
          ) : (
            <button
              type="button"
              className="slider-read"
              aria-label={`${label}，${value}${unit}，点击可输入`}
              onClick={() => setDraft(String(value))}
            >
              {value}
            </button>
          )}
          {unit && <em>{unit}</em>}
        </span>
      </span>
      <input type="range" aria-label={label} min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as CSSProperties} />
    </label>
  );
}
function Vinyl({ record, color, cover, spinning = false }: { record?: RecordItem; color: string; cover?: string; spinning?: boolean }) {
  // 内圈始终是封面；外圈按封面取色做成彩色胶盘。没有封面时用唱片自己的颜色。
  const pressing = recordPressing(record?.id ?? color, launchSeed);
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
    '--vinyl-angle': `${pressing.angle}deg`,
  } as CSSProperties;
  return <span className={`vinyl pressing-${pressing.style} ${palette.light ? 'is-light' : ''} ${spinning ? 'spinning' : ''}`} style={style}><span className="vinyl-label" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} /><i className="spindle" /></span>;
}
function Sleeve({ record, cover, art, playing, preview = false }: { record?: RecordItem; cover?: string; art?: SleeveArt; playing: boolean; preview?: boolean }) {
  // 有自定义封面就照用；没有就用本次启动随机到的封套款式。
  const motif = cover ? undefined : art?.motif ?? 'orbit';
  const tone = art?.tone;
  const artStyle = motif ? { '--cover-from': tone?.from ?? '#d3d9cb', '--cover-to': tone?.to ?? '#8b9c85', '--cover-ink': tone?.ink ?? '#f6f8ec' } as CSSProperties : undefined;
  return <span className={`record-case ${preview ? 'showcase-case' : ''} ${record?.category === 'ambient' ? 'ambient-case' : ''}`} style={{ '--record-color': record?.color ?? '#a0a79d' } as CSSProperties}>
    <span className="case-back" /><span className="disc-pocket"><Vinyl record={record} color={record?.color ?? '#a0a79d'} cover={cover} spinning={playing} /></span>
    <span className="case-front"><span className={`cover-art ${record?.category === 'ambient' ? 'cover-ambient' : 'cover-music'} ${motif ? `sleeve-${motif}` : ''}`} style={cover ? { backgroundImage: `url("${cover}")` } : artStyle}>{motif && <SleeveMarks motif={motif} />}</span><span className="cover-border" /><span className="cover-title">{record?.name ?? 'Slow\nmoments.'}</span><span className="case-spine" /></span>
  </span>;
}
/** 环境音的小标识：选了内置封面就画那张封面的主图形，否则用波浪纹。 */
function AmbientMark({ record }: { record?: RecordItem }) {
  const mark = record ? coverMarks[record.coverPreset ?? ''] : undefined;
  if (!mark) return <Waves size={13} />;
  return <svg className="ambient-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: mark }} />;
}
/** 无封面唱片的构图元素。每一款只放真正需要的形状，其余靠 CSS 画。
*/
function SleeveMarks({ motif }: { motif: SleeveMotif }) {
  if (motif === 'orbit') return <><span className="cover-orbit orbit-one" /><span className="cover-orbit orbit-two" /><span className="cover-orbit orbit-three" /><span className="cover-sun" /></>;
  if (motif === 'dawn') return <><span className="sleeve-glow" /><span className="sleeve-disc" /></>;
  if (motif === 'horizon') return <><span className="sleeve-sky" /><span className="sleeve-line" /><span className="sleeve-line second" /></>;
  if (motif === 'arch') return <span className="sleeve-gate" />;
  if (motif === 'ripple') return <><span className="ripple-ring r1" /><span className="ripple-ring r2" /><span className="ripple-ring r3" /><span className="ripple-ring r4" /></>;
  return <><span className="sleeve-band b1" /><span className="sleeve-band b2" /><span className="sleeve-band b3" /></>;
}
/**
 * 唱片柜里的一格。封面可以掀开，黑胶从里面滑出来——这是这个软件最早的招牌动作。
 * 列表视图只是另一种排法，两种视图共用同一份数据和同一套交互。
 */
// 唱片盒的开合是三态：'open' 钉住掀开、'closed' 钉住合上、undefined 交给鼠标悬停。
// 之所以要 'closed'，是因为刚合上时鼠标还停在卡片上，光去掉 'open' 会被 hover 立刻again掀开。
function RecordCard({ record, cover, art, selected, justAdded, order, flip, playing, onFocus, onSelect }: { record: RecordItem; cover?: string; art?: SleeveArt; selected: boolean; justAdded?: boolean; order: number; flip?: 'open' | 'closed'; playing: boolean; onFocus: () => void; onSelect: () => void }) {
  const mark = useRef<HTMLButtonElement>(null);
  // 加进队列的那一下：圆圈弹一下，外面荡开一圈淡环。
  // 用 WAAPI 而不是切 class——同名 CSS animation 在同一元素上重加不会重播，
  // 而用户连着点同一张是完全可能的。
  useEffect(() => {
    const node = mark.current;
    if (!justAdded || !node || typeof node.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    node.animate([
      { transform: 'scale(0.7)' },
      { transform: 'scale(1.16)', offset: 0.55 },
      { transform: 'scale(1)' },
    ], { duration: 420, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    const ring = document.createElement('span');
    ring.className = 'select-ring';
    node.append(ring);
    ring.animate([
      { transform: 'scale(0.7)', opacity: 0.34 },
      { transform: 'scale(2)', opacity: 0 },
    ], { duration: 460, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }).finished
      .then(() => ring.remove(), () => ring.remove());
  }, [justAdded]);
  return <li className={`record-card ${selected ? 'selected' : ''}`} data-flip={flip}>
    <button className="record-preview" onClick={onFocus} aria-label={`打开 ${record.name} 的唱片盒`}><Sleeve record={record} cover={cover} art={art} playing={playing} /></button>
    <p><button ref={mark} className={`select-record ${selected ? 'on' : ''}`} aria-pressed={selected} aria-label={`${selected ? '取消选择' : '选择'}${record.name}`} onClick={onSelect}>{selected ? (order > 0 && order <= 9 ? <RollNumber value={order} /> : <Check size={11} />) : null}</button><span className="record-name">{record.name}</span>{playing && <span className="playing-bars" aria-label="正在播放"><i /><i /><i /></span>}</p>
  </li>;
}
export default function App() {
  const [cabinet, setCabinet] = useState<Cabinet>(structuredClone(emptyCabinet));
  const cabinetRef = useRef(cabinet); cabinetRef.current = cabinet;
  const cabinetStorage = useRef(new CabinetStorage());
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<RoomStatus>(emptyStatus);
  const player = useRef<RoomPlayer | null>(null);
  const [view, setView] = useState<'cabinet' | 'listening' | 'focus'>('cabinet');
  const [filter, setFilter] = useState<CabinetFilter>('selected');
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
  // 外部音乐输入：开关一开就抓虚拟声卡，设备写死，不需要用户选
  const [lineError, setLineError] = useState('');
  const line = useRef(new LineIn());
  // 外部播放器正在放什么。只有开了外部音乐模式才去问系统，
  // 因为读它要起一个辅助进程，平时没必要。
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>(emptyNowPlaying);
  // 播放卡：点页签栏右边那颗圆碟，从屏幕底部升上来。
  // 位置交给 CSS（水平居中贴底），这里只管开关。
  const [cardOpen, setCardOpen] = useState(false);
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
  function selectView(next: 'cabinet' | 'listening' | 'focus', trigger?: HTMLElement) {
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
  const visible = cabinetRecords(cabinet, filter, query);
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
  const titleRecord = outgoing ?? current;
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
  const artFor = (record: RecordItem) => pickSleeve(record.id, launchSeed);
  const selected = (record: RecordItem) => (record.category === 'music' ? cabinet.queue : cabinet.ambience).includes(record.id);
  const isPlaying = (record: RecordItem) => status.running && (record.category === 'music' ? status.musicPlaying && status.currentId === record.id : status.playing && cabinet.ambience.includes(record.id));

  function commit(next: Cabinet) {
    try { cabinetStorage.current.save(next); cabinetRef.current = next; setCabinet(next); player.current?.update(next); }
    catch (error) { const reason = error instanceof CabinetWriteError ? error : new Error('设备存储空间不足，未保存这次修改。'); notify(message(reason)); throw reason; }
  }
  function change(changes: Partial<Cabinet>) { try { commit({ ...cabinetRef.current, ...changes }); } catch { /* notice already shown */ } }
  function goToPage(next: number) { setPage(clampPage(next, visible.length)); setFocusId(undefined); }
  function turnPage(direction: number) { goToPage(currentPage + direction); }
  // 导入后要翻到最后一页；这里重新算一遍过滤结果，避免用到本次渲染前的 visible。
  function jumpToLastPage() { setPage(pageCount(cabinetRecords(cabinetRef.current, importType, query).length) - 1); setFocusId(undefined); }
  function editRecord(id: string, changes: Partial<RecordItem>) { change({ records: cabinetRef.current.records.map(r => r.id === id ? { ...r, ...changes } : r) }); }
  /**
   * 开关外部音乐模式。
   * 开：先抓虚拟声卡，抓不到就整体不生效（免得界面进了外部模式却没声音）；
   * 关：断开流，回到本地唱片。
   */
  async function toggleLineMode(next: boolean) {
    setLineError('');
    if (!next) {
      line.current.close();
      player.current?.detachLineIn();
      change({ lineMode: false });
      return;
    }
    try {
      const stream = await line.current.open();
      player.current?.attachLineIn(stream);
      change({ lineMode: true });
      // 打开外部音乐模式就等于「要听了」：环境音必须同时起来。
      // 否则外部音乐在响、环境音静音，避让没有任何东西可以压，
      // 用户只会觉得「避让没生效」。
      player.current?.startAmbientOnly();
    } catch (error) {
      const text = lineInError(error);
      setLineError(text);
      notify(`接不上外部音乐：${text}。`);
    }
  }
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
  function previousTrack() {
    if (cabinet.lineMode) { if (hasTrack(nowPlaying)) commandNowPlaying('previous'); return; }
    player.current?.previous();
  }
  function nextTrack() {
    if (cabinet.lineMode) { if (hasTrack(nowPlaying)) commandNowPlaying('next'); return; }
    player.current?.next();
  }
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
        const saved = await storage.load(); if (!active) return;
        cabinetRef.current = saved; setCabinet(saved);
        player.current = new RoomPlayer(saved, state => { if (active) setStatus(state); }, error => { if (active) notify(message(error)); });
        setReady(true);
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
        // 上次开着外部音乐模式就自动接回来。抓不到就退回本地模式，不打扰启动。
        if (saved.lineMode) {
          try {
            const stream = await line.current.open();
            if (!active) { for (const track of stream.getTracks()) track.stop(); return; }
            player.current?.attachLineIn(stream);
            player.current?.startAmbientOnly();
          } catch (error) {
            // 虚拟声卡没装或没插，退回本地模式：界面不能停在「只有环境音」却收不到外部声音
            if (active) { change({ lineMode: false }); setLineError(lineInError(error)); }
          }
        }
      } catch (error) {
        // 读失败也不能把用户留在开屏上，界面本身还能用
        dismissSplash();
        if (active) notify(`本地收藏读取失败：${message(error)}。旧数据仍保留。`);
      }
    })();
    return () => { active = false; line.current.close(); player.current?.dispose(); player.current = null; window.clearTimeout(justAddedTimer.current); for (const url of urls.current.values()) URL.revokeObjectURL(url); urls.current.clear(); };
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
    const tick = () => { const left = Math.max(0, Math.ceil((sleepUntil - Date.now()) / 1000)); setRemaining(left); if (!left) { player.current?.pause(); setSleepUntil(0); notify('定时结束，晚安。'); } };
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [sleepUntil]);

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const all = [...(event.target.files ?? [])]; event.target.value = '';
    if (!all.length || busyRef.current) return;
    try { cabinetStorage.current.assertWritable(); } catch (error) { notify(message(error)); return; }
    busyRef.current = true;
    const files = all.filter(isAudioFile), errors: string[] = [];
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
          commit({ ...cabinetRef.current, records: [...cabinetRef.current.records, record] });
          if (record.coverId) await loadCover(record.id, record.coverId);
          known.add(record.fingerprint); added++; setFocusId(record.id);
          if (record.category === 'ambient' && !record.coverId && !record.coverPreset) unmatched++;
        } catch (error) { errors.push(message(error)); }
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
      const id = forCover ? `cover-${record!.id}` : 'background'; await storeAsset(id, blob);
      if (forCover) { editRecord(record!.id, { coverId: id, coverPreset: undefined, color }); await loadCover(record!.id, id); }
      else { const previous = urls.current.get('background'); if (previous) URL.revokeObjectURL(previous); const url = URL.createObjectURL(blob); urls.current.set('background', url); setBackground(url); change({ theme: color, imageName: file.name }); }
      notify(forCover ? '唱片换上了新的封面。' : '空间已染上这张照片的色彩。');
    } catch (error) { notify(message(error)); } finally { busyRef.current = false; setBusy(''); }
  }
  function openImport(type?: RecordType) { setReport([]); if (type) setImportType(type); setModal('import'); }
  function openEdit(record = focused) { if (!record) return; setFocusId(record.id); setDraft({ name: record.name, artist: record.artist, description: record.description }); setDraftError(''); setModal('edit'); }
  function chooseCover(cover: AmbientCover) { if (!focused) return; editRecord(focused.id, { coverId: undefined, coverPreset: cover.id, color: cover.color }); }
  function autoCover() {
    const cover = matchAmbientCover(draft.name);
    if (cover) { chooseCover(cover); notify(`已换成「${cover.name}」封面。`); }
    else notify('还没有匹配到，选一张你喜欢的封面吧。');
  }
  function takeOffShelf(record: RecordItem) {
    // Remove only the catalog entry; preserve the stored asset and source file.
    try { commit(removeRecord(cabinetRef.current, record.id)); setFocusId(undefined); setModal(null); notify('已从唱片柜移除，源文件不受影响。'); } catch { /* notice already shown */ }
  }
  async function clearBackground() { try { cabinetStorage.current.assertWritable(); await storeAsset('background'); const url = urls.current.get('background'); if (url) URL.revokeObjectURL(url); urls.current.delete('background'); setBackground(''); change({ theme: emptyCabinet.theme, imageName: '' }); } catch (error) { notify(message(error)); } }
  return <div className={`app ${background ? 'has-scenery' : ''}`} style={{ '--accent': cabinet.theme, '--scenery': background ? `url("${background}")` : 'none' } as CSSProperties}>
    <input ref={filesInput} type="file" multiple accept="audio/*,.flac,.ogg,.wav,.mp3,.m4a" className="hidden" aria-label="选择本地音频文件" onChange={importFiles} />
    <input ref={folderInput} type="file" multiple {...{ webkitdirectory: '', directory: '' }} className="hidden" aria-label="选择本地音频文件夹" onChange={importFiles} />
    <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="选择空间背景" onChange={e => void uploadPicture(e, false)} />
    <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="选择唱片封面" onChange={e => void uploadPicture(e, true)} />
    <div className="background-wash" /><div className="paper-grain" />
    <div className="portrait-shell">
      <header className="masthead"><a href="#" className="brand" onClick={e => { e.preventDefault(); setView('cabinet'); }}><Bird size={18} strokeWidth={1.3} /><span>RAVEN <i>ambient</i></span></a><div className="header-actions"><span className="local-status"><i />LOCAL ONLY</span><button className="icon-button" aria-label="使用说明" onClick={() => setModal('guide')}><Info size={16} /></button><button className="icon-button" aria-label="空间设置" onClick={() => setModal('settings')}><Settings2 size={17} /></button></div></header>
      <section className="today-head"><div className="today-row"><h1 key={view} className="today-title">{view === 'cabinet' ? 'Cabinet' : view === 'listening' ? 'Listening' : 'Focus'}</h1><div className="today-stamp"><span>{todayStamp}</span><i /><span className="today-count"><RollNumber value={view === 'cabinet' ? cabinet.records.length : view === 'listening' ? selectedCount : Math.round(status.running ? 1 : 0)} minDigits={2} /></span></div></div></section>
      <nav ref={viewLayout.navigationRef} className="view-tabs" aria-label="空间导航"><span className="nav-marker" aria-hidden="true" /><button className={view === 'cabinet' ? 'active' : ''} onClick={event => selectView('cabinet', event.currentTarget)} aria-label="唱片柜"><Disc3 size={15} /><span className="tab-label">唱片柜</span><small>{String(cabinet.records.length).padStart(2, '0')}</small></button><button className={view === 'listening' ? 'active' : ''} onClick={event => selectView('listening', event.currentTarget)} aria-label="正在听"><Headphones size={15} /><span className="tab-label">正在听</span>{selectedCount > 0 && <span className="tab-dot" />}</button><button className={view === 'focus' ? 'active' : ''} onClick={event => selectView('focus', event.currentTarget)} aria-label="专注"><Timer size={15} /><span className="tab-label">专注</span></button><span className="dock-disc-slot"><button className={`dock-disc ${playingNow ? 'playing' : ''}`} aria-label={playingNow ? '打开播放器（正在播放）' : '打开播放器'} aria-expanded={cardOpen} onClick={openCard} style={discCover ? { backgroundImage: `url("${discCover}")` } as CSSProperties : undefined}>{!discCover && <Disc3 size={17} strokeWidth={1.4} />}{sleepUntil > 0 && <i className="dock-disc-sleep" title={`${formatTime(remaining)} 后休息`} />}</button></span></nav>
      <div ref={viewLayout.stageRef} className="view-stage" data-motion={pageMotion.phase} data-view={pageMotion.value} inert={pageMotion.phase === 'exit'} style={{ '--page-direction': pageMotion.direction, '--wipe-x': `${wipe.x}px`, '--wipe-y': `${wipe.y}px`, '--wipe-r': `${wipe.r}px` } as CSSProperties}>
      <div ref={viewLayout.contentRef} className="view-content">
      {pageMotion.value === 'cabinet' ? <>
        <div className="collection-toolbar"><div ref={filterTabsRef} className="filter-tabs" role="group" aria-label="唱片分类"><span className="flip-marker" aria-hidden="true" />{(cabinet.lineMode ? (['selected', 'ambient'] as const) : (['selected', 'music', 'ambient'] as const)).map(type => <button key={type} aria-pressed={filter === type} className={filter === type ? 'active' : ''} onClick={event => selectFilter(type, event.currentTarget)}>{type === 'selected' ? '已选择' : type === 'music' ? '音乐' : '环境音'}</button>)}</div><label className="search"><Search size={13} /><input aria-label="搜索唱片" placeholder="寻找一张唱片" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
        <div ref={shelfRef} className={`cabinet-layout ${!cabinet.records.length ? 'empty-cabinet-layout' : ''}`} data-motion={filterMotion.phase} style={{ '--wipe-x': `${shelfWipe.x}px`, '--wipe-y': `${shelfWipe.y}px`, '--wipe-r': `${shelfWipe.r}px` } as CSSProperties}>
          <section className="cabinet" aria-label="我的唱片柜"><div className="cabinet-corners"><i /><i /><i /><i /></div>
            {!cabinet.records.length ? <div className="empty-cabinet"><div className="empty-art"><Sleeve playing={false} preview /></div><span className="shelf-line" /><div className="empty-copy"><h2>唱片柜还是空的</h2><button className="primary-button" disabled={!ready || !!busy} onClick={() => openImport()}><Plus size={14} />放入第一张唱片</button></div></div> : <>
              <div className="shelf-label"><span>{filter === 'music' ? '此刻的声音' : filter === 'ambient' ? '此刻的环境音' : '此刻的声音'}</span><span><RollNumber value={visible.length} minDigits={2} /></span></div>

              <ul className="record-grid">{shown.map(record => <RecordCard key={record.id} record={record} cover={coverFor(record)} art={artFor(record)} selected={selected(record)} justAdded={justAdded?.id === record.id} order={cabinet.queue.indexOf(record.id) + 1} flip={flip?.id === record.id ? (flip.open ? 'open' : 'closed') : undefined} playing={isPlaying(record)} onFocus={() => { if (!modal) toggleFlip(record.id); }} onSelect={() => choose(record)} />)}</ul>
              {pages > 1 && <nav className="shelf-pager" aria-label="唱片分页">
                <button className="pager-arrow" aria-label="上一页" disabled={currentPage === 0} onClick={() => turnPage(-1)}><ChevronLeft size={13} /></button>
                <div className="pager-numbers">{Array.from({ length: pages }, (_, index) => <button key={index} className={index === currentPage ? 'active' : ''} aria-label={`第 ${index + 1} 页`} aria-current={index === currentPage ? 'page' : undefined} onClick={() => goToPage(index)}>{String(index + 1).padStart(2, '0')}</button>)}</div>
                <button className="pager-arrow" aria-label="下一页" disabled={currentPage === pages - 1} onClick={() => turnPage(1)}><ChevronRight size={13} /></button>
              </nav>}
              {!visible.length && <div className="no-results"><Disc3 size={28} /><p>{query ? '还没有找到这张唱片。' : filter === 'selected' ? '把喜欢的声音，加入此刻。' : '这一格，等一个新的声音。'}</p>{filter === 'selected' && !query ? <><small>在音乐和环境音中点击 ＋，就会出现在这里。</small><div className="selection-links"><button className="text-button" onClick={() => setFilter('music')}>挑选音乐<ArrowRight size={12} /></button><button className="text-button" onClick={() => setFilter('ambient')}>挑选环境音 <ArrowRight size={12} /></button></div></> : <button className="text-button" onClick={() => openImport(filter === 'ambient' ? 'ambient' : 'music')}>收藏本地音频 <Plus size={12} /></button>}</div>}
              <button className="add-to-shelf" disabled={!!busy} onClick={() => openImport(filter === 'ambient' ? 'ambient' : 'music')}><Plus size={15} /><span>再收藏一个声音</span></button>
            </>}
            <div className="cabinet-base"><span>R / A</span><span>HANDLE WITH FEELING.</span><i /></div>
          </section>
          <aside className="record-notes" aria-label="唱片介绍">{focused ? <>
            <div className="notes-disc"><Vinyl record={focused} color={focused.color} cover={coverFor(focused)} spinning={isPlaying(focused)} /></div><div className="record-type">{focused.category === 'music' ? 'SIDE A — 音乐' : 'SIDE B — 环境音'}</div><h2>{focused.name}</h2><p className="artist">{focused.artist}</p><div className="fine-rule" /><p className="record-description">{focused.description || '有些声音不必解释。\n也可以为它写下一段，\n只属于你的介绍。'}</p><button className="text-button edit-notes" onClick={() => openEdit()}>编辑介绍与封面<ArrowRight size={12} /></button><dl className="record-meta"><div><dt>时长</dt><dd>{focused.duration ? formatTime(focused.duration) : '—'}</dd></div><div><dt>格式</dt><dd>{focused.format}</dd></div><div><dt>播放</dt><dd>{focused.category === 'music' ? '顺序播放' : '循环叠加'}</dd></div></dl><button className={`notes-select ${selected(focused) ? 'chosen' : ''}`} onClick={() => choose(focused)}>{selected(focused) ? <Check size={13} /> : <Plus size={13} />}{selected(focused) ? '已加入此刻' : '加入此刻'}</button><Slider label="唱片音量" max={100} value={focused.volume} onChange={volume => editRecord(focused.id, { volume })} />{focused.category === 'ambient' && <details className="sound-tweaks"><summary>声音微调 <Settings2 size={12} /></summary><Slider label="左右位置" min={-100} value={focused.pan} unit="" onChange={pan => editRecord(focused.id, { pan })} /><Slider label="柔和程度" value={focused.warmth} onChange={warmth => editRecord(focused.id, { warmth })} /><Slider label="避让幅度" max={depthRange.max} value={focused.duckDepth} unit=" dB" onChange={duckDepth => editRecord(focused.id, { duckDepth })} /><p className="tweak-help">{focused.duckDepth === 0 ? '这张唱片保持原音量，不随音乐变轻。' : `音乐响起时，这张唱片让出 ${focused.duckDepth} dB，${describeDepth(focused.duckDepth)}。`}</p></details>}
          </> : <div className="empty-notes"><Sparkles size={25} strokeWidth={1} /><p>点开一张唱片，<br />它的介绍会出现在这里。</p></div>}</aside>
        </div>
      </> : pageMotion.value === 'listening' ? <section className="listening-room"><div className={`turntable ${status.running ? 'is-playing' : ''}`}><div className="platter">{externalDisc ? <div className="platter-disc disc-swap" key={`ext:${externalDisc.info.app}:${externalDisc.info.title}`}><RecordPlayer disc={externalDisc} spinning={status.running && nowPlaying.playing} /></div> : shownOutgoing ? <div className="platter-disc disc-leaving" key={`out:${shownOutgoing.id}`}><RecordPlayer disc={{ kind: 'local', record: shownOutgoing }} cover={coverFor(shownOutgoing)} spinning={status.running && status.musicPlaying} leaving /></div> : (current ?? focused) ? <div className="platter-disc disc-swap" key={`in:${(current ?? focused)!.id}`}><RecordPlayer disc={{ kind: 'local', record: (current ?? focused)! }} cover={coverFor((current ?? focused)!)} spinning={status.running && status.musicPlaying} /></div> : <div className="platter-disc disc-swap" key="empty" />}</div><div className="tonearm"><span /><i /></div><span className={`power-light ${status.running ? 'on' : ''}`} /><span className="rpm">33 ⅓<br /><small>STEREO</small></span></div><div className="playing-title" key={externalDisc ? `ext:${externalDisc.info.app}:${externalDisc.info.title}` : titleRecord?.id ?? 'empty'}><span>{externalDisc ? `${appLabel(externalDisc.info.app)}${playbackHint(externalDisc.info) ? ' · ' + playbackHint(externalDisc.info) : ''}` : status.running ? '正在播放' : '待机'}</span><h2>{externalDisc ? externalDisc.info.title : titleRecord?.name ?? (cabinet.ambience.length ? '环境音的合奏' : '等待一张喜欢的唱片')}</h2></div>{cabinet.lineMode ? <><div className="queue-heading"><h3>正在流动的环境音</h3><span>{cabinet.ambience.length} / 8 · 一起循环</span></div><MusicQueue variant="ambient" queue={cabinet.ambience} records={cabinet.records} muted={cabinet.muted} onToggle={toggleAmbience} onPlay={() => undefined} onRemove={choose} onReorder={ambience => change({ ambience })} />{!cabinet.ambience.length && <p className="queue-empty">外部音乐已经在响了，再选几张环境音，让它有地方落脚。</p>}<p className="line-mode-hint">音乐来自外部播放器，{status.ducked ? '正在为你让路。' : '这里只负责环境音。'}</p></> : <><div className="queue-heading"><h3>接下来听什么</h3><span>{cabinet.queue.length} 张音乐 · {orderNames[cabinet.order]}</span></div><MusicQueue queue={cabinet.queue} records={cabinet.records} currentId={status.currentId} onPlay={id => player.current?.playRecord(id)} onRemove={choose} onReorder={queue => change({ queue })} />{!cabinet.queue.length && <p className="queue-empty">还没有音乐唱片，纯粹的环境音也很好听。</p>}<div className="queue-heading"><h3>一起流动的环境音</h3><span>{cabinet.ambience.length} / 8</span></div><div className="ambient-chips">{cabinet.ambience.map(id => { const record = cabinet.records.find(r => r.id === id)!; return <button key={id} onClick={() => choose(record)}><AmbientMark record={record} />{record.name}<X size={12} /></button>; })}{!cabinet.ambience.length && <p className="queue-empty">从唱片柜选几张环境音，给音乐添一点风景。</p>}</div></>}<button className="text-button back-cabinet" onClick={() => setView('cabinet')}><ArrowLeft size={13} />回唱片柜，再挑一张</button></section> : null}
      <div hidden={pageMotion.value !== 'focus'}><FocusRoom active={view === 'focus' && pageMotion.value === 'focus' && pageMotion.phase !== 'exit'} playing={status.running} hasSelection={selectedCount > 0} onPlaySelection={() => player.current?.start()} onNotice={notify} disc={miniDiscSource} onPrev={previousTrack} onNext={nextTrack} canSkip={canSkipDisc} /></div>
      </div>
      </div>
    </div>
      <PlayCard open={cardOpen} playing={playingNow} title={discTitle} subtitle={discSubtitle} cover={discCover} time={formatTime(status.currentTime)} duration={formatTime(status.duration)} timeValue={status.currentTime} durationValue={status.duration} level={levelTick} musicOn={status.running && status.musicOn} ambientOn={status.running && status.ambientOn} musicReady={!!cabinet.queue.length} lineMode={cabinet.lineMode} order={cabinet.order} master={cabinet.master} onClose={() => setCardOpen(false)} onToggle={togglePlay} onPrev={previousTrack} onNext={nextTrack} onSeek={value => { if (cabinet.lineMode) return; player.current?.seek(value * (status.duration || 0)); }} onToggleMusic={() => player.current?.toggleMusic()} onToggleAmbient={() => player.current?.toggleAmbient()} onOrder={() => change({ order: nextOrder(cabinet.order) })} onMaster={value => change({ master: value })} />
      <dialog ref={modalRef} className="modal" data-motion={dialogMotion.phase} aria-label="空间窗口" onClick={e => { if (e.target === modalRef.current && !busy) setModal(null); }}><div className="modal-content" inert={dialogMotion.phase === 'exit'}><button className="modal-close icon-button" aria-label="关闭窗口" disabled={!!busy} onClick={() => setModal(null)}><X size={18} /></button>
      {shownModal === 'import' && <><h2>收藏声音</h2><div className="import-types"><button className={importType === 'music' ? 'selected' : ''} disabled={!!busy} onClick={() => setImportType('music')}><Music2 size={22} /><strong>音乐唱片</strong><small>多选后，按顺序播放</small>{importType === 'music' && <Check size={12} />}</button><button className={importType === 'ambient' ? 'selected' : ''} disabled={!!busy} onClick={() => setImportType('ambient')}><Waves size={22} /><strong>环境音唱片</strong><small>多路循环，一起流动</small>{importType === 'ambient' && <Check size={12} />}</button></div><button className="primary-button full-width" disabled={!!busy || !ready} onClick={() => filesInput.current?.click()}>{busy ? <LoaderCircle size={15} className="loading-spin" /> : <ArrowDownToLine size={15} />}{busy || '选择本地音频'}</button><button className="secondary-button full-width" disabled={!!busy || !ready} onClick={() => folderInput.current?.click()}><FolderOpen size={15} />导入整个文件夹</button><p className="import-help">{importType === 'ambient' ? '单张不超过 50 MB / 10 分钟，最多叠加 8 路。' : '单张不超过 200 MB，支持 MP3、WAV、FLAC。'}<br />重复文件会自动跳过。</p>{report.length > 0 && <div role="alert" className="import-report"><strong>这些文件暂时没有收藏成功</strong>{report.map((error, index) => <p key={index}>{error}</p>)}</div>}</>}
      {shownModal === 'edit' && focused && <><h2>编辑唱片</h2><form onSubmit={e => {
        e.preventDefault();
        const name = draft.name.trim();
        if (!name) {
          setDraftError('给这张唱片留一个名字。');
          // 抖动用 element.animate()：每次调用都是独立动画，连续提交失败也能重播
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            nameInputRef.current?.animate(
              [
                { transform: 'translateX(0)' },
                { transform: 'translateX(-4px)' },
                { transform: 'translateX(3px)' },
                { transform: 'translateX(-2px)' },
                { transform: 'translateX(0)' },
              ],
              { duration: 320, easing: 'cubic-bezier(.2,.7,.3,1)' },
            );
          }
          nameInputRef.current?.focus();
          return;
        }
        setDraftError('');
        editRecord(focused.id, { ...draft, name });
        setModal(null);
      }} noValidate><label className="text-field" data-invalid={draftError ? 'true' : undefined}>唱片名称<input ref={nameInputRef} value={draft.name} maxLength={100} required aria-invalid={draftError ? true : undefined} aria-describedby={draftError ? 'record-name-error' : undefined} onChange={e => { setDraft(d => ({ ...d, name: e.target.value })); if (draftError) setDraftError(''); }} />{draftError && <span className="field-error" id="record-name-error" role="alert">{draftError}</span>}</label><label className="text-field">作者<input value={draft.artist} maxLength={100} onChange={e => setDraft(d => ({ ...d, artist: e.target.value }))} /></label><label className="text-field">一段介绍<textarea placeholder="它让你想起了什么？" value={draft.description} maxLength={500} rows={4} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} /></label>{focused.category === 'ambient' && <section className="cover-library" aria-label="环境音封面库"><div className="cover-library-heading"><h3>本地封面库</h3><span>{ambientCovers.length} 款声音小景</span></div><p>点选即可换上封面，也可以上传自己的图片。</p><div className="cover-options">{ambientCovers.map(cover => <button type="button" key={cover.id} className={focused.coverPreset === cover.id ? 'chosen' : ''} aria-label={"使用" + cover.name + "封面"} aria-pressed={focused.coverPreset === cover.id} disabled={!!busy} onClick={() => chooseCover(cover)}><img src={ambientCoverUrl(cover.id)} alt="" loading="lazy" /><span>{cover.name}</span>{focused.coverPreset === cover.id && <Check size={12} />}</button>)}</div><button type="button" className="text-button" disabled={!!busy} onClick={autoCover}><Sparkles size={12} />按唱片名称重新匹配</button></section>}<button type="button" className="secondary-button full-width" disabled={!!busy} onClick={() => coverInput.current?.click()}><ImagePlus size={15} />{busy || '上传自己的封面'}</button><button type="submit" className="primary-button full-width" disabled={!!busy}><CheckCheck size={15} />保存介绍</button></form><button className="text-button remove-record" onClick={() => takeOffShelf(focused)}><Trash2 size={12} />从唱片柜移除</button></>}
      {shownModal === 'settings' && <><h2>设置</h2><div className="settings-group"><h3>空间的颜色</h3><button className="secondary-button full-width" disabled={!!busy} onClick={() => imageInput.current?.click()}><ImagePlus size={15} />{busy || '选择背景照片'}</button>{background && <button className="text-button" onClick={() => void clearBackground()}><RotateCcw size={12} />恢复默认背景</button>}</div><div className="settings-group"><h3>声音的分寸</h3><Slider label="音乐总音量" value={cabinet.musicVolume} onChange={musicVolume => change({ musicVolume })} /></div><div className="settings-group"><h3>外部音乐</h3><p>把播放器的输出切到 CABLE Input，再打开下面的开关。<span>外部音乐会在响起时压低环境音。</span></p><label className="line-mode-toggle"><input type="checkbox" checked={cabinet.lineMode} onChange={e => void toggleLineMode(e.target.checked)} /><span className="line-mode-switch" aria-hidden="true" /><span className="line-mode-copy"><b>外部音乐模式</b><small>{cabinet.lineMode ? '音乐来自外部播放器，这里只留环境音' : '关着的时候播放本地唱片'}</small></span></label>{cabinet.lineMode && <div className="line-in-meter" aria-label="外部音乐电平"><span style={{ '--level': `${Math.round(status.lineInput * 100)}%` } as CSSProperties} /><small>{status.lineInput > 0.02 ? (status.ducked ? '收到外部音乐 · 环境音正在退让' : '收到外部音乐 · 环境音没有退让') : '已接上虚拟声卡，等待声音'}</small></div>}{cabinet.lineMode && <label className="line-volume"><span>外部音乐音量</span><input type="range" min={0} max={100} value={cabinet.lineVolume} aria-label="外部音乐音量" onChange={e => change({ lineVolume: Number(e.target.value) })} style={{ '--fill': `${cabinet.lineVolume}%` } as CSSProperties} /><small>{cabinet.lineVolume}%</small></label>}{lineError && <p className="line-in-error" role="alert">{lineError}</p>}</div><div className="settings-group"><h3>换唱片的方式</h3><div className="transition-options" role="radiogroup" aria-label="换唱片的方式">{trackTransitions.map(value => <button key={value} type="button" role="radio" aria-checked={cabinet.transition === value} className={cabinet.transition === value ? 'selected' : ''} onClick={() => change({ transition: value })}><strong>{transitionNames[value]}</strong><small>{transitionHints[value]}</small></button>)}</div></div><div className="settings-group"><h3>定时休息</h3><label className="sleep-select">在这之后停止全部声音<select aria-label="定时休息" value={sleepUntil ? 'active' : '0'} onChange={e => setSleepUntil(Number(e.target.value) ? Date.now() + Number(e.target.value) * 60000 : 0)}>{sleepUntil > 0 && <option value="active">剩余 {formatTime(remaining)}</option>}<option value="0">不设定时</option><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="60">60 分钟</option><option value="90">90 分钟</option></select></label></div><p className="import-help">你的音频、封面和介绍仅保存在这台设备。<br />Raven Ambient Bold · 0.3.2</p></>}
      {shownModal === 'guide' && <><h2>使用说明</h2><div className="guide-steps"><p><span>01</span><strong>收藏</strong>音频文件或整个文件夹，音乐与环境音分开收。</p><p><span>02</span><strong>打开唱片盒</strong>鼠标停留或点一下，看介绍。</p><p><span>03</span><strong>加入此刻</strong>点 ＋ 选择。数字是播放顺序，环境音同时循环。</p><p><span>04</span><strong>微调</strong>「正在听」里改顺序，环境音的「声音微调」调避让幅度。</p></div><button className="primary-button full-width" onClick={() => setModal(null)}>知道了<ArrowRight size={14} /></button></>}
    </div></dialog>
    <MotionNotice message={notice} onClose={() => setNotice('')} />
  </div>;
}
