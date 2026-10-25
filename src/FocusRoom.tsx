import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import {
  clock,
  applyFocusSettings,
  focusDuration,
  elapsedFraction,
  focusMinutes,
  focusPresets,
  focusStats,
  initialFocusState,
  pauseFocus,
  phaseCaptions,
  phaseNames,
  remainingFocus,
  resetFocus,
  sanitizeFocusHistory,
  sanitizeFocusSettings,
  skipFocus,
  startFocus,
  tickFocus,
  type FocusRecord,
  type FocusSettings,
  type FocusState,
} from './focus';
import { getText, setText } from './store.ts';

const SETTINGS_KEY = 'raven-focus-settings-v1';
const HISTORY_KEY = 'raven-focus-history-v1';
const BASE_TITLE = 'Raven Ambient Bold · 唱片柜';

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = getText(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    setText(key, JSON.stringify(value));
  } catch {
    // 存储写满时只丢持久化，不让计时中断。
  }
}

function loadSettings(): FocusSettings {
  return sanitizeFocusSettings(readStore<unknown>(SETTINGS_KEY, null));
}

function loadHistory(): FocusRecord[] {
  return sanitizeFocusHistory(readStore<unknown>(HISTORY_KEY, []));
}

/** 三声上行铃：比环境音明显，但仍是轻铃，不刺耳。
 */
function ringChime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const start = ctx.currentTime;
    ([
      [784, 0],
      [1046.5, 0.22],
      [1318.5, 0.44],
    ] as const).forEach(([frequency, delay]) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start + delay);
      gain.gain.linearRampToValueAtTime(0.16, start + delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.7);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start + delay);
      oscillator.stop(start + delay + 0.75);
    });
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1800);
  } catch {
    // 没有音频上下文就不响，计时照常。
  }
}

function FineDial({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (next: number) => void;
}) {
  return (
    <label className="slider-field">
      <span>
        {label}
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
    </label>
  );
}

export type FocusRoomProps = {
  /** 专注视图是否可见；不可见时计时继续，但不占用空格键。
 */
  active: boolean;
  playing: boolean;
  hasSelection: boolean;
  onPlaySelection: () => void;
  onNotice: (text: string) => void;
};

