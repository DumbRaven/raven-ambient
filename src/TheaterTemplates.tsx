import { useLayoutEffect, useRef } from 'react';
import { templates, type TemplateId } from './templates';

/**
 * 版式切换那一排胶囊（拼贴 / 相集 / 透明）。
 *
 * 为什么不用「给选中的那颗换背景色」：三套版式的差别是**整块画面**在换，
 * 背景色跟着换只是换了个色块，看不出「换到了另一套」。滑块要滑过去，
 * 才会让人把那一下和自己刚看到的画面变化连起来。
 *
 * 做法照抄唱片柜的筛选胶囊（`.filter-tabs` / `.flip-marker`）：一颗绝对定位的
 * 白底胶囊，位置由 JS 量出来写进 `--marker-x` / `--marker-width`，CSS 负责过渡。
 * 量的是 `offsetLeft` / `offsetWidth` 而不是 `getBoundingClientRect()`——
 * 全屏时外层 `.view-stage` 带着 `transform: scale()`，量出来会小一圈。
 */
export default function TheaterTemplates({
  value,
  onChange,
}: {
  value: TemplateId;
  onChange: (next: TemplateId) => void;
}) {
  const group = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = group.current;
    if (!host) return;
    const sync = () => {
      const active = host.querySelector<HTMLElement>('button.on');
      if (!active) return;
      host.style.setProperty('--marker-x', `${active.offsetLeft}px`);
      host.style.setProperty('--marker-width', `${active.offsetWidth}px`);
    };
    sync();
    // 第一次量完之前不许有过渡，否则滑块会从最左边「飞」过来。
    const ready = requestAnimationFrame(() => {
      host.dataset.ready = 'true';
    });
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    host.querySelectorAll('button').forEach(button => observer.observe(button));
    return () => {
      cancelAnimationFrame(ready);
      observer.disconnect();
    };
  }, [value]);

  return (
    <div ref={group} className="theater-templates" role="group" aria-label="版式">
      <span className="template-marker" aria-hidden="true" />
      {templates.map(preset => (
        <button
          key={preset.id}
          aria-pressed={value === preset.id}
          className={value === preset.id ? 'on' : ''}
          title={preset.hint}
          onClick={() => onChange(preset.id)}
        >
          {preset.name}
        </button>
      ))}
    </div>
  );
}
