// 放映：一块常驻的播放台 + 下面的格子。
//
// 点格子不会弹窗，而是把那一件换到上面的播放台里——放映是「一直看着」的动作，
// 弹层会打断这件事，而且弹层里能做的（暂停、换下一件）在播放台上都能做。
//
// 视频缩略图不能用 Wallpaper Engine 的 preview.jpg：那个是正方形缩略图
// （实测 178 件里 1024×1024 / 192×192 / 224×224 各种正方形），跟壁纸本身的比例无关，
// 摆进 4:3 的格子里会被裁掉两边，而且分辨率低。所以直接挂 <video> 读自己的第一帧。
// 一屏最多也就九件，配合视口懒加载不会同时开一百多个文件句柄。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Droplets, FilePlus2, FolderOpen, ImageIcon, Maximize2, Minimize2, MonitorPlay, Pause, Play, RefreshCw, Sparkles, X, Palette
} from 'lucide-react';
import { mediaSrc, setDesktopStage, setWindowFullscreen } from './media';
import { afterResize as afterResizeWait, canToggle } from './fullscreen-timing';
import { listenStageClosed, listenStageCommand, publishStage, type StageSnapshot } from './desktop-bridge';
import TemplateStage, { type StageAmbience, type StageDisc, type StageFocus, type StageNow } from './TemplateStage';
import { defaultTone, normaliseHex, readTone, toneGroups, toneHint, toneKey, writeTone, type ToneSetting } from './tone-setting';
import { nextStoneStyle } from './marble.ts';
import LayerStack from './LayerStack';
import RainLayer from './RainLayer';
import TheaterLayers from './TheaterLayers';
import { layersKey, legacyOverlaysKey, legacyWidgetsKey, readLayers, writeLayers, type LayerList } from './layers';
import { rainKey, rainModes, readRain, writeRain, type RainSetting } from './rain';
import { readFocus } from './focus-bridge';
import { templates, type TemplateId } from './templates';
import type { MediaItem } from './records';

type Props = {
  items: MediaItem[];
  dirs: string[];
  /** 这一页现在是不是显示着。隐藏时不挂视频，免得几百个 <video> 同时去读文件头。 */
  active: boolean;
  /** 「从本地添加」：选文件夹还是选文件，由弹出来的菜单决定。 */
  onPick: () => void;
  /** 挑单个文件。整目录加入是另一条路——那个会把整棵树扫进来。 */
  onPickFiles: () => void;
  onRescan: (dir: string) => void;
  onForgetDir: (dir: string) => void;
  onScanWallpapers: () => void;
  /** 把壁纸库读进来的那批清掉。自己加的文件夹和单独导入的文件不受影响。 */
  onForgetWallpapers: () => void;
  /** 「正在听」的那张碟，拼贴版右下角画的就是它。 */
  disc: StageDisc | null;
  /** 此刻的环境音状况，拼贴版面板上半画的是它。没在叠环境音时为 null。 */
  ambience: StageAmbience | null;
  /** 此刻真正在响的那一首，拼贴版信息条 PLAYLIST 写的是它。 */
  now: StageNow;
  /**
   * 在唱片上左右滑动切歌。undefined 表示现在切不了（库空、只有一首、
   * 或外部播放器那边没有上一首），那种情况下唱片不接指针。
   */
  onPrevTrack?: () => void;
  onNextTrack?: () => void;
};

/**
 * 库空着时台面上用的占位画面。
 *
 * 不用真图片：那张图要么得随包发一个资源，要么得内联一段 base64，
 * 两条路都让「只是想看看版式长什么样」变成一件有成本的事。
 * 交给 CSS 画一块渐变就够了（见 .tpl-blank）。
 */
const BLANK_ITEM: MediaItem = { id: 'blank', kind: 'image', path: '', name: '', size: 0 };

/** 「从本地添加」弹出来的两个选项。 */
const ADD_CHOICES = [
  { key: 'folder' as const, label: '选一个文件夹', hint: '把这个文件夹里的图片和视频都收进来', icon: FolderOpen },
  { key: 'file' as const, label: '选几张文件', hint: '只收点中的这几件，不动别处', icon: FilePlus2 },
];

