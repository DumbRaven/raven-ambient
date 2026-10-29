/**
 * 把「正在听的那张碟」翻译成小窗能画的形状。
 *
 * 小窗是独立渲染进程，加载的是 electron/mini.html，既没有 React 也没有
 * skin-bold.css，还受 CSP 限制（只认 data: 图片）。所以这里做两件事：
 * 把封面转成 data: 地址，把彩胶的颜色算好一起交出去。
 *
 * 之所以单独成文件而不是塞进 FocusRoom：取色要跑 canvas、要读 blob，
 * 属于「现在在放什么」的知识，FocusRoom 不该关心。
 */
import { useEffect, useRef, useState } from 'react';
import type { MiniDisc } from './focus-bridge';
import { miniArt } from './focus-bridge';
import { coverPalette, recordPressing, vinylPalette } from './vinyl';
import { launchSeed } from './sleeves';

/** 外面只需要告诉它「现在放的是谁」，其余都在这儿算。 */
export type DiscSource = {
  /** 身份：换了这个值就说明换碟了，小窗据此播切换动画。 */
  key: string;
  /** 封面地址（blob: 或 svg 路径），没有就留空。 */
  cover?: string;
  /** 没有封面时取色用的兜底色。 */
  color: string;
  spinning: boolean;
};

export function useMiniDisc(source: DiscSource | null): MiniDisc | null {
  const [disc, setDisc] = useState<MiniDisc | null>(null);

  // 这些依赖全是原始值，所以父组件每帧重渲染也不会把 effect 抖起来。
  const key = source?.key ?? '';
  const cover = source?.cover ?? '';
  const color = source?.color ?? '';
  const spinning = source?.spinning ?? false;
  // 取色是异步的，等它回来时下面那个同步 effect 早就跑完了。
  // 所以把最新的 spinning 存在 ref 里，取色完成时读它，而不是读 state（那时还是 null）。
  const spinningRef = useRef(spinning);
  spinningRef.current = spinning;

  useEffect(() => {
    if (!key) { setDisc(null); return; }
    let active = true;

    void (async () => {
      // 取色和转图并行：两件事互不依赖，串着等会白白多花一截时间。
      const [colors, art] = await Promise.all([
        cover ? coverPalette(cover) : Promise.resolve([]),
        miniArt(cover),
      ]);
      if (!active) return;
      const pressing = recordPressing(key, launchSeed);
      const palette = vinylPalette(colors, color);
      setDisc({
        key,
        art,
        pressing: pressing.style,
        base: palette.base,
        accent: palette.accent,
        accent2: palette.accent2,
        sheen: palette.sheen,
        angle: pressing.angle + 'deg',
        light: palette.light,
        spinning: spinningRef.current,
      });
    })();

    return () => { active = false; };
  }, [key, cover, color]);

  // 播放/暂停只改 spinning，不用重新取色。单独同步一次，免得按一下暂停就重跑上面那趟。
  useEffect(() => {
    setDisc(current => (current && current.spinning !== spinning ? { ...current, spinning } : current));
  }, [spinning]);

  return disc;
}
