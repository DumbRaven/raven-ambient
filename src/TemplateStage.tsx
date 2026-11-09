/**
 * 放映台的版式渲染。
 *
 * 三套版式共用同一份取色结果（collageTone），差别只在摆法：
 *
 *   collage  整块画布铺底色，左边一列分上下两块（上面是大画面，下面是信息条），
 *            右边一整条高饱和竖面板，右下角压着一只正在转的彩胶。这是
 *            DumbRaven 视频里那套——几何是照着 B 站录屏逐像素量的（画布
 *            2301×1259）：左列 65.6% / 竖缝 1.0% / 右列 33.4%，上行 69.9% /
 *            横缝 2.7% / 下行 27.4%，四边留 37/41/35/44 的底色。
 *   photo    画面整张铺满，手写体标题压左上，曲目列在右侧，右上署名。
 *   frame    画面缩成一枚居中卡片，四周留底色，底部一行小字。
 *
 * 三套都不用外部字体、不用图片素材——全部 CSS 画，所以离线可用，
 * 也不会因为缺字体而变形。乌鸦是描出来的矢量路径（raven.ts）。
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { mediaSrc } from './media';
import type { MediaItem } from './records';
import { coverPalette, recordPressing, vinylPalette } from './vinyl';
import { launchSeed } from './sleeves';
import { ravenBox, ravenPath, ravenWingPath } from './raven';
import { videoPalette } from './video-palette';
import { collageTone, findTemplate, templateTitle, type TemplateId, type ToneHint } from './templates';
import { MARBLE_FILTER_ID, marbleFilterMarkup, type StoneStyle } from './marble.ts';
import { timerText } from './overlays';
import { phaseCaptions, type FocusPhase } from './focus';
import { nowDetail, nowLine, timeOfDay, type StageNow } from './stage-text';
import { beginSwipe, moveSwipe, swipeFollow, swipeFires } from './disc-swipe';

/** 右下角那只彩胶。没在放音乐时它是空的，只留一圈盘面。 */

/** 凹槽的石纹滤镜。
 *
 *  管线为什么要这么绕、为什么不能直接生成噪声，说明在 marble.ts 里
 *  （那边是纯字符串，可以单独测）。这里只负责把它挂上去。
 *
 *  必须挂在 <body> 上：放在被 clip-path / overflow 裁的容器里时，
 *  Chromium 会把这个引用判为失效（computed 变成 none），和雨丝那次是同一个坑。
 *
 *  同一个页面上会同时有两只放映台（网格里那只、全屏那只），都读同一个
 *  `tone.stone`。所以这里不登记「谁负责清理」——谁先挂上谁来挂，后到的发现
 *  风格已经对就直接返回。换风格时整体替换掉，不留清理责任给任何一方，
 *  否则先卸载的那只会把还在用的滤镜一起带走。 */
function useMarbleFilter(style: StoneStyle) {
  useEffect(() => {
    const existing = document.getElementById(MARBLE_FILTER_ID);
    if (existing?.parentElement?.getAttribute('data-tpl-marble') === style) return;
    document.querySelectorAll('[data-tpl-marble]').forEach(node => node.remove());
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    // 注意别和版式根节点上的 `data-stone` 撞名：那个标记的是「这一页用哪种石纹」，
    // 下面这两个 query 是「找出所有挂滤镜的宿主」。撞名会把整个版式删掉。
    host.setAttribute('data-tpl-marble', style);
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none';
    host.innerHTML = marbleFilterMarkup(style);
    document.body.appendChild(host);
  }, [style]);
}

export type StageDisc = { cover?: string; color: string; key: string; spinning: boolean };

/* StageNow / timeOfDay / nowLine / nowDetail 住在 stage-text.ts：纯字符串逻辑，不碰 DOM，
   单独一个文件就能直接测，不用把 React 拖进测试里。 */
export { nowDetail, nowLine, timeOfDay, type StageNow } from './stage-text';

/**
 * 信息条右半边那块番茄钟的读数。
 *
 * 拼贴版式里它是版式的一部分，不是可以拖动的叠加元素——用户明确说过
 * 「拼贴就不允许用户自己添加组件」。所以这里只收数字，不收位置、不收开关。
 * `null` 表示还没开始过（显示「未开始」），和叠加元素那边的 timer 判断一致。
 */
export type StageFocus = {
  phase: FocusPhase;
  /** 本阶段剩余毫秒。 */
  remaining: number;
  /** 剩余比例 0–1，用来画那条细线。 */
  left: number;
  rounds: number;
  roundsBeforeLong: number;
};

