/**
 * 控制条上那颗「图层」按钮。
 *
 * 以前这里是两颗（「叠加元素」和「加组件」），干的却是同一件事——在画面上加一层
 * 能拖的东西，只是能加的东西不一样。用户 m11693 让它们合一，m12005 又问
 * 「加组件和叠加元素能完全一套吗」——能，所以现在连数据都只有一份 `LayerList`，
 * 这颗按钮也就只剩一个模式了。
 *
 * 菜单壳子、遮罩、开关点沿用同一套 CSS（`.theater-overlays` / `-veil` / `-menu` /
 * `.overlay-dot`），只有那行提示随版式变：透明版式说「加上去」，其余说「打开之后」。
 */
import { Layers } from 'lucide-react';
import { addLayer, canAddLayer, layerLimit, layerMetas, removeLayer, type LayerList } from './layers';

type Props = {
  layers: LayerList;
  onLayers: (next: LayerList) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  /**
   * 当前这套版式能不能改大小。
   *
   * 拼贴改不了（用户 m11244：那套字号写死），所以不能对拼贴说
   * 「右下角那点改大小」——用户 m12760 第 4 条说的「说明文字不匹配」
   * 就是这类：话还在，能做的动作已经没了。
   *
   * 原来这里传的是 `desktop`，只为把提示分成「加上去之后」和「打开之后」
   * 两种说法。但那两种说法指向同一个动作（点菜单项才加上去，没有「打开」），
   * 分开写反而是错的。现在按「能不能改大小」分岔。
   */
  scalabe: boolean;
};

export default function TheaterLayers({ layers, onLayers, open, onOpen, scalabe }: Props) {
  return (
    <div className="theater-overlays">
      <button
        className={`icon-button theater-overlay-toggle ${open ? 'on' : ''}`}
        aria-label="图层"
        aria-expanded={open}
        title="图层"
        onClick={() => onOpen(!open)}
      >
        <Layers size={13} />
      </button>
      {open && (
        <>
          <button className="theater-overlay-veil" aria-label="收起" onClick={() => onOpen(false)} />
          <div className="theater-overlay-menu" role="menu">
            {layerMetas.map(meta => {
              const present = layers.some(layer => layer.id === meta.id);
              const full = !present && !canAddLayer(layers, meta.id);
              return (
                <button
                  key={meta.id}
                  role="menuitemcheckbox"
                  aria-checked={present}
                  disabled={full}
                  onClick={() => onLayers(present ? removeLayer(layers, meta.id) : addLayer(layers, meta.id))}
                >
                  <span className={`overlay-dot ${present ? 'on' : ''}`} aria-hidden="true" />
                  <span>
                    <b>{meta.name}</b>
                    <small>{meta.hint}</small>
                  </span>
                </button>
              );
            })}
            <p className="theater-overlay-tip">
              {layers.length >= layerLimit
                ? '已经放满了。'
                : scalabe
                  ? '按住它拖换位置，右下角那点改大小。'
                  : '按住它拖换位置。'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