export default function FocusRoom({ active, playing, hasSelection, onPlaySelection, onNotice }: FocusRoomProps) {
  const [settings, setSettings] = useState<FocusSettings>(loadSettings);
  const [records, setRecords] = useState<FocusRecord[]>(loadHistory);
  const [state, setState] = useState<FocusState>(() => initialFocusState(loadSettings()));
  const [now, setNow] = useState(() => Date.now());
  const finishing = useRef(false);

  const total = focusDuration(state, settings);
  const remaining = remainingFocus(state, now);
  const fraction = elapsedFraction(state, settings, now);
  const stats = focusStats(records, now);
  const roundsBeforeLong = state.session?.roundsBeforeLong ?? settings.roundsBeforeLong;
  const chapter = Math.min(state.rounds + 1, roundsBeforeLong);

  useEffect(() => {
    if (!state.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.running]);

  useEffect(() => {
    if (!state.running) return;
    const tick = tickFocus(state, settings, now);
    if (!tick.finished || finishing.current) return;
    finishing.current = true;
    setState(tick.state);
    const { record, phase } = tick.finished;
    if (record) {
      const next = [...records, record];
      setRecords(next);
      writeStore(HISTORY_KEY, next);
      onNotice(`这一轮专注完成了。${phaseNames[tick.state.phase]} ${focusMinutes(settings, tick.state.phase)} 分钟。`);
    } else {
      onNotice(`${phaseNames[phase]}结束，回到专注。`);
    }
    if (settings.chime) ringChime();
    finishing.current = false;
  }, [now, state, settings, records, onNotice]);

  useEffect(() => {
    document.title = state.running ? `${clock(remainingFocus(state, now))} · ${phaseNames[state.phase]} · Raven` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [state, now]);

  const toggle = useCallback(() => {
    const at = Date.now();
    setNow(at);
    setState((current) =>
      current.running ? pauseFocus(current, at) : startFocus(current, settings, at),
    );
  }, [settings]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
      event.preventDefault();
      if (event.repeat) return;
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, toggle]);

  function applySettings(patch: Partial<FocusSettings>) {
    const next = sanitizeFocusSettings({ ...settings, ...patch });
    setSettings(next);
    writeStore(SETTINGS_KEY, next);
    setState((current) => applyFocusSettings(current, next));
  }

  function begin() {
    const at = Date.now();
    setNow(at);
    if (!playing && hasSelection) onPlaySelection();
    setState((current) => startFocus(current, settings, at));
  }

  const primaryLabel = state.running ? '暂停' : remaining < total ? '继续' : state.phase === 'focus' ? '开始专注' : '开始休息';

  return (
    <section className="focus-room" aria-label="专注计时">
      <div className="focus-layout">
        <div className="focus-stage">
          <div className="focus-head">
            <span className="notes-eyebrow">
              FOCUS SESSION <span>{String(chapter).padStart(2, '0')} / {String(roundsBeforeLong).padStart(2, '0')}</span>
            </span>
            <span className="focus-mode">专注</span>
          </div>
          <div className={`focus-dial${state.running ? ' is-running' : ''}${state.phase === 'focus' ? '' : ' is-break'}`}>
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle className="focus-track" cx="100" cy="100" r="94" />
              <circle
                className="focus-progress"
                cx="100"
                cy="100"
                r="94"
                strokeDasharray={2 * Math.PI * 94}
                strokeDashoffset={2 * Math.PI * 94 * (1 - fraction)}
              />
            </svg>
            <div className="focus-readout">
              <span className="focus-phase">{phaseCaptions[state.phase]}</span>
              <strong className="focus-time" role="timer" aria-label={`剩余 ${clock(remaining)}`}>
                {clock(remaining)}
              </strong>
              <span className="focus-caption">
                {phaseNames[state.phase]} · {total / 60_000} 分钟
              </span>
            </div>
          </div>
          <div className="focus-actions" onKeyDown={event => { if (event.repeat && event.key === 'Enter') event.preventDefault(); }}>
            <button className="primary-button" onClick={state.running ? toggle : begin}>
              {state.running ? <Pause size={14} /> : <Play size={14} />}
              {primaryLabel}
            </button>
            <button
              className="secondary-button"
              onClick={() => setState((current) => resetFocus(current, settings))}
              aria-label="重置本轮"
            >
              <RotateCcw size={14} />
            </button>
            <button
              className="secondary-button"
              onClick={() => setState((current) => skipFocus(current, settings))}
              aria-label={`跳过${phaseNames[state.phase]}`}
            >
              <SkipForward size={14} />
            </button>
          </div>
          <p className="focus-hint">
            {playing
              ? '声音正在陪你。空格暂停或继续。'
              : hasSelection
                ? '带着所选声音开始，一秒进入状态。按空格也能开始。'
                : '先去唱片柜挑一张，专注时就有声音陪着。按空格也能开始。'}
          </p>
          {!playing && hasSelection && (
            <button className="text-button focus-play" onClick={onPlaySelection}>
              播放所选声音<ArrowRight size={12} />
            </button>
          )}
        </div>

        <aside className="focus-notes">
          <div className="notes-eyebrow">
            TODAY <span>↗</span>
          </div>
          <div className="focus-numbers">
            <div>
              <strong>{stats.todayCount}</strong>
              <span>完成的番茄</span>
            </div>
            <div>
              <strong>{stats.todayMinutes}</strong>
              <span>专注分钟</span>
            </div>
          </div>
          <p className="focus-line">
            累计 {stats.totalCount} 个番茄 · {stats.totalMinutes} 分钟。数据只存在本机，随时可清空。
          </p>
          <div className="fine-rule" />
          <h3>这次的节奏</h3>
          <div className="focus-presets">
            {focusPresets.map((preset) => {
              const chosen =
                settings.focusMinutes === preset.focusMinutes && settings.shortBreakMinutes === preset.shortBreakMinutes;
              return (
                <button
                  key={preset.id}
                  className={chosen ? 'chosen' : ''}
                  aria-pressed={chosen}
                  onClick={() =>
                    applySettings({ focusMinutes: preset.focusMinutes, shortBreakMinutes: preset.shortBreakMinutes })
                  }
                >
                  {preset.name}
                </button>
              );
            })}
          </div>
          <FineDial
            label="专注"
            value={settings.focusMinutes}
            min={5}
            max={120}
            step={5}
            unit=" 分钟"
            onChange={(focusMinutes) => applySettings({ focusMinutes })}
          />
          <FineDial
            label="小憩"
            value={settings.shortBreakMinutes}
            min={1}
            max={30}
            step={1}
            unit=" 分钟"
            onChange={(shortBreakMinutes) => applySettings({ shortBreakMinutes })}
          />
          <FineDial
            label="长休息"
            value={settings.longBreakMinutes}
            min={5}
            max={60}
            step={5}
            unit=" 分钟"
            onChange={(longBreakMinutes) => applySettings({ longBreakMinutes })}
          />
          <FineDial
            label="长休息前的轮数"
            value={settings.roundsBeforeLong}
            min={2}
            max={8}
            step={1}
            unit=" 轮"
            onChange={(roundsBeforeLong) => applySettings({ roundsBeforeLong })}
          />
          <label className="focus-switch">
            <span>
              完成时轻响一声
              <small>不打断正在播放的声音</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.chime}
              className={`toggle${settings.chime ? ' on' : ''}`}
              aria-label="完成提示音"
              onClick={() => applySettings({ chime: !settings.chime })}
            >
              <span />
            </button>
          </label>
          <button
            className="text-button focus-clear"
            disabled={records.length === 0}
            onClick={() => {
              setRecords([]);
              writeStore(HISTORY_KEY, []);
            }}
          >
            清空专注记录
          </button>
        </aside>
      </div>
    </section>
  );
}
