import { type CSSProperties, type RefObject } from 'react';
import { ImagePlus, LoaderCircle, RotateCcw } from 'lucide-react';
import Slider from './Slider';
import { radioKeyDown } from './radio-keys';
import { formatTime } from './model';
import { trackTransitions, transitionHints, transitionNames, type Cabinet, type TrackTransition } from './records';

/**
 * 设置面板：空间颜色、音量、外部音乐、换片方式、存储清理、定时休息。
 *
 * 每一项都是「一件具体的事」，所以按组排，不放总说明——用户是来找某一项的，
 * 不是来读目录的。说明文字只在「为什么值得做」这一层出现（比如清理只删封面图）。
 */
export default function SettingsModal({ cabinet, busy, background, lineError, status, sleepUntil, remaining, imageInput, onChange, onClearBackground, onToggleLineMode, onClearCoverCache, onSetSleep }: {
  cabinet: Cabinet;
  busy: string;
  background: string;
  lineError: string;
  status: { lineInput: number; ducked: boolean; lineLive: boolean };
  sleepUntil: number;
  remaining: number;
  imageInput: RefObject<HTMLInputElement | null>;
  onChange: (changes: Partial<Cabinet>) => void;
  onClearBackground: () => void;
  onToggleLineMode: (next: boolean) => void;
  onClearCoverCache: () => void;
  onSetSleep: (raw: string) => void;
}) {
  return (
    <>
      <h2 id="modal-title">设置</h2>

      <div className="settings-group">
        <h3>空间的颜色</h3>
        <button className="secondary-button full-width" disabled={!!busy} onClick={() => imageInput.current?.click()}>
          <ImagePlus size={15} />
          {busy || '选择背景照片'}
        </button>
        {background && (
          <button className="text-button" disabled={!!busy} onClick={onClearBackground}>
            <RotateCcw size={12} />
            恢复默认背景
          </button>
        )}
      </div>

      <div className="settings-group">
        <h3>声音的分寸</h3>
        <Slider label="音乐总音量" value={cabinet.musicVolume} onChange={musicVolume => onChange({ musicVolume })} />
      </div>

      <div className="settings-group">
        <h3>外部音乐</h3>
        <p>
          把播放器的输出切到 CABLE Input，再打开下面的开关。<span>外部音乐会在响起时压低环境音。</span>
        </p>
        <label className="line-mode-toggle">
          <input type="checkbox" checked={cabinet.lineMode} onChange={e => onToggleLineMode(e.target.checked)} />
          <span className="line-mode-switch" aria-hidden="true" />
          <span className="line-mode-copy">
            <b>外部音乐模式</b>
            <small>{cabinet.lineMode ? '音乐来自外部播放器，这里只留环境音' : '关着的时候播放本地唱片'}</small>
          </span>
        </label>
        {cabinet.lineMode && (
          <div className="line-in-meter" aria-label="外部音乐电平">
            <span style={{ '--level': `${Math.round(status.lineInput * 100)}%` } as CSSProperties} />
            <small>
              {status.lineInput > 0.02
                ? status.ducked
                  ? '收到外部音乐 · 环境音正在退让'
                  : '收到外部音乐 · 环境音没有退让'
                : /* 设备被拔掉、或者被别的程序抢走之后，lineLive 会变 false，
                     而 lineInput 在没声音的时候本来就一直是 0——只读 lineInput
                     的话，「已接上虚拟声卡，等待声音」这句话在源断开后照样成立，
                     用户会一直等一个已经不可能来的声音。 */
                  status.lineLive
                  ? '已接上虚拟声卡，等待声音'
                  : '虚拟声卡断开了 · 关掉再打开这个开关可以重连'}
            </small>
          </div>
        )}
        {cabinet.lineMode && (
          <label className="line-volume">
            <span>外部音乐音量</span>
            <input type="range" min={0} max={100} value={cabinet.lineVolume} aria-label="外部音乐音量" onChange={e => onChange({ lineVolume: Number(e.target.value) })} style={{ '--fill': `${cabinet.lineVolume}%` } as CSSProperties} />
            <small>{cabinet.lineVolume}%</small>
          </label>
        )}
        {lineError && (
          <div className="line-in-error" role="alert">
            <p>{lineError}</p>
            {/* 失败之后没有出路，用户只能关掉设置再开一遍。
                这个按钮就是那条出路：连着上一次失败的原因再试一次。 */}
            <button type="button" className="text-button" disabled={!!busy} onClick={() => onToggleLineMode(true)}>
              <RotateCcw size={12} />
              再试一次
            </button>
          </div>
        )}
      </div>

      <div className="settings-group">
        <h3>换唱片的方式</h3>
        <div className="transition-options" role="radiogroup" aria-label="换唱片的方式" onKeyDown={radioKeyDown}>
          {trackTransitions.map(value => (
            <button key={value} type="button" role="radio" aria-checked={cabinet.transition === value} className={cabinet.transition === value ? 'selected' : ''} onClick={() => onChange({ transition: value as TrackTransition })}>
              <strong>{transitionNames[value]}</strong>
              <small>{transitionHints[value]}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <h3>存储</h3>
        <p>
          换过封面之后，旧的那张还留在本地。<span>清理只删这些不再被引用的封面图，音频和唱片一张都不会动。</span>
        </p>
        <button className="secondary-button full-width" disabled={!!busy} onClick={onClearCoverCache}>
          {busy ? <LoaderCircle size={15} className="loading-spin" /> : <RotateCcw size={15} />}
          {busy || '清理封面缓存'}
        </button>
      </div>

      <div className="settings-group">
        <h3>定时休息</h3>
        <label className="sleep-select">
          在这之后停止全部声音
          <select aria-label="定时休息" value={sleepUntil ? 'active' : '0'} onChange={e => onSetSleep(e.target.value)}>
            {sleepUntil > 0 && <option value="active">剩余 {formatTime(remaining)}</option>}
            <option value="0">不设定时</option>
            <option value="15">15 分钟</option>
            <option value="30">30 分钟</option>
            <option value="60">60 分钟</option>
            <option value="90">90 分钟</option>
          </select>
        </label>
      </div>

      <p className="import-help">
        你的音频、封面和介绍仅保存在这台设备。
        <br />
        Raven Ambient · 0.3.3
      </p>
    </>
  );
}
