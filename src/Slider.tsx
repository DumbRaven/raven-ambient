import { type CSSProperties, useState } from 'react';

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
export default function Slider({ label, value, onChange, min = 0, max = 100, unit = '%' }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; unit?: string }) {
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
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commit((event.target as HTMLInputElement).value);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft(null);
                }
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
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
    </label>
  );
}
