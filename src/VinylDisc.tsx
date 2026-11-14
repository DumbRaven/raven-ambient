import { type CSSProperties, useEffect, useState } from 'react';
import { launchSeed } from './sleeves';
import { coverPalette, recordPressing, vinylPalette } from './vinyl';
import type { RecordItem } from './records';

/**
 * 黑胶本身：内圈始终是封面，外圈按封面取色做成彩色胶盘。
 * 没有封面时用唱片自己的颜色。
 *
 * 颜色是异步从封面图里取的（coverPalette 要解码图片），所以这里自己持有一份
 * 局部 state，而不是让父组件算好传下来——父组件重渲染时不该重算一遍调色板。
 */
export default function Vinyl({ record, color, cover, spinning = false }: { record?: RecordItem; color: string; cover?: string; spinning?: boolean }) {
  const pressing = recordPressing(record?.id ?? color, launchSeed);
  const [colors, setColors] = useState<string[]>([]);
  useEffect(() => {
    if (!cover) {
      setColors([]);
      return;
    }
    let active = true;
    void coverPalette(cover).then(palette => {
      if (active) setColors(palette);
    });
    return () => {
      active = false;
    };
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
  return (
    <span className={`vinyl pressing-${pressing.style} ${palette.light ? 'is-light' : ''} ${spinning ? 'spinning' : ''}`} style={style}>
      <span className="vinyl-label" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} />
      <i className="spindle" />
    </span>
  );
}
