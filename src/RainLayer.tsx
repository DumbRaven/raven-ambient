/**
 * 雨层。
 *
 * 用户要的是 AE 里 CC Mr. Mercury 那种「玻璃上滑落的水珠」：
 * 珠子有体积（边缘暗、中心亮）、透过它看到的画面被放大、滑过之处留一条竖直变形痕。
 *
 * 这里用 backdrop-filter 让珠子「透过去看」背后的内容：
 * 只做 SVG 湍流置换，把背后的画面真的掰弯。
 * 置换那一步是「像不像水」的分水岭——只有模糊和白色渐变的话，
 * 看起来永远是一张贴纸（这也是旧版被推翻的原因）。
 * 反过来，模糊也不能给：水是清的，一糊就成了磨砂玻璃球。
 * 让珠子像水的是「背景在珠子里明显错位、粗细不匀」那点不均匀，不是柔光。
 *
 * 两条踩过的坑：
 *
 * 1. 透明度必须挂在**每颗珠子**上，不能挂 .rain-layer。
 *    opacity < 1 的元素会创建 backdrop root，子孙的 backdrop-filter 只能采到
 *    该元素内部——而 .rain-layer 里除了珠子什么都没有，于是滤出来一片空白。
 *    实测（tools/probe/rain-root3.cjs，200×220 样本区）：
 *      珠子在 opacity:0.7 的层里 → 0.00% 像素有变化
 *      同一颗珠子挪到层外      → 43.56%
 *      把层 opacity 手动抬到 1 → 43.14%
 *    珠子自己挂 opacity:0.6 时滤镜照样工作（43.41%），所以下移没有副作用。
 *
 * 2. SVG filter 定义必须挂到 <body> 上。
 *    放在 .rain-layer（overflow:hidden）里时，Chromium 会把 filter 引用判为失效，
 *    computed 直接变成 none。挂到 body 后不受任何裁剪上下文影响，全文档唯一。
 */
import { useEffect, useMemo, type CSSProperties } from 'react';
import { drops, MAX_DROPS, type RainSetting } from './rain';

type Props = { value: RainSetting };

/** 雨丝的置换滤镜。见文件头第 2 条坑：必须挂在 <body> 上。 */
function useStreakFilter(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none';
    host.innerHTML =
      '<svg width="1" height="1">' +
      '<filter id="rain-streak-warp" x="-10%" y="-10%" width="120%" height="120%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.09" numOctaves="2" seed="7" result="noise"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="noise" scale="26" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
      // 水珠的折射。和雨丝那条分开，是因为参数要的是「一大块平滑的形变」：
      // 频率低（0.010）、幅度按珠子直径给 → 透过珠子看，背后的线条被掰成弧形。
      // 频率再高就会变成磨砂玻璃，纹理碎了但看不出水。
      // scale 不能大：它是位移的像素数。大珠直径约 90px，位移给到 40px 就等于
      // 把半颗珠子的画面搬到另一边，读出来是「皱褶」不是「透镜」。
      // 真实的水滴在边缘处最多把背景错开约半径的 15%，所以这里给 24。
      // 试过 42（太大，画面在珠子里皱成一团，读作皱褶不是透镜）与 14
      // （太小，与背景的错位看不出来，珠子退化成一圈淡环）。
      // seed 固定：每颗珠子用同一个形变场，才不会滑动时画面在里面乱跳。
      '<filter id="rain-refract" x="-25%" y="-25%" width="150%" height="150%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.010" numOctaves="2" seed="11" result="warp"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="warp" scale="24" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
      // 小水气用弱一档的位移：同样的 scale 在小面积上会显得抽搐。
      '<filter id="rain-refract-soft" x="-25%" y="-25%" width="150%" height="150%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="2" seed="11" result="warp"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="warp" scale="10" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
      '</svg>';
    document.body.appendChild(host);
    return () => { host.remove(); };
  }, [on]);
}

export default function RainLayer({ value }: Props) {
  const count = Math.round((value.strength / 100) * MAX_DROPS);
  // 只算一次：固定伪随机，调强度只是「多几颗 / 少几颗」，已有的不会跳位置
  const all = useMemo(() => drops(MAX_DROPS), []);
  const streakOn = value.on && (value.mode === 'streak' || value.mode === 'both');
  const slideOn = value.on && (value.mode === 'slide' || value.mode === 'both');
  useStreakFilter(streakOn || slideOn);

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
          {all.slice(0, count).map((drop, at) => {
            // 三档材质，分界线就是 rain.ts 里 radiusOf 的两道台阶：
            //   tiny（< 0.0105）：细密水气，只画边缘和暗环，不给折射——
            //     五个像素的珠子上折射看不出来，白付一层滤镜开销；
            //   small（< 0.021）：中珠，弱折射；
            //   big：大珠，强折射，能看清背后画面被掰弯的只有它们。
            const size = drop.radius < 0.0105 ? 'tiny' : drop.radius < 0.021 ? 'small' : 'big';
            return (
              <i
                key={at}
                data-kind={drop.kind}
                data-size={size}
                style={{
                  left: `${drop.x * 100}%`,
                  top: `${drop.y * 100}%`,
                  // 珠子大小按画面高度的百分比走，缩放窗口时比例不变
                  width: `${drop.radius * 100 * 2}vh`,
                  height: `${drop.radius * 100 * 2 * 1.12}vh`,
                  animationDelay: `${-drop.phase * drop.life}s`,
                  animationDuration: `${drop.life}s`,
                  // 透明度下移到珠子上。见文件头第 1 条坑：挂在层上会把折射废掉。
                  // 折射滤镜本身在 atmosphere.css 里按 data-size 选，见那里的注释。
                  '--drop-opacity': value.opacity / 100,
                } as CSSProperties}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