/**
 * 面板上半那块「此刻的环境音」。
 *
 * 为什么是环境音而不是曲目信息：信息条已经写着 TITLE 和 PLAYLIST 了，
 * 面板再放一遍正在放的歌就是重复（用户原话：「那是不是有点重复了和信息栏」）。
 * 而环境音叠加+为音乐让位是这个软件独有的、视频里根本不存在的东西，
 * 放映页此前一处都没体现它——这里补上。
 */
export type StageAmbience = {
  /** 此刻叠着的环境音名字，最多 8 个。 */
  layers: string[];
  /** 其中被静音的有几层（静音的不出声，不该跟出声的混在一起数）。 */
  muted: number;
  /** 音乐正在响、环境音正在退让。 */
  ducked: boolean;
  /** 在场各层里最深的避让量，分贝。0 表示大家都在原音量上。 */
  depth: number;
};

type Props = {
  item: MediaItem;
  template: TemplateId;
  /** 视频要用 video 元素而不是 img；由外面持有 ref，好让控制条能暂停/续播。 */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onPlayState: (playing: boolean) => void;
  index: number;
  total: number;
  /** 「正在听」的那张碟。拼贴版右下角画的就是它。 */
  disc?: StageDisc | null;
  /** 番茄钟读数。不传或为 null 时信息条第二格显示「未开始」。 */
  focus?: StageFocus | null;
  /** 此刻的环境音状况。不传或为 null 时面板上半的这块整个不渲染。 */
  ambience?: StageAmbience | null;
  /** 此刻真正在响的那一首。不传或为 null 时 PLAYLIST 那行留空。 */
  now?: StageNow;
  /** 用户指定的配色。不传就纯自动。 */
  hint?: ToneHint;
  /** 竖排胶囊表面的石纹。不传按浪脊。 */
  stone?: StoneStyle;
  /**
   * 点胶囊换下一种石纹。不传就只是装饰，不能点。
   *
   * 为什么放在胶囊自己身上而不是配色菜单（用户 m09905）：
   * 「这个直接做成在胶囊上点击就切换吧，别在调色板显示了」——
   * 石纹是这一块表面的性质，改它自然该在它自己身上改。
   */
  onStone?: () => void;
  /**
   * 在唱片上左右滑动切歌。左滑下一曲、右滑上一曲。
   *
   * 两个都不传时唱片只是画，不接指针——库空着、只有一首、或者外部播放器
   * 那边根本没有「上一首」的时候，滑上去什么都不该发生，也不该出现抓手光标。
   * 判定规则在 disc-swipe.ts，这里只负责把坐标喂进去。
   */
  onPrevTrack?: () => void;
  onNextTrack?: () => void;
  /** 把取到的原始色板交出去，配色面板要拿它画可选的色块。 */
  onPalette?: (colors: string[]) => void;
  /**
   * 外面算好的色板。传了就不自己取色。
   *
   * 桌面放映窗用它：那个窗口是另一个渲染进程，`videoPalette` 的缓存不跨进程，
   * 自己在那边取一次色就要**再解码一帧 4K**。主窗口已经把颜色算出来了，
   * 传几十字节过去比重新解一遍便宜得多，而且两边配色保证一样。
   */
  colors?: string[];
};

const BRAND = 'DumbRaven';

/** 左上角那两行日期。AE 里是「2026 / 1020」，这里跟着当天走。 */
const stampDate = new Date();
const stampYear = String(stampDate.getFullYear());
const stampDay = `${String(stampDate.getMonth() + 1).padStart(2, '0')}${String(stampDate.getDate()).padStart(2, '0')}`;

/**
 * 竖排徽标。AE 源里它不是「DUMBRAVEN 十个字母顺序排」，而是把品牌拆成两个词根
 * 分两列：左列 DUMB（4 个）、右列 RAVEN（5 个），右列整体下沉约半行。
 * 所以这里必须存成两列，不能 Array.from 一整串——那样会按行铺成 (D,U)(M,B)…，
 * 两列的字母就对不上了。
 */
const BADGE = { left: 'DUMB', right: 'RAVEN' } as const;

/**
 * 乌鸦。两色：身体走 currentColor（版式里给 --tpl-panel），
 * 翅膀单独画一层（给 --tpl-bar）——原 logo 本来就是这两块颜色，
 * 一条路径填不出两色，所以是两条 path 叠起来的。
 */
