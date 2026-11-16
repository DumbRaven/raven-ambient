// 播放台右侧那簇工具：版式、配色、图层、全屏。
//
// 为什么单独一个文件：块「有画面」和「空台面」是两支 JSX，而这簇工具
// 两支都要有——原先整簇在两个分支里各抄了一遍，约两百行逐字相同。
// 抄两遍的代价不是体积，是**改一处忘一处**：往配色菜单里加一档，
// 空台面里那份不会有。
//
// 三个菜单（配色 / 图层 / 版式）的开关状态仍留在 MediaRoom：
// 它们是「这次打开到哪了」，跟播放台的其它状态同生命周期，
// 搬进这里反而要往上传。这里只接收值与回调。
import type { Dispatch, SetStateAction } from 'react';
import { Maximize2, Minimize2, MonitorPlay, Palette } from 'lucide-react';
import TheaterLayers from './TheaterLayers';
import TheaterTemplates from './TheaterTemplates';
import { radioKeyDown } from './radio-keys';
import { defaultTone, normaliseHex, toneGroups, type ToneSetting } from './tone-setting';
import type { LayerList } from './layers';
import type { TemplateId } from './templates';

/** 一个「按钮 + 弹出菜单」的值、开关与写回。 */
type Menu<T> = {
  value: T;
  onChange: Dispatch<SetStateAction<T>>;
  open: boolean;
  onOpen: Dispatch<SetStateAction<boolean>>;
};

type Props = {
  template: TemplateId;
  onTemplate: (id: TemplateId) => void;
  /** 配色多一个「从这张画面里取出来的颜色」，见 MediaRoom 里的 palette。 */
  tone: Menu<ToneSetting> & { palette: string[] };
  layers: Menu<LayerList>;
  expanded: boolean;
  onFullscreen: () => void;
  desktopMode: boolean;
  onDesktop: boolean;
  onToggleDesktop: () => void;
  /** 拼贴版式的字号写死在 CSS 里，拖了也不会变，所以不出缩放手柄。 */
  scalabe: boolean;
};

export default function TheaterTools({
  template,
  onTemplate,
  tone: toneMenu,
  layers: layersMenu,
  expanded,
  onFullscreen,
  desktopMode,
  onDesktop,
  onToggleDesktop,
  scalabe,
}: Props) {
  const tone = toneMenu.value;
  const palette = toneMenu.palette;

  return (
    <>
      {/* 版式切换。三个都做得不一样，所以给文字而不是图标——
          图标认不出「相集」和「透明」的区别。滑块与量法见 TheaterTemplates。 */}
      <TheaterTemplates value={template} onChange={onTemplate} />

      {/* 配色：默认跟画面走，也可以指定主色或手填色值。 */}
      <div className="theater-tone">
        <button
          className={`icon-button theater-tone-toggle ${toneMenu.open ? 'on' : ''}`}
          aria-label="配色"
          aria-expanded={toneMenu.open}
          title="配色"
          onClick={() => toneMenu.onOpen(value => !value)}
        >
          <Palette size={13} />
        </button>
        {toneMenu.open && (
          <>
            <button className="theater-tone-veil" aria-label="收起配色" onClick={() => toneMenu.onOpen(false)} />
            <div className="theater-tone-menu" role="group" aria-label="配色">
              <div className="tone-modes" role="radiogroup" aria-label="取色方式" onKeyDown={radioKeyDown}>
                {(
                  [
                    ['auto', '跟随画面'],
                    ['pick', '挑一个'],
                    ['custom', '自己填'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={tone.mode === key}
                    className={tone.mode === key ? 'on' : ''}
                    onClick={() => toneMenu.onChange(prev => ({ ...prev, mode: key }))}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tone.mode === 'pick' && (
                <div className="tone-swatches" role="radiogroup" aria-label="从画面里挑一个主色" onKeyDown={radioKeyDown}>
                  {(palette.length ? palette : ['#6f6f6f']).map((color, at) => (
                    <button
                      key={color + at}
                      role="radio"
                      aria-checked={tone.pick === at}
                      aria-label={`画面主色 ${at + 1}`}
                      className={tone.pick === at ? 'on' : ''}
                      style={{ background: color }}
                      onClick={() => toneMenu.onChange(prev => ({ ...prev, pick: at }))}
                    />
                  ))}
                  <small>这张画面取出来的主色，点一个当主色相。</small>
                </div>
              )}

              {tone.mode === 'custom' && (
                <div className="tone-fields">
                  {/* 三组：信息条 / 面板 / 胶囊·署名。分组表在 tone-setting.ts，
                      这里只负责画——以后加一档颜色不用改这段 JSX。 */}
                  {toneGroups.map(group => (
                    <fieldset key={group.key} className="tone-group">
                      <legend>{group.title}</legend>
                      {group.fields.map(([key, label]) => (
                        <label key={key} className="tone-field">
                          <span>{label}</span>
                          <input
                            type="color"
                            value={tone.custom[key] || '#6f6f6f'}
                            aria-label={`${group.title}${label}颜色`}
                            onChange={event => toneMenu.onChange(prev => ({ ...prev, custom: { ...prev.custom, [key]: event.target.value } }))}
                          />
                          <input
                            className="tone-hex"
                            type="text"
                            inputMode="text"
                            maxLength={7}
                            placeholder="自动"
                            value={tone.custom[key]}
                            aria-label={`${group.title}${label}色值`}
                            onChange={event => {
                              const raw = event.target.value;
                              // 边输边认：认得出就收敛成 #rrggbb，认不出先原样留着，
                              // 否则输到一半（"#1c2"）就被吞掉字符，根本没法打。
                              const next = normaliseHex(raw);
                              toneMenu.onChange(prev => ({ ...prev, custom: { ...prev.custom, [key]: next || raw } }));
                            }}
                          />
                        </label>
                      ))}
                    </fieldset>
                  ))}
                  {/* 复位要连 mode 一起 —— 只清 custom 的话标签页仍停在「自己填」，
                      看着像什么都没发生。 */}
                  <button
                    className="tone-reset"
                    onClick={() => toneMenu.onChange(prev => ({ ...prev, mode: 'auto' as const, custom: { ...defaultTone.custom } }))}
                  >
                    全部回到自动
                  </button>
                </div>
              )}

              <p className="tone-hint">留空表示这一档仍然按画面算。</p>
            </div>
          </>
        )}
      </div>

      {/* 图层：一颗按钮、一份菜单，两个分支都能用。 */}
      <TheaterLayers
        layers={layersMenu.value}
        onLayers={layersMenu.onChange}
        open={layersMenu.open}
        onOpen={layersMenu.onOpen}
        scalabe={scalabe}
      />

      {/* 全屏键在透明版式下变成「放到桌面」。
          透明模式的意义就是把画面贴回桌面上看，这时候窗口全屏没有意义——
          两个按钮并排反而要用户自己判断该点哪个。 */}
      {desktopMode ? (
        <button
          className="icon-button theater-expand"
          aria-label={onDesktop ? '收回桌面放映' : '放到桌面'}
          aria-pressed={onDesktop}
          title={onDesktop ? '收回桌面放映' : '放到桌面'}
          onClick={onToggleDesktop}
        >
          <MonitorPlay size={13} />
        </button>
      ) : (
        <button className="icon-button theater-expand" aria-label={expanded ? '退出全屏' : '全屏'} aria-pressed={expanded} onClick={onFullscreen}>
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      )}
    </>
  );
}
