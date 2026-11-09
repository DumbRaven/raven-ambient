/**
 * 控制条上那颗「叠加元素 / 组件」按钮。
 *
 * 为什么把两件事并成一颗：透明模式的「组件」和另外两套版式的「叠加元素」
 * 干的是同一件事——在画面上加一层能拖的东西，只是能加的东西不一样。
 * 并排两颗按钮会让人以为它们是两套独立功能，还得自己记住哪颗在哪套版式下有用。
 *
 * 用户原话（m11693）：「加组件和叠加元素现在重复了，如果确实只能用两套来实现，
 * 那就切换下面视频模式的时候自动把按钮的内容切换一下，就是虽然长得一样但是内容不一样」。
 * 所以外观一个（`Layers` 图标 + 同一套菜单样式），内容由 `mode` 决定。
 *
 * 菜单壳子、遮罩、开关点这些都是同一套 CSS（`.theater-overlays` / `-veil` / `-menu` /
 * `.overlay-dot`），合并后不需要再维护两份样式。
 */
import { Layers } from 'lucide-react';
import { overlays as overlayMetas, type Overlays } from './overlays';
import { addWidget, removeWidget, widgetLimit, widgetMetas, type WidgetList } from './widgets';

type Props = {
  /** 透明版式下管组件，其余版式管叠加元素。 */
  mode: 'overlay' | 'widgets';
  overlay: Overlays;
  onOverlay: (next: Overlays) => void;
  widgets: WidgetList;
  onWidgets: (next: WidgetList) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
};

export default function TheaterLayers({ mode, overlay, onOverlay, widgets, onWidgets, open, onOpen }: Props) {
  const label = mode === 'widgets' ? '组件' : '叠加元素';

  return (
    <div className="theater-overlays">
      <button
        className={`icon-button theater-overlay-toggle ${open ? 'on' : ''}`}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => onOpen(!open)}
      >
        <Layers size={13} />
      </button>
      {open && (
        <>
          <button className="theater-overlay-veil" aria-label="收起" onClick={() => onOpen(false)} />
          <div className="theater-overlay-menu" role="menu">
            {mode === 'widgets'
              ? widgetMetas.map(meta => {
                  const present = widgets.some(widget => widget.id === meta.id);
                  return (
                    <button
                      key={meta.id}
                      role="menuitemcheckbox"
                      aria-checked={present}
                      onClick={() => onWidgets(present ? removeWidget(widgets, meta.id) : addWidget(widgets, meta.id))}
                    >
                      <span className={`overlay-dot ${present ? 'on' : ''}`} aria-hidden="true" />
                      <span>
                        <b>{meta.name}</b>
                        <small>{meta.hint}</small>
                      </span>
                    </button>
                  );
                })
              : overlayMetas.map(meta => (
                  <button
                    key={meta.id}
                    role="menuitemcheckbox"
                    aria-checked={overlay[meta.id].on}
                    onClick={() => onOverlay({ ...overlay, [meta.id]: { ...overlay[meta.id], on: !overlay[meta.id].on } })}
                  >
                    <span className={`overlay-dot ${overlay[meta.id].on ? 'on' : ''}`} aria-hidden="true" />
                    <span>
                      <b>{meta.name}</b>
                      <small>{meta.hint}</small>
                    </span>
                  </button>
                ))}
            <p className="theater-overlay-tip">
              {mode === 'widgets'
                ? (widgets.length >= widgetLimit ? '已经放满了。' : '加上去之后，在画面里按住它就能拖。')
                : '打开之后，在画面里按住它拖动就能换位置。'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