function Raven({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox={`${ravenBox.x} ${ravenBox.y} ${ravenBox.width} ${ravenBox.height}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={ravenPath} fill="currentColor" fillRule="evenodd" />
      <path className="tpl-raven-wing" d={ravenWingPath} />
    </svg>
  );
}

export default function TemplateStage({ item, template, videoRef, onPlayState, index, total, disc, focus, ambience, now, hint, stone = 'sea', onStone, onPrevTrack, onNextTrack, onPalette, colors: given }: Props) {
  const preset = findTemplate(template);
  const fromWallpaper = !!item.source;
  const title = useMemo(() => templateTitle(item.name, fromWallpaper), [item.name, fromWallpaper]);
  /* 面板主标题用的是时段词，不是画面文件名——见 timeOfDay 上面那段说明。
     不缓存：MediaRoom 每 800ms 会把番茄钟读数交上来，组件本来就在持续重渲染，
     时段跨过整点时下一拍就跟上了。 */
  const heading = timeOfDay();
  /* PLAYLIST 的副行：本地是「01:12 / 03:48 · 列表循环」，外部是专辑。
     空串表示这一行没内容，JSX 那边就不渲染它，不留一根空线。 */
  const detail = nowDetail(now);
  const [ownColors, setColors] = useState<string[]>([]);
  const colors = given ?? ownColors;
  const [discColors, setDiscColors] = useState<string[]>([]);

  // 取色：图片读封面，视频抽一帧。两条路都按 src 缓存，翻页不重算。
  // 空条目（库里还没有东西）没有地址可读，直接跳过。
  // 外面给了色板就不取——桌面放映窗走这条，否则 4K 要解两遍。
  useEffect(() => {
    let live = true;
    if (given) return;
    if (!item.path) { setColors([]); return; }
    const read = item.kind === 'video' ? videoPalette : coverPalette;
    read(mediaSrc(item)).then(list => { if (live) setColors(list); });
    return () => { live = false; };
  }, [item, given]);

  // 彩胶的色从「正在听」那张封面来，不是从放映的画面上来。
  const discCover = disc?.cover ?? '';
  useEffect(() => {
    let live = true;
    if (!discCover) { setDiscColors([]); return; }
    coverPalette(discCover).then(list => { if (live) setDiscColors(list); });
    return () => { live = false; };
  }, [discCover]);

  useMarbleFilter(stone);
  const tone = useMemo(() => collageTone(colors, hint), [colors, hint]);
  // 把取到的色板交给外层：配色面板要用它画「从这里挑一个」的色块。
  useEffect(() => { onPalette?.(colors); }, [colors, onPalette]);

  const counter = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;

  const discPressing = useMemo(() => recordPressing(disc?.key ?? 'idle', launchSeed), [disc?.key]);
  const discPalette = useMemo(() => vinylPalette(discColors, disc?.color ?? '#9a8b78'), [discColors, disc?.color]);

  /**
   * 唱片上的左右滑动切歌。
   *
   * 为什么把指针事件挂在唱片自己身上：它是这块画面上「代表当前这一首」的东西，
   * 手势落在那儿最自然；信息条已经被点过了（胶囊切石纹），控制条那边有按钮。
   *
   * 为什么用 pointer 而不是 touch：桌面端用鼠标拖也应该是同一个手感，
   * 而且 pointer 事件能拿到 `pointerType` 之外的一切，不必分两条代码路径。
   * `touch-action: none` 加在唱片上，否则触屏上浏览器会把横滑当成滚动。
   *
   * 跟手位移写进 CSS 变量而不是 `transform`：唱片自己挂着旋转动画
   * （`rotate` 属性）和居中（`translate` 属性），第三个位移必须走
   * `translate` 的增量，不然会把它们顶掉——这是旋转那一轮踩过的同一个坑。
   */
  const swipable = !!(onPrevTrack || onNextTrack);
  /* 谁是「正在滑的那根手指」用 ref 记，不用 state 判断。
     原因是状态更新是异步的：浏览器一帧内可能连发几个 pointermove，
     React 批处理之后它们读到的还是上一次的 state，前几笔位移会被整段丢掉
     ——手一甩就有 100px 落在同一帧里，那是能感觉到的。
     state 只留给渲染（`is-swiping` 类、`--disc-drag` 的值），判断一律看 ref。 */
  const swipeIdRef = useRef<number | null>(null);
  const [swipe, setSwipe] = useState<{ id: number; dx: number } | null>(null);
  const trackRef = useRef<ReturnType<typeof beginSwipe> | null>(null);
  const fireRef = useRef({ onPrev: onPrevTrack, onNext: onNextTrack });
  useEffect(() => { fireRef.current = { onPrev: onPrevTrack, onNext: onNextTrack }; });

  const swipeDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!swipable || event.button !== 0) return;
    swipeIdRef.current = event.pointerId;
    trackRef.current = beginSwipe({ x: event.clientX, y: event.clientY });
    setSwipe({ id: event.pointerId, dx: 0 });
    /* 抓住指针：手指划出唱片范围时事件还归这里，否则滑到边缘就断了。
       但指针已经抬起（或者这只是一次合成事件）时它抛 NotFoundError，
       那就退化成不抓——事件照常在元素上冒，功能不因此丢。 */
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 抓不到就算了 */ }
  };
  const swipeMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const track = trackRef.current;
    if (!track || swipeIdRef.current !== event.pointerId) return;
    const moved = moveSwipe(track, { x: event.clientX, y: event.clientY });
    trackRef.current = moved;
    setSwipe({ id: event.pointerId, dx: swipeFollow(moved) });
  };
  const swipeEnd = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const track = trackRef.current;
    if (!track || swipeIdRef.current !== event.pointerId) return;
    const hit = swipeFires(track);
    swipeIdRef.current = null;
    trackRef.current = null;
    setSwipe(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (hit === 1) fireRef.current.onNext?.();
    else if (hit === -1) fireRef.current.onPrev?.();
  };

  const style = {
    '--tpl-base': tone.base,
    '--tpl-panel': tone.panel,
    '--tpl-bar': tone.bar,
    '--tpl-ink': tone.ink,
    '--tpl-ink-soft': tone.inkSoft,
    '--tpl-on-panel': tone.onPanel,
    '--tpl-on-bar': tone.onBar,
    '--tpl-gold': tone.gold,
    '--disc-base': discPalette.base,
    '--disc-accent': discPalette.accent,
    '--disc-accent-2': discPalette.accent2,
    '--disc-groove': discPalette.groove,
    '--disc-sheen': discPalette.sheen,
    '--disc-angle': `${discPressing.angle}deg`,
  } as React.CSSProperties;

  /* 跟手位移走独立变量：`.tpl-disc` 身上挂着居中（`translate`）和旋转（`rotate`），
     直接改 `transform` 会把居中的那半截顶掉，圆心就飞了。 */
  const discDrag = { '--disc-drag': `${swipe?.dx ?? 0}px` } as React.CSSProperties;

  // 空条目（库还空着时的占位）没有 path，拼出来是 media://local/ 这种无效地址，
  // 直接渲染会是一个破图图标。换成一块纯 CSS 渐变，版式照常成立。
  const blank = !item.path;
  const media = blank ? (
    <div className="tpl-blank" aria-hidden="true" />
  ) : item.kind === 'video' ? (
    <video
      key={item.id}
      ref={videoRef}
      src={mediaSrc(item)}
      loop
      playsInline
      autoPlay
      /* 必须静音：壁纸视频大多自带雨声、海浪这些环境音，这里是「画面」不是「音轨」。
         不静音就会和正在放的唱片叠在一起，而且用户点放映本来只是想看画面。
         网格里的 VideoThumb 早就 muted 了，这条之前漏了。 */
      muted
      onPlay={() => onPlayState(true)}
      onPause={() => onPlayState(false)}
    />
  ) : (
    <img key={item.id} src={mediaSrc(item)} alt={title} />
  );

  return (
    <div className={`template template-${preset.id}`} data-stone={stone} style={style} aria-label={`${preset.name}版式`}>
      {preset.id === 'collage' && (
        <>
          <div className="tpl-block tpl-block-media">{media}</div>

          {/* 左上角那两行小日期。AE 里这层叫「2026 1020」，字号 12、色 #C5AF83。 */}
          <p className="tpl-corner-date">{stampYear}<br />{stampDay}</p>

          <div className="tpl-block tpl-block-panel">
            <span className="tpl-dot tpl-dot-tl" aria-hidden="true" />
            <span className="tpl-dot tpl-dot-tr" aria-hidden="true" />
            <span className="tpl-dot tpl-dot-bl" aria-hidden="true" />
            <span className="tpl-dot tpl-dot-br" aria-hidden="true" />

            {/* 面板上半：此刻的环境音。

                原先这里是四行固定英文（For more information about / This Video /
                please read the / introduction）加它的上下翻转倒影——那是给视频
                套版用的说明，在软件里毫无信息量，用户原话「这个是我做视频用的，
                软件上展示这个就没什么价值了」。

                现在换成环境音状况。为什么选它：信息条已经写着 TITLE 和 PLAYLIST，
                再放一遍曲目就重复了（用户原话「那是不是有点重复了和信息栏」）；
                而「几路环境音叠着、音乐响起时让出多少 dB」是这个软件独有的、
                视频里根本不存在的东西，放映页此前一处都没体现它。

                倒影保留——那是这个版式的语言（像印在纸背透过来），
                只是内容从套话换成了同一份数据的镜像。 */}
            {ambience ? (
              <>
                <div className="tpl-ambient">
                  <b>AMBIENCE</b>
                  <p className="tpl-ambient-layers">{ambience.layers.join(' · ')}</p>
                  <p className="tpl-ambient-meta">
                    {ambience.layers.length} 层
                    {ambience.muted > 0 && ` · ${ambience.muted} 静音`}
                    {ambience.ducked && ambience.depth > 0
                      ? ` · 让出 ${ambience.depth} dB`
                      : ' · 原音量'}
                  </p>
                </div>
                <p className="tpl-ambient-mirror" aria-hidden="true">
                  <span>{ambience.layers.join(' · ')}</span>
                </p>
              </>
            ) : null}

            {/* 原本这里还有一行 `DumbRaven bilibili` 的品牌署名，已删掉。
               AE 源文件里没有这个图层，参考图（AE 最终渲染）里也没有它——
               它是早期自行加的，位置正好压在倒影上，两层字糊成一团。
               品牌在右下角的 Produced By 里已经出现过一次，不需要再说一遍。 */}

            {/* 标题区就是「这一页叫什么」，所以放当前放映的那一件。
                AE 源里这三行是一个文本图层（`BEFORE THE LAKE FREEZES / Picked / Just for U`），
                参考图里也是三行、标题结尾带句号——所以这里拆成三个块，不是
                标题 + 「Picked · Just for U」两行。
                另外：AE 里标题**没有**上下翻转的倒影，只有上面那段
                `For more information about` 有（它是 scale(-100,-100) 的镜像层）。
                所以这里不再渲染 `.tpl-title-mirror`。 */}
            <div className="tpl-words">
              <b className="tpl-title-text">{heading}</b>
              <b className="tpl-sub">Picked</b>
              <b className="tpl-sub">Just for U</b>
            </div>

            {/* 竖排 DUMBRAVEN：两列（DUMB / RAVEN），装在面板右上那枚半透明胶囊里。
                右列从第 0 个字母起就比左列低半行，这是 AE 源里的错位，
                不是排版事故——所以下沉量写在 CSS 的 .tpl-badge-col-right 上。

                用 <button> 而不是 <div>：点一下换石纹（用户 m09905），
                键盘用户也能 Tab 过来按 Enter / Space，不用另写一套按键处理。 */}
            <button
              type="button"
              className="tpl-tag"
              onClick={onStone}
              disabled={!onStone}
              aria-label={stone === 'jade' ? '石纹：玉石，点击换浪脊' : '石纹：浪脊，点击换玉石'}
            >
              <span className="tpl-badge" aria-hidden="true">
                <span className="tpl-badge-col tpl-badge-col-left">
                  {Array.from(BADGE.left, (letter, at) => (
                    <span key={at} style={{ opacity: 1 - at * 0.045 }}>{letter}</span>
                  ))}
                </span>
                <span className="tpl-badge-col tpl-badge-col-right">
                  {Array.from(BADGE.right, (letter, at) => (
                    <span key={at} style={{ opacity: 1 - at * 0.045 }}>{letter}</span>
                  ))}
                </span>
              </span>
              <span className="tpl-star tpl-star-a" aria-hidden="true">✦</span>
              <span className="tpl-star tpl-star-b" aria-hidden="true">✦</span>
              <span className="tpl-star tpl-star-c" aria-hidden="true">✦</span>
              <span className="tpl-star tpl-star-d" aria-hidden="true">✦</span>
            </button>

          </div>

          {/* 唱片层：和面板占同一个网格格位，但不在面板内部——
              面板用 mask 挖了洞，唱片若作为面板子元素会被同一个 mask 一起裁掉。
              这一层 z-index 比面板低，唱片坐在页面底色上，从洞里露出来。
              它同时是独立的尺寸容器，所以里面的 cqw 仍等于「面板宽度的百分之一」。 */}
          <div className="tpl-disc-layer">

            <span
              /* key 挂碟的身份：换唱片（或换外部曲目）时整块重新挂载，
                 CSS 那边的入场动画才会从头播一次。同 key 不会重播。 */
              key={disc?.key ?? 'idle'}
              className={`tpl-disc pressing-${discPressing.style} ${discPalette.light ? 'is-light' : ''} ${disc?.spinning ? 'spinning' : ''} ${disc ? 'has-disc' : ''} ${swipable ? 'is-swipable' : ''} ${swipe ? 'is-swiping' : ''}`}
              style={discDrag}
              /* 唱片层整层是 pointer-events: none（它只是占位的画），
                 手势能不能进来由这里的 is-swipable 在 CSS 里单独打开。 */
              onPointerDown={swipable ? swipeDown : undefined}
              onPointerMove={swipable ? swipeMove : undefined}
              onPointerUp={swipable ? swipeEnd : undefined}
              onPointerCancel={swipable ? swipeEnd : undefined}
              aria-hidden="true"
            >
              <span
                className="tpl-disc-label"
                style={discCover ? { backgroundImage: `url("${discCover}")` } : undefined}
              />
              <i className="tpl-disc-hole" />
            </span>

            {/* 压在唱片右下角的署名胶囊。 */}
            <p className="tpl-produced">Produced By<br /><b>{BRAND}</b></p>
          </div>

          <div className="tpl-block tpl-block-bar">
            {/* TITLE 和 FOCUS 并排。原先第二格是 PHOTOGRAPHY / 「Read the introduction」，
                那个值对所有条目都一样、不提供任何信息，删掉了。
                空出来的位置给当下的番茄钟——这一栏本来就是「此刻」的信息。 */}
            <div className="tpl-fields">
              <div><b>TITLE</b><span>{title || 'Untitled'}</span></div>
              <div className="tpl-focus">
                <b>FOCUS</b>
                {focus ? (
                  <>
                    <span className="tpl-focus-clock">{timerText(focus.remaining)}</span>
                    {/* 剩余比例：满格是刚开始，缩到 0 是本阶段结束。 */}
                    <i className="tpl-focus-bar" aria-hidden="true">
                      <span style={{ width: `${focus.left * 100}%` }} />
                    </i>
                    <span className="tpl-focus-meta">
                      {focus.phase === 'focus'
                        ? `ROUND ${focus.rounds + 1}/${focus.roundsBeforeLong}`
                        : `${phaseCaptions[focus.phase]} · ${focus.rounds + 1}/${focus.roundsBeforeLong}`}
                    </span>
                  </>
                ) : (
                  <span className="tpl-focus-idle">未开始</span>
                )}
              </div>
            </div>
            <div className="tpl-list">
              <b>PLAYLIST</b>
              {/* 只写此刻在响的那一首。原先有两处不对：
                  ① 这里取的是当前画面的文件名，画面和数据没关系；
                  ② 把后面 9 首用顿号串成一大段，那不是「此刻在放什么」。
                  现在按模式分两条路：本地读唱片名 + 艺人，外部读媒体会话的
                  歌名 + 歌手 + 播放器名（三样拼起来才够认，外部音乐没有封面可看）。
                  第二行讲「放到哪了」：本地是进度 + 播放顺序，外部是专辑。 */}
              <span>{nowLine(now)}</span>
              {detail && <span className="tpl-now-detail">{detail}</span>}
            </div>
            <Raven className="tpl-raven" />
          </div>
        </>
      )}

      {preset.id === 'photo' && (
        <>
          <div className="tpl-photo-media">{media}</div>
          <p className="tpl-photo-brand">{BRAND}<i>bilibili</i></p>
          <h2 className="tpl-photo-title">{title}</h2>
          <ul className="tpl-photo-list" aria-label="放映信息">
            <li><span>{preset.name}</span><b>{counter}</b></li>
            <li><span>SOURCE</span><b>{fromWallpaper ? 'WALLPAPER' : 'LOCAL'}</b></li>
            <li><span>KIND</span><b>{item.kind === 'video' ? 'VIDEO' : 'STILL'}</b></li>
          </ul>
        </>
      )}

      {preset.id === 'frame' && (
        <div className="tpl-frame-card">
          <div className="tpl-frame-media">{media}</div>
          <div className="tpl-frame-foot">
            <b>{title}</b>
            <span>{counter}</span>
          </div>
        </div>
      )}
    </div>
  );
}
