import { useEffect, useState, type CSSProperties } from 'react';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

type Props = {
  /** 要显示的非负整数 */
  value: number;
  /** 至少显示几位，1 表示不补零，2 表示补到 00 */
  minDigits?: number;
};

/**
 * 滚动数字。视觉上是一列 0-9 竖排、只露一个窗口，靠 translateY 滚到目标位。
 * 驱动它的是 <number> 型自定义属性 --roll：浏览器对它逐帧插值，
 * 换成 <integer> 会退化成逐档跳变（实测 5 个取值、156ms 就跳完），不要改。
 */
export default function RollNumber({ value, minDigits = 1 }: Props) {
  // 首帧不要动画：挂载时 --roll 从 initial-value 0 过渡到目标值会看见一次滚动。
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const safe = Math.max(0, Math.floor(value));
  const text = String(safe).padStart(minDigits, '0');
  const digits = text.split('').map(Number);

  return (
    <span className="roll-number" data-roll-ready={ready ? 'true' : undefined}>
      <span className="roll-digits" aria-hidden="true">
        {digits.map((digit, index) => (
          <span className="roll-col" key={index} style={{ '--roll': digit } as CSSProperties}>
            {DIGITS.map(d => <b key={d}>{d}</b>)}
          </span>
        ))}
      </span>
      {/* 视觉隐藏的真实文本，供屏幕阅读器读取。必须留在 .roll-number 内部，
          否则绝对定位会一路找到更外层的祖先，撑出滚动条。 */}
      <span className="roll-text">{text}</span>
    </span>
  );
}
