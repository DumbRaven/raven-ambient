/**
 * 雨层。
 *
 * 用户要的是 AE 里 CC Mr. Mercury 那种「玻璃上滑落的水珠」：
 * 珠子有体积（边缘暗、中心亮）、透过它看到的画面被放大、滑过之处留一条竖直变形痕。
 *
 * 做真折射需要把背后的 DOM 画进纹理再用着色器采样，代价太大；
 * 这里用 backdrop-filter 反过来做同一件事——
 * 让珠子「透过去看」背后内容并轻微放大提亮，视觉上就是凸透镜。
 * 雨丝则用 SVG 的湍流位移做真折射，它作用在自己那一层，不需要背景纹理。
 */
import { useEffect, useMemo, type CSSProperties } from 'react';
import { drops, type RainSetting } from './rain';

type Props = { value: RainSetting };

/** 雨丝的置换滤镜。
 *  必须挂在 <body> 上：放在 .rain-layer（overflow:hidden）里时，
 *  Chromium 会把这个 filter 引用判为失效，computed 变成 none。
 *  挂到 body 后它不受任何裁剪上下文影响，全文档唯一。 */
function useStreakFilter(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none';
    host.innerHTML =
      '<svg width="1" height="1"><filter id="rain-streak-warp" x="-10%" y="-10%" width="120%" height="120%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.09" numOctaves="2" seed="7" result="noise"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="noise" scale="26" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter></svg>';
    document.body.appendChild(host);
    return () => { host.remove(); };
  }, [on]);
}

export default function RainLayer({ value }: Props) {
  const count = Math.round((value.strength / 100) * 120);
  // 只算一次：固定伪随机，调强度只是「多几颗 / 少几颗」，已有的不会跳位置
  const all = useMemo(() => drops(120), []);
  const streakOn = value.on && (value.mode === 'streak' || value.mode === 'both');
  useStreakFilter(streakOn);

  if (!value.on) return null;

  const slide = value.mode === 'slide' || value.mode === 'both';
  const streak = value.mode === 'streak' || value.mode === 'both';

  return (
    <div
      className="rain-layer"
      aria-hidden="true"
      data-mode={value.mode}
      style={{ '--rain-opacity': value.opacity / 100, '--rain-strength': value.strength / 100 } as CSSProperties}
    >
      {streak && (
        <div
          className="rain-streak"
          style={{ filter: streakOn ? 'url(#rain-streak-warp)' : undefined }}
        />
      )}
      {slide && (
        <div className="rain-drops">
          {all.slice(0, count).map((drop, at) => (
            <i
              key={at}
              style={{
                left: `${drop.x * 100}%`,
                top: `${drop.y * 100}%`,
                // 珠子大小按画面高度的百分比走，缩放窗口时比例不变
                width: `${drop.radius * 100 * 2}vh`,
                height: `${drop.radius * 100 * 2 * 1.12}vh`,
                animationDelay: `${-drop.phase * drop.life}s`,
                animationDuration: `${drop.life}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