/** 文件名去掉扩展名，当标题用。壁纸库的条目标题本来就没有扩展名。 */
function stem(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 摆出来给人看的标题：普通文件去扩展名，壁纸条目用作品名。 */
function titleOf(item: MediaItem) {
  return item.source ? item.name : stem(item.name);
}

function sizeOf(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 视频封面：读元数据之后往后跳一点再画。
 *
 * 只写 preload="metadata" 的话 Chromium 只拿到时长和尺寸，不解第一帧，
 * 格子里就是一块黑。显式 seek 到 0.1 秒才会真的解码出一张画面。
 * 太短的片子退到中点，免得 0.1 秒已经越过末尾。
 */
function VideoThumb({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const seek = () => {
      const span = Number.isFinite(video.duration) ? video.duration : 0;
      const at = span > 0.3 ? 0.1 : span / 2;
      try { video.currentTime = Math.max(0, at); } catch { /* 还没到可以 seek 的状态，等下一次事件 */ }
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [src]);
  return <video ref={ref} src={src} aria-label={alt} preload="metadata" muted playsInline />;
}

export default function MediaRoom({ items, dirs, active, onPick, onPickFiles, onRescan, onForgetDir, onScanWallpapers, onForgetWallpapers, disc, ambience, now, onPrevTrack, onNextTrack }: Props) {
  // 只有图片和视频两档，不再有「全部」。
  // 混在一起看意义不大：两种东西的缩略图行为不同（一张解码、一段读首帧），
  // 而且用户来这儿通常心里已经知道要看哪一种。
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [currentId, setCurrentId] = useState('');
  const [playing, setPlaying] = useState(true);
  // 放映的排版。默认「拼贴」——那是用户自己视频里的样子。
  // 存本地而不是存进收藏：这是看的偏好，不该触发一次写盘。
  // 配色：默认跟画面走。用户可以在这三层里选，设置存 localStorage。
  const [tone, setTone] = useState<ToneSetting>(() => readTone(localStorage.getItem(toneKey)));
  const [toneMenu, setToneMenu] = useState(false);
  // 点胶囊换下一种石纹。顺序与文案都在 marble.ts 的 stoneStyles 里，
  // 这里只负责把「下一个」写回设置——组件不该知道一共有几种。
  const cycleStone = useCallback(() => {
    setTone(prev => ({ ...prev, stone: nextStoneStyle(prev.stone) }));
  }, []);
  // TemplateStage 取到的原始色板，配色面板用它画「从这里挑」的色块。
  const [palette, setPalette] = useState<string[]>([]);
  const [template, setTemplate] = useState<TemplateId>(() => {
    const saved = localStorage.getItem('raven-stage-template');
    return templates.some(item => item.id === saved) ? (saved as TemplateId) : 'collage';
  });
  useEffect(() => { localStorage.setItem('raven-stage-template', template); }, [template]);
  useEffect(() => { writeTone(tone); }, [tone]);
  // 「从本地添加」的下拉开着没有。Windows 的原生对话框没法同时当文件和文件夹选择器
  // （Electron 文档明说会退化成只能选目录），所以只能让用户先在这里挑一种。
  const [adding, setAdding] = useState(false);
  // 全屏：播放台铺满整个窗口，其余全部让开。
  // 放映本来就是「一直看着」的动作，窗口框和格子在这时候都是干扰。
  const [expanded, setExpanded] = useState(false);
  // 上一次切换全屏的时刻（performance.now）。只用来挡住系统过渡期间的连点。
  // 初值必须是 -Infinity 不能是 0：页面刚起来时 performance.now() 也很小，
  // 拿 0 当「没点过」的哨兵会把第一次点击挡掉。
  const expandedLockRef = useRef(-Infinity);
  // 全屏时控制条自动隐藏。鼠标不动两秒多就淡出，动一下立刻回来。
  // 不做成「鼠标不在控制条上就隐藏」——全屏看电影时鼠标往往停在画面正中不动，
  // 那条黑带会一直压在画面底下。
  const [chrome, setChrome] = useState(true);
  // 图层（时间/日期/标题/番茄钟/唱片/曲目）。位置是用户拖出来的，存 localStorage
  // 而不是收藏——这是「怎么看」的偏好，不该触发一次写盘。
  //
  // 以前这里是两份（叠加元素 + 组件），用户 m12005 问能不能一套——能，
  // 所以现在只有 `layers` 一份，四个版式共用。皮肤差别在渲染层（LayerStack），
  // 存档差别在两份旧键的搬家（readLayers 的第三、四个参数）。
  const [layers, setLayers] = useState<LayerList>(() =>
    readLayers(
      localStorage.getItem(layersKey),
      localStorage.getItem(legacyOverlaysKey),
      localStorage.getItem(legacyWidgetsKey),
    ),
  );
  // 「叠加元素」与「加组件」合并成一颗按钮：外观一样，菜单内容跟着版式走。
  // 为什么不再各留一个开关：合并之后只剩一个菜单，两个 state 一定会有一个忘了同步。
  const [layersMenu, setLayersMenu] = useState(false);
  // 雨层。和图层一样存 localStorage——这是「怎么看」的偏好，不该写盘。
  const [rain, setRain] = useState<RainSetting>(() => readRain(localStorage.getItem(rainKey)));
  const [rainMenu, setRainMenu] = useState(false);
  useEffect(() => { writeRain(rain); }, [rain]);
  // 番茄钟读数：跟着专注页走，自己不另起计时器（两处各算各的，暂停一次就对不上）。
  // 800ms 一刷就够——叠加上只显示到分:秒。
  // 除了剩余毫秒，还留一份完整快照：拼贴版信息条那一格要显示阶段和轮次，
  // 只拿一个数字不够。两者同一次 tick 里一起更新，不会出现一半新一半旧。
  const [focusLeft, setFocusLeft] = useState<number | null>(null);
  const [focusStage, setFocusStage] = useState<StageFocus | null>(null);
  // 桌面放映窗开着没有。窗口真正的存亡在主进程，这里只跟它对齐一下按钮状态。
  const [onDesktop, setOnDesktop] = useState(false);
  useEffect(() => {
    const tick = () => {
      const snapshot = readFocus();
      const shown = snapshot && snapshot.visible ? snapshot : null;
      setFocusLeft(shown ? shown.remaining : null);
      setFocusStage(
        shown
          ? {
              phase: shown.phase,
              remaining: shown.remaining,
              left: shown.total > 0 ? Math.min(1, Math.max(0, shown.remaining / shown.total)) : 0,
              rounds: shown.rounds,
              roundsBeforeLong: shown.roundsBeforeLong,
            }
          : null,
      );
    };
    tick();
    const timer = window.setInterval(tick, 800);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { writeLayers(layers); }, [layers]);
  const screen = useRef<HTMLVideoElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  // 已经进过视口的条目。壁纸库一次能读进来一百多件，每个视频都要读文件头、
  // 每个封面都要解一张帧；同时挂上会卡住渲染进程（实测 178 件直接把窗口拖到无响应）。
  // 所以只给滚到眼前的那批挂真实元素，其余先留空。
  const [seen, setSeen] = useState<Set<string>>(() => new Set());

  // 带 note 的是场景壁纸（它的 preview 图）。放映只放图片和视频，
  // 这类条目即使还留在旧收藏里也不再摆出来。
  const usable = useMemo(() => items.filter(item => !item.note), [items]);
  const shown = useMemo(() => usable.filter(item => item.kind === kind), [usable, kind]);
  const images = usable.filter(item => item.kind === 'image').length;
  const videos = usable.length - images;
  // 壁纸条目带 source。从条目自己数，而不是用「这次启动读到几件」——
  // 那个数字只在点过「读取壁纸库」之后才有，重启后归零，来源 chip 会凭空消失。
  const fromWallpaper = useMemo(() => usable.filter(item => !!item.source).length, [usable]);

  // 播放台上的那一件。**从全部条目里找，不在筛选结果里找**——
  // 播放台是独立的：用户在下面切到「视频」只是换一种看法，
  // 不该把正在放的那张图从台子上拽下来。
  // 条目被删掉（移出来源、重扫之后文件没了）就退回第一件，
  // 不能留着一个指向不存在条目的 id，否则播放台会空着而格子里明明有东西。
  const current = useMemo(() => usable.find(item => item.id === currentId) ?? usable[0], [usable, currentId]);

  // 上一件 / 下一件也走全部条目，跟着筛选走会让「下一件」变成换个类别。
  const step = useCallback((direction: number) => {
    if (!usable.length) return;
    const index = current ? usable.findIndex(item => item.id === current.id) : 0;
    const next = (index + direction + usable.length) % usable.length;
    setCurrentId(usable[next].id);
    setPlaying(true);
  }, [usable, current]);

  // 换到视频时开始播，换到图片时不需要。循环交给 <video loop>，它自己会接上。
  useEffect(() => {
    const video = screen.current;
    if (!video) return;
    if (playing) video.play().catch(() => setPlaying(false));
    else video.pause();
  }, [playing, current?.id]);

  // 用 IntersectionObserver 记下「露过面」的 id，露过一次就不再收回去——
  // 往回滚的时候不该重新白屏一次。
  useEffect(() => {
    const host = grid.current;
    if (!host || !active) return;
    const observer = new IntersectionObserver(entries => {
      const fresh = entries.filter(entry => entry.isIntersecting).map(entry => (entry.target as HTMLElement).dataset.id ?? '').filter(Boolean);
      if (!fresh.length) return;
      setSeen(next => {
        if (fresh.every(id => next.has(id))) return next;
        return new Set([...next, ...fresh]);
      });
    }, { rootMargin: '280px 0px' });
    for (const node of host.querySelectorAll('[data-id]')) observer.observe(node);
    return () => observer.disconnect();
  }, [shown, active]);

  // 空格：播放台上是视频时切换播放。正在听和专注页也用空格，所以只在这一页接管。
  useEffect(() => {
    if (!active || !current || current.kind !== 'video') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      event.preventDefault();
      setPlaying(value => !value);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, current]);

  // 等窗口内容区真的开始变尺寸后再执行，最多等 250ms（兜底见 fullscreen-timing.ts）。
  //
  // 为什么不能直接铺满：Windows 进/出真全屏是渐变的，页面这边立刻挂
  // `.is-expanded` 会先把播放台撑满**旧窗口**，几十毫秒后窗口才变大——
  // 用户看到的就是「先在窗口里铺满，再整个放大」，像跳了两下。
  // 反过来等尺寸变化再铺满，放大就像跟着窗口一起走。
  const cancelResizeRef = useRef<(() => void) | null>(null);
  const afterResize = useCallback((run: () => void) => {
    cancelResizeRef.current?.();
    cancelResizeRef.current = afterResizeWait(
      {
        size: () => ({ width: window.innerWidth, height: window.innerHeight }),
        frame: run2 => window.requestAnimationFrame(run2),
        cancel: handle => window.cancelAnimationFrame(handle),
        now: () => performance.now(),
      },
      run,
    );
  }, []);
  useEffect(() => () => cancelResizeRef.current?.(), []);

  // 进出全屏。页面铺满只盖得住内容区，任务栏和窗口边框要主进程收。
  //
  // 顺序统一是「先窗口、后页面」：进入时先请窗口全屏，等它开始变大再铺满；
  // 退出时先请窗口退出，等它开始变小再撤回来。两个方向都这样，中间才不会
  // 出现「播放台在旧窗口里撑满」那一帧。
  //
  // 这里不放 `useEffect(() => setWindowFullscreen(expanded), [expanded])`：
  // expanded 现在只有 toggleFullscreen 一个来源，它自己已经推过了。
  // 再加一个 effect 会让每次切换推两遍，主进程也就 setFullScreen 两次——
  // 值相同但 Windows 会再走一遍过渡，事件也重复。
  const toggleFullscreen = useCallback(() => {
    const now = performance.now();
    // 冷却锁：系统过渡期间连点会让两次请求互相覆盖，窗口和页面就此错开。
    if (!canToggle(expandedLockRef.current, now)) return;
    expandedLockRef.current = now;
    if (expanded) {
      setWindowFullscreen(false);
      afterResize(() => setExpanded(false));
    } else {
      setWindowFullscreen(true);
      afterResize(() => setExpanded(true));
    }
  }, [expanded, afterResize]);

  // 全屏时控制条的呼吸：出现 → 静止 2.6 秒 → 淡出。
  // 鼠标移动、按键、点画面都会把它叫回来。
  useEffect(() => {
    if (!expanded) { setChrome(true); return; }
    let timer: number | undefined;
    const wake = () => {
      setChrome(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setChrome(false), 2600);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [expanded]);

  // Esc 收起「从本地添加」的下拉。
  useEffect(() => {
    if (!adding) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      event.preventDefault();
      setAdding(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [adding]);

  // Esc 退出全屏。和别处一样在 document 上抢，不让别的处理器先吃掉。
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      toggleFullscreen();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [expanded, toggleFullscreen]);

  const screenKind = current?.kind;

  /**
   * 是不是「透明」版式。
   *
   * 这个布尔在前面被问了很多次（组件层、叠加层、控制条按钮），但每次都要写
   * `template === 'desktop'` 一遍读起来太吵，给它一个名字。它只回答「现在这套版式
   * 底是透明的」，不表示桌面放映窗开着——那件事是 onDesktop。
   */
  const desktopMode = template === 'desktop';

  /**
   * 把放映台摆到桌面上，或者收回来。
   *
   * 这里只发请求、记状态，窗口的存亡在主进程（electron/desktop-stage.cjs）。
   * 不做「先检查有没有开」那种乐观更新：窗口有可能建失败（比如没有显示器），
   * 按钮亮着而画面没出来比慢半拍更难受。关窗时主进程会回一条通知。
   */
  const toggleDesktop = useCallback(() => {
    setOnDesktop(value => {
      setDesktopStage(!value);
      return !value;
    });
  }, []);

  /* 桌面窗关掉了（用户 Alt+F4 或系统带走）→ 按钮回到未按下。 */
  useEffect(() => listenStageClosed(() => setOnDesktop(false)), []);

  /**
   * 桌面窗上按下的动作。
   *
   * 这些事都只能在主窗口这边做：桌面窗不持有播放器、不持有收藏柜，
   * 连 localStorage 里的叠加位置都以这边为准。
   */
  useEffect(() => listenStageCommand(command => {
    if (command.type === 'stone') setTone(prev => ({ ...prev, stone: nextStoneStyle(prev.stone) }));
    else if (command.type === 'prev') onPrevTrack?.();
    else if (command.type === 'next') onNextTrack?.();
    else if (command.type === 'layers') setLayers(command.value);
    else if (command.type === 'rain') setRain(command.value);
  }), [onPrevTrack, onNextTrack]);

  /**
   * 把「现在该画什么」挂到 window 上，主进程会来取给桌面窗。
   *
   * 每一样都要传：桌面窗是另一个渲染进程，它没有这些 React 状态，
   * 也没有 blob: 封面地址（那个只在创建它的进程里有效）。
   * 色板一起传过去，是为了让桌面窗别再对 4K 视频解一帧取色。
   */
  useEffect(() => {
    const snapshot: StageSnapshot = {
      item: current ?? null,
      index: Math.max(0, usable.findIndex(item => item.id === current?.id)),
      total: usable.length,
      template,
      stone: tone.stone,
      palette,
      hint: toneHint(tone, palette),
      disc,
      focus: focusStage,
      ambience,
      now,
      rain,
      layers,
      focusLeft,
      title: current ? titleOf(current) : '',
      canPrev: !!onPrevTrack,
      canNext: !!onNextTrack,
    };
    publishStage(snapshot);
  }, [current, usable, template, tone, palette, disc, focusStage, ambience, now, rain, layers, focusLeft, onPrevTrack, onNextTrack]);

  return (
    <section className={`media-room ${expanded ? 'is-expanded' : ''}`} data-chrome={chrome ? 'visible' : 'hidden'} aria-label="放映">
      <div className="collection-toolbar media-toolbar">
        <div className="filter-tabs" role="group" aria-label="媒体分类">
          {(['image', 'video'] as const).map(type => (
            <button key={type} aria-pressed={kind === type} className={kind === type ? 'active' : ''} onClick={() => setKind(type)}>
              {type === 'image' ? '图片' : '视频'}
            </button>
          ))}
        </div>
        <div className="media-actions">
          <div className="media-add">
            <button className="text-button media-pick" aria-haspopup="menu" aria-expanded={adding} onClick={() => setAdding(value => !value)}>
              <FolderOpen size={13} />从本地添加
            </button>
            {adding && (
              <>
                {/* 点空白处收起。放在按钮之后、菜单之前，保证菜单自己的点击先到。 */}
                <button className="media-add-veil" aria-label="收起" onClick={() => setAdding(false)} />
                <div className="media-add-menu" role="menu">
                  {ADD_CHOICES.map(choice => (
                    <button
                      key={choice.key}
                      role="menuitem"
                      onClick={() => {
                        setAdding(false);
                        if (choice.key === 'folder') onPick();
                        else onPickFiles();
                      }}
                    >
                      <choice.icon size={14} />
                      <span>
                        <b>{choice.label}</b>
                        <small>{choice.hint}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="text-button media-pick" onClick={onScanWallpapers}>
            <Sparkles size={13} />读取壁纸库
          </button>
        </div>
      </div>

      {/* 播放台常驻。库里一件都没有的时候它也在，只是台面空着——
          放映台是这个页面本身，不是「有内容才出现的面板」。
          它也独立于下面的「图片 / 视频」筛选：换一种看法不该把正在放的那件拽下来。 */}
      {current ? (
        <div className="media-theater" data-kind={screenKind} data-template={template}>
          <div className="theater-screen">
            <TemplateStage
              item={current}
              template={template}
              videoRef={screen}
              onPlayState={setPlaying}
              index={Math.max(0, usable.findIndex(item => item.id === current.id))}
              total={usable.length}
              disc={disc}
              focus={focusStage}
              ambience={ambience}
              now={now}
              hint={toneHint(tone, palette)}
              stone={tone.stone}
              onStone={cycleStone}
              onPrevTrack={onPrevTrack}
              onNextTrack={onNextTrack}
              onPalette={setPalette}
              widgets={
                <LayerStack
                  value={layers}
                  onChange={setLayers}
                  remaining={focusLeft}
                  now={now}
                  disc={disc}
                  title={titleOf(current)}
                  editable
                  skin={desktopMode ? 'widgets' : 'overlay'}
                  big={expanded}
                />
              }
            />
            <RainLayer value={rain} />
          </div>
          <div className="theater-bar">
            <div className="theater-controls">
              <button className="icon-button" aria-label="上一件" onClick={() => step(-1)}>
                <ChevronLeft size={14} />
              </button>
              {screenKind === 'video' ? (
                <button className="icon-button theater-play" aria-label={playing ? '暂停' : '播放'} onClick={() => setPlaying(value => !value)}>
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
              ) : null}
              <button className="icon-button" aria-label="下一件" onClick={() => step(1)}>
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="theater-copy">
              <b title={current.name}>{titleOf(current)}</b>
              <small>
                {usable.findIndex(item => item.id === current.id) + 1} / {usable.length}
                {screenKind === 'video' ? ' · 视频' : ' · 图片'}
              </small>
            </div>
            {/* 版式切换。三个都做得不一样，所以给文字而不是图标——
                图标认不出「杂志内页」和「边框」的区别。 */}
            <div className="theater-templates" role="group" aria-label="版式">
              {templates.map(preset => (
                <button
                  key={preset.id}
                  aria-pressed={template === preset.id}
                  className={template === preset.id ? 'on' : ''}
                  title={preset.hint}
                  onClick={() => setTemplate(preset.id)}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {/* 雨层：模式和浓淡。位置固定在右下，和水滴图标同一簇。 */}
            <div className="theater-rain">
              <button
                className={`icon-button theater-rain-toggle ${rain.on ? 'on' : ''}`}
                aria-label="雨"
                aria-expanded={rainMenu}
                aria-pressed={rain.on}
                title="雨"
                onClick={() => setRainMenu(value => !value)}
              >
                <Droplets size={13} />
              </button>
              {rainMenu && (
                <>
                  <button className="theater-overlay-veil" aria-label="收起" onClick={() => setRainMenu(false)} />
                  <div className="theater-rain-menu">
                    <div className="rain-switch">
                      <span>雨</span>
                      <button
                        className={`toggle ${rain.on ? 'on' : ''}`}
                        role="switch"
                        aria-checked={rain.on}
                        aria-label="打开雨"
                        onClick={() => setRain(prev => ({ ...prev, on: !prev.on }))}
                      >
                        <span />
                      </button>
                    </div>
                    <div className="rain-modes" role="radiogroup" aria-label="雨的样子">
                      {rainModes.map(mode => (
                        <button
                          key={mode.id}
                          role="radio"
                          aria-checked={rain.mode === mode.id}
                          className={rain.mode === mode.id ? 'on' : ''}
                          title={mode.hint}
                          onClick={() => setRain(prev => ({ ...prev, mode: mode.id }))}
                        >
                          {mode.name}
                        </button>
                      ))}
                    </div>
                    <label className="rain-slider">
                      <span>浓淡</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={rain.strength}
                        aria-label="雨的浓淡"
                        onChange={event => setRain(prev => ({ ...prev, strength: Number(event.target.value) }))}
                      />
                    </label>
                    <label className="rain-slider">
                      <span>透明度</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={rain.opacity}
                        aria-label="雨的透明度"
                        onChange={event => setRain(prev => ({ ...prev, opacity: Number(event.target.value) }))}
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
            {/* 配色：默认跟画面走，也可以指定主色或手填色值。 */}
            <div className="theater-tone">
              <button
                className={`icon-button theater-tone-toggle ${toneMenu ? 'on' : ''}`}
                aria-label="配色"
                aria-expanded={toneMenu}
                title="配色"
                onClick={() => setToneMenu(value => !value)}
              >
                <Palette size={13} />
              </button>
              {toneMenu && (
                <>
                  <button className="theater-tone-veil" aria-label="收起配色" onClick={() => setToneMenu(false)} />
                  <div className="theater-tone-menu" role="group" aria-label="配色">
                    <div className="tone-modes" role="radiogroup" aria-label="取色方式">
                      {([
                        ['auto', '跟随画面'],
                        ['pick', '挑一个'],
                        ['custom', '自己填'],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          role="radio"
                          aria-checked={tone.mode === key}
                          className={tone.mode === key ? 'on' : ''}
                          onClick={() => setTone(prev => ({ ...prev, mode: key }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {tone.mode === 'pick' && (
                      <div className="tone-swatches" role="radiogroup" aria-label="从画面里挑一个主色">
                        {(palette.length ? palette : ['#6f6f6f']).map((color, at) => (
                          <button
                            key={color + at}
                            role="radio"
                            aria-checked={tone.pick === at}
                            aria-label={`画面主色 ${at + 1}`}
                            className={tone.pick === at ? 'on' : ''}
                            style={{ background: color }}
                            onClick={() => setTone(prev => ({ ...prev, pick: at }))}
                          />
                        ))}
                        <small>这张画面取出来的主色，点一个当主色相。</small>
                      </div>
                    )}

                    {tone.mode === 'custom' && (
                      <div className="tone-fields">
                        {/* 三组：信息条 / 面板 / 胶囊·署名。分组表在 tone-setting.ts，
                            这里只负责画——以后加一档颜色不用改这段 JSX。 */}
                        {toneGroups.map(group => (
                          <fieldset key={group.key} className="tone-group">
                            <legend>{group.title}</legend>
                            {group.fields.map(([key, label]) => (
                              <label key={key} className="tone-field">
                                <span>{label}</span>
                                <input
                                  type="color"
                                  value={tone.custom[key] || '#6f6f6f'}
                                  aria-label={`${group.title}${label}颜色`}
                                  onChange={event => setTone(prev => ({ ...prev, custom: { ...prev.custom, [key]: event.target.value } }))}
                                />
                                <input
                                  className="tone-hex"
                                  type="text"
                                  inputMode="text"
                                  maxLength={7}
                                  placeholder="自动"
                                  value={tone.custom[key]}
                                  aria-label={`${group.title}${label}色值`}
                                  onChange={event => {
                                    const raw = event.target.value;
                                    // 边输边认：认得出就收敛成 #rrggbb，认不出先原样留着，
                                    // 否则输到一半（"#1c2"）就被吞掉字符，根本没法打。
                                    const next = normaliseHex(raw);
                                    setTone(prev => ({ ...prev, custom: { ...prev.custom, [key]: next || raw } }));
                                  }}
                                />
                              </label>
                            ))}
                          </fieldset>
                        ))}
                        <button className="tone-reset" onClick={() => setTone(prev => ({ ...prev, custom: { ...defaultTone.custom } }))}>
                          全部回到自动
                        </button>
                      </div>
                    )}

                    <p className="tone-hint">留空表示这一档仍然按画面算。</p>
                  </div>
                </>
              )}
            </div>
            {/* 图层：一颗按钮、一份菜单，六项在两个版式里都能用。 */}
            <TheaterLayers layers={layers} onLayers={setLayers} open={layersMenu} onOpen={setLayersMenu} desktop={desktopMode} />
            {/* 全屏键在透明版式下变成「放到桌面」。
                透明模式的意义就是把画面贴回桌面上看，这时候窗口全屏没有意义——
                两个按钮并排反而要用户自己判断该点哪个。 */}
            {desktopMode ? (
              <button
                className="icon-button theater-expand"
                aria-label={onDesktop ? '收回桌面放映' : '放到桌面'}
                aria-pressed={onDesktop}
                title={onDesktop ? '收回桌面放映' : '放到桌面'}
                onClick={toggleDesktop}
              >
                <MonitorPlay size={13} />
              </button>
            ) : (
              <button className="icon-button theater-expand" aria-label={expanded ? '退出全屏' : '全屏'} aria-pressed={expanded} onClick={toggleFullscreen}>
                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* 库空着的时候台面也照常出现，只是画面换成一块渐变占位。
           这样版式、叠加元素、雨滴都能先看着调——不然用户第一次打开
           什么都看不见，也就无从知道这些东西长什么样。 */
        <div className="media-theater" data-kind="image" data-template={template}>
          <div className="theater-screen">
            <TemplateStage
              item={BLANK_ITEM}
              template={template}
              videoRef={screen}
              onPlayState={setPlaying}
              index={0}
              total={0}
              hint={toneHint(tone, palette)}
              stone={tone.stone}
              onStone={cycleStone}
              widgets={
                <LayerStack
                  value={layers}
                  onChange={setLayers}
                  remaining={focusLeft}
                  now={now}
                  disc={disc}
                  title=""
                  editable
                  skin={desktopMode ? 'widgets' : 'overlay'}
                  big={expanded}
                />
              }
            />
            <RainLayer value={rain} />
            <div className="theater-blank-hint">
              <ImageIcon size={16} strokeWidth={1.2} />
              <span>先「从本地添加」几张图片或视频</span>
            </div>
          </div>
          <div className="theater-bar">
            <div className="theater-controls">
              <button className="icon-button" aria-label="上一件" disabled>
                <ChevronLeft size={14} />
              </button>
              <button className="icon-button" aria-label="下一件" disabled>
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="theater-copy">
              <b>空台面</b>
              <small>先放点东西进来</small>
            </div>
            <div className="theater-templates" role="group" aria-label="版式">
              {templates.map(preset => (
                <button
                  key={preset.id}
                  aria-pressed={template === preset.id}
                  className={template === preset.id ? 'on' : ''}
                  title={preset.hint}
                  onClick={() => setTemplate(preset.id)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            {/* 雨层：模式和浓淡。位置固定在右下，和水滴图标同一簇。 */}
            <div className="theater-rain">
              <button
                className={`icon-button theater-rain-toggle ${rain.on ? 'on' : ''}`}
                aria-label="雨"
                aria-expanded={rainMenu}
                aria-pressed={rain.on}
                title="雨"
                onClick={() => setRainMenu(value => !value)}
              >
                <Droplets size={13} />
              </button>
              {rainMenu && (
                <>
                  <button className="theater-overlay-veil" aria-label="收起" onClick={() => setRainMenu(false)} />
                  <div className="theater-rain-menu">
                    <div className="rain-switch">
                      <span>雨</span>
                      <button
                        className={`toggle ${rain.on ? 'on' : ''}`}
                        role="switch"
                        aria-checked={rain.on}
                        aria-label="打开雨"
                        onClick={() => setRain(prev => ({ ...prev, on: !prev.on }))}
                      >
                        <span />
                      </button>
                    </div>
                    <div className="rain-modes" role="radiogroup" aria-label="雨的样子">
                      {rainModes.map(mode => (
                        <button
                          key={mode.id}
                          role="radio"
                          aria-checked={rain.mode === mode.id}
                          className={rain.mode === mode.id ? 'on' : ''}
                          title={mode.hint}
                          onClick={() => setRain(prev => ({ ...prev, mode: mode.id }))}
                        >
                          {mode.name}
                        </button>
                      ))}
                    </div>
                    <label className="rain-slider">
                      <span>浓淡</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={rain.strength}
                        aria-label="雨的浓淡"
                        onChange={event => setRain(prev => ({ ...prev, strength: Number(event.target.value) }))}
                      />
                    </label>
                    <label className="rain-slider">
                      <span>透明度</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={rain.opacity}
                        aria-label="雨的透明度"
                        onChange={event => setRain(prev => ({ ...prev, opacity: Number(event.target.value) }))}
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
            <TheaterLayers layers={layers} onLayers={setLayers} open={layersMenu} onOpen={setLayersMenu} desktop={desktopMode} />
            {/* 空台面也要有全屏 / 桌面键：上面那张画面已经是同一块舞台，
                换到空库时忽然没得全屏会很怪。透明版式下这颗仍走桌面放映。 */}
            {desktopMode ? (
              <button
                className="icon-button theater-expand"
                aria-label={onDesktop ? '收回桌面放映' : '放到桌面'}
                aria-pressed={onDesktop}
                title={onDesktop ? '收回桌面放映' : '放到桌面'}
                onClick={toggleDesktop}
              >
                <MonitorPlay size={13} />
              </button>
            ) : (
              <button className="icon-button theater-expand" aria-label={expanded ? '退出全屏' : '全屏'} aria-pressed={expanded} onClick={toggleFullscreen}>
                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            )}
          </div>
        </div>
      )}

      {!usable.length ? (
        <div className="media-empty">
          <div className="media-empty-art">
            <ImageIcon size={26} strokeWidth={1} />
          </div>
          <h2>这一面墙还空着</h2>
          <p>选几张图片或视频，或者挑一整个文件夹；装了 Wallpaper Engine 也可以直接读壁纸库。</p>
          <div className="media-empty-actions">
            <button className="primary-button" onClick={() => setAdding(true)}>
              <FolderOpen size={14} />从本地添加
            </button>
            <button className="secondary-button" onClick={onScanWallpapers}>
              <Sparkles size={14} />读取壁纸库
            </button>
          </div>
        </div>
      ) : (<>
          <div className="media-sources">
            <span className="media-count">
              共 {usable.length} 件 · {images} 张图 · {videos} 段视频
            </span>
            <ul className="media-dir-list">
              {fromWallpaper > 0 && (
                <li className="media-dir is-wallpaper">
                  <span>Wallpaper Engine · {fromWallpaper} 件</span>
                  <button className="icon-button" aria-label="重新读取壁纸库" onClick={onScanWallpapers}>
                    <RefreshCw size={11} />
                  </button>
                  {/* 这里用文字不用图标：图标太容易看不见。
                      壁纸库是从别处读进来的，用户更需要一个明确的「断开」出口。 */}
                  <button className="chip-action" aria-label="移出壁纸库" onClick={onForgetWallpapers}>
                    <X size={10} />移出
                  </button>
                </li>
              )}
              {dirs.map(dir => (
                <li key={dir} className="media-dir">
                  <span title={dir}>{dir.split(/[\\/]/).filter(Boolean).pop() ?? dir}</span>
                  <button className="icon-button" aria-label={`重新扫描 ${dir}`} onClick={() => onRescan(dir)}>
                    <RefreshCw size={11} />
                  </button>
                  <button className="chip-action" aria-label={`移出 ${dir}`} onClick={() => onForgetDir(dir)}>
                    <X size={10} />移出
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {shown.length ? (
            <ul className="media-grid" ref={grid}>
              {shown.map(item => {
                const ready = active && seen.has(item.id);
                const picked = current?.id === item.id;
                return (
                  <li key={item.id} data-id={item.id}>
                    <button
                      className={`media-card ${picked ? 'is-current' : ''}`}
                      data-kind={item.kind}
                      onClick={() => { setCurrentId(item.id); setPlaying(true); }}
                      aria-pressed={picked}
                      aria-label={`放映 ${titleOf(item)}`}
                    >
                      <span className="media-thumb">
                        {!ready ? null : item.kind === 'image' ? (
                          <img src={mediaSrc(item)} alt="" loading="lazy" decoding="async" />
                        ) : (
                          <VideoThumb src={mediaSrc(item)} alt="" />
                        )}
                        {item.kind === 'video' && <i className="media-badge">视频</i>}
                      </span>
                      <span className="media-caption">
                        <b title={item.name}>{titleOf(item)}</b>
                        <small>{sizeOf(item.size)}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="no-results">
              <ImageIcon size={28} />
              <p>{kind === 'image' ? '这个文件夹里还没有图片。' : '这个文件夹里还没有视频。'}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
