/**
 * 专注计时（番茄钟）的纯逻辑层。
 *
 * 与界面完全解耦，便于直接单测：所有函数接收当前时间戳 now，
 * 不读时钟、不碰 DOM、不写存储——副作用留给 FocusRoom.tsx。
 */

export type FocusPhase = 'focus' | 'break' | 'longBreak';

export type FocusSettings = {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  roundsBeforeLong: number;
  chime: boolean;
};

export type FocusRecord = { at: number; minutes: number };

export type FocusState = {
  phase: FocusPhase;
  /** 自上次长休息以来已完成的专注轮数。 */
  rounds: number;
  running: boolean;
  /** 仅在 running 时有意义：本阶段结束的绝对时间戳。 */
  endAt: number;
  /** 暂停时剩余毫秒。 */
  remainingMs: number;
  /** 开始后冻结本阶段的时长与轮次规则，暂停仍保留。 */
  session?: { durationMs: number; roundsBeforeLong: number };
};

export type FocusTick = {
  state: FocusState;
  /** 本阶段刚好到点时出现。 */
  finished?: { phase: FocusPhase; record?: FocusRecord };
};

export const MINUTE = 60_000;

export const defaultFocusSettings: FocusSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLong: 4,
  chime: true,
};

/** 预设只覆盖专注/小憩两档，长休息与轮次沿用当前设置。 */
export const focusPresets = [
  { id: 'classic', name: '经典 25 / 5', focusMinutes: 25, shortBreakMinutes: 5 },
  { id: 'deep', name: '深潜 45 / 10', focusMinutes: 45, shortBreakMinutes: 10 },
  { id: 'quick', name: '速写 15 / 3', focusMinutes: 15, shortBreakMinutes: 3 },
] as const;

export const phaseNames: Record<FocusPhase, string> = {
  focus: '专注',
  break: '小憩',
  longBreak: '长休息',
};

/** 画面上的等宽小标签，和唱片柜的眉标语气保持一致。 */
export const phaseCaptions: Record<FocusPhase, string> = {
  focus: 'FOCUS',
  break: 'SHORT BREAK',
  longBreak: 'LONG BREAK',
};

function whole(value: unknown, fallback: number, min: number, max: number): number {
  const next = Math.round(Number(value));
  return Number.isFinite(next) ? Math.min(max, Math.max(min, next)) : fallback;
}

export function sanitizeFocusSettings(value: unknown): FocusSettings {
  if (!value || typeof value !== 'object') return { ...defaultFocusSettings };
  const raw = value as Partial<FocusSettings>;
  return {
    focusMinutes: whole(raw.focusMinutes, defaultFocusSettings.focusMinutes, 1, 180),
    shortBreakMinutes: whole(raw.shortBreakMinutes, defaultFocusSettings.shortBreakMinutes, 1, 60),
    longBreakMinutes: whole(raw.longBreakMinutes, defaultFocusSettings.longBreakMinutes, 1, 120),
    roundsBeforeLong: whole(raw.roundsBeforeLong, defaultFocusSettings.roundsBeforeLong, 1, 12),
    chime: raw.chime !== false,
  };
}

export function sanitizeFocusHistory(value: unknown): FocusRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is FocusRecord => Boolean(item) && typeof item === 'object')
    .filter((item) => Number.isFinite(item.at) && Number.isFinite(item.minutes))
    .map((item) => ({ at: Number(item.at), minutes: whole(item.minutes, 0, 0, 240) }))
    .filter((item) => item.minutes > 0)
    .slice(-500);
}

export function focusMinutes(settings: FocusSettings, phase: FocusPhase): number {
  if (phase === 'focus') return settings.focusMinutes;
  return phase === 'break' ? settings.shortBreakMinutes : settings.longBreakMinutes;
}

export function phaseMs(settings: FocusSettings, phase: FocusPhase): number {
  return focusMinutes(settings, phase) * MINUTE;
}

export function initialFocusState(settings: FocusSettings, phase: FocusPhase = 'focus'): FocusState {
  return { phase, rounds: 0, running: false, endAt: 0, remainingMs: phaseMs(settings, phase) };
}

/** m:ss；向上取整，让 25:00 从第一帧就完整显示。 */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function remainingFocus(state: FocusState, now: number): number {
  const available = Math.max(0, state.remainingMs);
  // 第一帧或恢复时的旧采样不能把等待/长按时间加回本轮。
  return state.running ? Math.min(available, Math.max(0, state.endAt - now)) : available;
}

/** 已经走过的比例（0–1），用于画进度环。 */
export function elapsedFraction(state: FocusState, settings: FocusSettings, now: number): number {
  const total = focusDuration(state, settings);
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - remainingFocus(state, now) / total));
}

export function startFocus(state: FocusState, settings: FocusSettings, now: number): FocusState {
  if (state.running) return state;
  const session = state.session ?? { durationMs: phaseMs(settings, state.phase), roundsBeforeLong: settings.roundsBeforeLong };
  const remaining = state.session ? Math.max(0, state.remainingMs) : session.durationMs;
  return { ...state, session, running: true, endAt: now + remaining, remainingMs: remaining };
}

export function focusDuration(state: FocusState, settings: FocusSettings): number {
  return state.session?.durationMs ?? phaseMs(settings, state.phase);
}

/** 未开始的阶段随偏好更新；已开始或暂停的阶段保持原时长。 */
export function applyFocusSettings(state: FocusState, settings: FocusSettings): FocusState {
  return state.session ? state : { ...state, remainingMs: phaseMs(settings, state.phase) };
}

export function pauseFocus(state: FocusState, now: number): FocusState {
  if (!state.running) return state;
  return { ...state, running: false, endAt: 0, remainingMs: Math.max(0, state.endAt - now) };
}

export function resetFocus(state: FocusState, settings: FocusSettings): FocusState {
  return { ...state, session: undefined, running: false, endAt: 0, remainingMs: phaseMs(settings, state.phase) };
}

/** 轮次推进：专注完成 → 小憩或长休息；长休息结束 → 新一轮专注。 */
function advance(state: FocusState, settings: FocusSettings, finished: FocusPhase): FocusState {
  if (finished === 'focus') {
    const rounds = state.rounds + 1;
    const phase: FocusPhase = rounds >= (state.session?.roundsBeforeLong ?? settings.roundsBeforeLong) ? 'longBreak' : 'break';
    return { phase, rounds, running: false, endAt: 0, remainingMs: phaseMs(settings, phase) };
  }
  const rounds = finished === 'longBreak' ? 0 : state.rounds;
  return { phase: 'focus', rounds, running: false, endAt: 0, remainingMs: phaseMs(settings, 'focus') };
}

export function tickFocus(state: FocusState, settings: FocusSettings, now: number): FocusTick {
  if (!state.running || now < state.endAt) return { state };
  const finished = state.phase;
  const record = finished === 'focus' ? { at: state.endAt, minutes: focusDuration(state, settings) / MINUTE } : undefined;
  return { state: advance(state, settings, finished), finished: { phase: finished, record } };
}

/** 跳过当前阶段：推进轮次但不记录（没坐满就不算一次番茄）。 */
export function skipFocus(state: FocusState, settings: FocusSettings): FocusState {
  return advance(state, settings, state.phase);
}

export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function focusStats(records: FocusRecord[], now: number) {
  const today = dayKey(now);
  const sum = (list: FocusRecord[]) => list.reduce((total, item) => total + item.minutes, 0);
  const todays = records.filter((item) => dayKey(item.at) === today);
  return {
    todayCount: todays.length,
    todayMinutes: sum(todays),
    totalCount: records.length,
    totalMinutes: sum(records),
  };
}
