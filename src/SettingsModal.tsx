import { type CSSProperties, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, RotateCcw } from 'lucide-react';
import Slider from './Slider';
import { radioKeyDown } from './radio-keys';
import { formatTime } from './model';
import { trackTransitions, transitionHints, transitionNames, type Cabinet, type TrackTransition } from './records';
import { checkForUpdate, openDownload } from './update-bridge';
import { noCableHint } from './line-in';
import type { UpdateReply } from './update-state';

/**
 * 设置面板：空间颜色、音量、外部音乐、换片方式、存储清理、定时休息。
 *
 * 每一项都是「一件具体的事」，所以按组排，不放总说明——用户是来找某一项的，
 * 不是来读目录的。说明文字只在「为什么值得做」这一层出现（比如清理只删封面图）。
 */
export default function SettingsModal({ cabinet, busy, background, lineError, noCable, status, sleepUntil, remaining, imageInput, onChange, onClearBackground, onToggleLineMode, onClearCoverCache, onSetSleep }: {
  cabinet: Cabinet;
  busy: string;
  background: string;
  lineError: string;
  /** 这台机器没装虚拟声卡。与 lineError 互斥：它不占用带「再试一次」的错误块。 */
  noCable: boolean;
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
  /**
   * 检查更新的状态。
   *
   * 打开面板就静默查一次（用户不点也能看到结果），点按钮是手动重查。
   * `checking` 与 `note` 都只在**手动**那次置上：静默那次是用户没要求过的动作，
   * 界面先动起来才是噪音。
   *
   * `note` 只记手动那次的结局，因为「已经是最新」与「根本没查」在画面上没有区别——
   * 用户点完必须拿到一句话，否则只能靠按钮抖一下来猜结论。2026-11-18 用户报的
   * 「点击后抖动一下但没看见变化，是不是结果只停留一瞬间」就是这件事：改了按钮
   * 文字又改回来，而 current/unknown 两种结局在旧实现里一个字都不显示。
   */
  const [update, setUpdate] = useState<UpdateReply | null>(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<'current' | 'unknown' | null>(null);

  /**
   * 手动那次是否还没回来。
   *
   * 用 ref 而不是读 `checking`：`runCheck` 的依赖必须保持空数组，否则下面那个
   * effect 会跟着 `checking` 翻转重跑，「打开面板查一次」会变成「每次检查都重查一遍」。
   */
  const manualInFlight = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (manual) {
      // 重复点击直接吞掉，不做禁用：`button:disabled { opacity: .35 }` 是全局规则，
      // 禁用态等于整个按钮变淡一下，那正是要消掉的抖动。
      if (manualInFlight.current) return;
      manualInFlight.current = true;
      setChecking(true);
      setNote(null);
    }
    const reply = await checkForUpdate();
    setUpdate(reply);
    if (manual) {
      manualInFlight.current = false;
      setChecking(false);
      // newer 有自己的画面（版本号 + 去下载），不需要这行字。
      setNote(reply.result.status === 'newer' ? null : reply.result.status);
    }
  }, []);

  // 静默查一次。空依赖：面板每次打开都是新挂载，这一次就是「打开时查一次」。
  useEffect(() => { void runCheck(false); }, [runCheck]);

  const newer = update?.result.status === 'newer' ? update.result : null;
  const version = update?.current ?? '';

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
          {noCable
            ? <>装好之后，把播放器的输出切到 CABLE Input。<span>外部音乐会在响起时压低环境音。</span></>
            : <>把播放器的输出切到 CABLE Input，再打开下面的开关。<span>外部音乐会在响起时压低环境音。</span></>}
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
                     用户会一直等一个已经不可能来的声音。
                     往下分三种，各自只占一行、互不重复：
                     - lineError：可重试的失败（权限/占用/格式）。具体原因和「再试一次」
                       在下面的错误块里，这里只说状态，否则同一件事说两遍。
                       措辞必须是中性的「没接通」而不是「没接上声卡」——这三种失败里
                       声卡是装着的，说成没装就成了假话（用户会去重装一个已经装好的东西）。
                     - noCable：这台机器没装虚拟声卡。它不是失败，是常态，所以没有
                       「再试一次」——点了必然再失败。说明怎么办的那句话并进 state。
                     - 其余：连上过但断了，重连有意义，才让人去关开一次。 */
                  lineError
                  ? '外部音乐没有接通'
                  : noCable
                  ? noCableHint
                  : status.lineLive
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
        <h3>版本</h3>
        {/*
          有新版的画面就是这一组：一句新版本号 + 一个「去下载」。
          没有新版时按钮文字与状态都不变，结论写在按钮下面那行 `.update-note` 里。

          为什么改成了「按钮不动、结果另起一行」（2026-11-18）：
          原来按钮在「检查更新 ↔ 正在检查…」之间换字、还顺手 disabled，而
          `button:disabled { opacity: .35 }` 是全局规则，于是点一下整个按钮淡下去又弹回来——
          用户看到的就是「抖一下」。更要紧的是 `current`（已是最新）与 `unknown`（查不到）
          两种结局在旧实现里一个字都不显示，用户分不清「查完了没事」和「根本没查」。
          换字改成不动字，是因为结果本身要先说清楚；按钮尺寸与透明度全程不变。

          为什么版本号不写在这句里：它是异步拿到的（主进程 app.getVersion()），
          写在这里会让面板打开的头一两秒显示「当前版本 —。」，那是不该有的闪烁。
          版本号放在最底部那行固定文案里，拿到了才出现。
        */}
        {newer ? (
          <>
            <p>新版 {newer.version} 可以下载了。</p>
            <button className="secondary-button full-width" onClick={openDownload}>
              去下载
            </button>
          </>
        ) : (
          <>
            <button className="secondary-button full-width" onClick={() => void runCheck(true)}>
              检查更新
            </button>
            {/* 高度常驻，避免「出现/消失」把下面几组顶下去。 */}
            <p className="update-note" aria-live="polite">
              {checking ? '正在检查…' : note === 'current' ? '已经是最新版本。' : note === 'unknown' ? '没能查到，稍后再试。' : ''}
            </p>
          </>
        )}
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
        {/* 版本号由主进程给（app.getVersion()）。没拿到（探针环境没有 preload）时整行不出现，
            不留一个「—」在那——那比没有更让人困惑。 */}
        {version ? <><br />Raven Ambient · {version}</> : null}
      </p>
    </>
  );
}
