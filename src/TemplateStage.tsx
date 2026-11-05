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
import { useEffect, useMemo, useState } from 'react';
import { mediaSrc } from './media';
import type { MediaItem } from './records';
import { coverPalette, recordPressing, vinylPalette } from './vinyl';
import { launchSeed } from './sleeves';
import { ravenBox, ravenPath, ravenWingPath } from './raven';
import { videoPalette } from './video-palette';
import { collageTone, findTemplate, templateTitle, type TemplateId, type ToneHint } from './templates';
import { timerText } from './overlays';
import { phaseCaptions, type FocusPhase } from './focus';

/** 右下角那只彩胶。没在放音乐时它是空的，只留一圈盘面。 */

/** 凹槽的大理石纹滤镜。
 *  AE 里那层是「分型杂色 + 柔光」，CSS 没有等价物，用 SVG feTurbulence 生成。
 *  必须挂在 <body> 上：放在被 clip-path / overflow 裁的容器里时，
 *  Chromium 会把这个引用判为失效（computed 变成 none），和雨丝那次是同一个坑。 */
function useMarbleFilter() {
  useEffect(() => {
    const id = 'tpl-marble';
    if (document.getElementById(id)) return;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none';
    host.innerHTML =
      '<svg width="300" height="300"><filter id="tpl-marble" x="0" y="0" width="100%" height="100%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.052" numOctaves="10" seed="41" stitchTiles="stitch" result="t"/>' +
      '<feColorMatrix in="t" type="saturate" values="0"/>' +
      '<feComponentTransfer><feFuncR type="linear" slope="2.4" intercept="-0.6"/><feFuncG type="linear" slope="2.4" intercept="-0.6"/><feFuncB type="linear" slope="2.4" intercept="-0.6"/></feComponentTransfer>' +
      '</filter></svg>';
    document.body.appendChild(host);
    return () => { host.remove(); };
  }, []);
}

export type StageDisc = { cover?: string; color: string; key: string; spinning: boolean };

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
  /** 用户指定的配色。不传就纯自动。 */
  hint?: ToneHint;
  /** 把取到的原始色板交出去，配色面板要拿它画可选的色块。 */
  onPalette?: (colors: string[]) => void;
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

export default function TemplateStage({ item, template, videoRef, onPlayState, index, total, disc, focus, ambience, hint, onPalette }: Props) {
  const preset = findTemplate(template);
  const fromWallpaper = !!item.source;
  const title = useMemo(() => templateTitle(item.name, fromWallpaper), [item.name, fromWallpaper]);
  const [colors, setColors] = useState<string[]>([]);
  const [discColors, setDiscColors] = useState<string[]>([]);

  // 取色：图片读封面，视频抽一帧。两条路都按 src 缓存，翻页不重算。
  // 空条目（库里还没有东西）没有地址可读，直接跳过。
  useEffect(() => {
    let live = true;
    if (!item.path) { setColors([]); return; }
    const read = item.kind === 'video' ? videoPalette : coverPalette;
    read(mediaSrc(item)).then(list => { if (live) setColors(list); });
    return () => { live = false; };
  }, [item]);

  // 彩胶的色从「正在听」那张封面来，不是从放映的画面上来。
  const discCover = disc?.cover ?? '';
  useEffect(() => {
    let live = true;
    if (!discCover) { setDiscColors([]); return; }
    coverPalette(discCover).then(list => { if (live) setDiscColors(list); });
    return () => { live = false; };
  }, [discCover]);

  useMarbleFilter();
  const tone = useMemo(() => collageTone(colors, hint), [colors, hint]);
  // 把取到的色板交给外层：配色面板要用它画「从这里挑一个」的色块。
  useEffect(() => { onPalette?.(colors); }, [colors, onPalette]);

  const counter = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;

  const discPressing = useMemo(() => recordPressing(disc?.key ?? 'idle', launchSeed), [disc?.key]);
  const discPalette = useMemo(() => vinylPalette(discColors, disc?.color ?? '#9a8b78'), [discColors, disc?.color]);

  const style = {
    '--tpl-base': tone.base,
    '--tpl-panel': tone.panel,
    '--tpl-bar': tone.bar,
    '--tpl-ink': tone.ink,
    '--tpl-ink-soft': tone.inkSoft,
    '--tpl-on-panel': tone.onPanel,
    '--tpl-on-bar': tone.onBar,
    '--disc-base': discPalette.base,
    '--disc-accent': discPalette.accent,
    '--disc-accent-2': discPalette.accent2,
    '--disc-groove': discPalette.groove,
    '--disc-sheen': discPalette.sheen,
    '--disc-angle': `${discPressing.angle}deg`,
  } as React.CSSProperties;

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
      onPlay={() => onPlayState(true)}
      onPause={() => onPlayState(false)}
    />
  ) : (
    <img key={item.id} src={mediaSrc(item)} alt={title} />
  );

  return (
    <div className={`template template-${preset.id}`} style={style} aria-label={`${preset.name}版式`}>
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
              <b className="tpl-title-text">{title || 'Untitled'}</b>
              <b className="tpl-sub">Picked</b>
              <b className="tpl-sub">Just for U</b>
            </div>

            {/* 竖排 DUMBRAVEN：两列（DUMB / RAVEN），装在面板右上那枚半透明胶囊里。
                右列从第 0 个字母起就比左列低半行，这是 AE 源里的错位，
                不是排版事故——所以下沉量写在 CSS 的 .tpl-badge-col-right 上。 */}
            <div className="tpl-tag">
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
            </div>

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
              className={`tpl-disc pressing-${discPressing.style} ${discPalette.light ? 'is-light' : ''} ${disc?.spinning ? 'spinning' : ''} ${disc ? 'has-disc' : ''}`}
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
              {/* 只列正在放的那一首。原先是把后面 9 首用顿号串成一段，
                  但这一条信息栏是「此刻在放什么」，不是播放列表本身——
                  那一整串同名曲目在放映画面上既不提供信息、又会挤满三行。 */}
              <span>{index + 1}. {title || 'Untitled'} - {BRAND}</span>
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
