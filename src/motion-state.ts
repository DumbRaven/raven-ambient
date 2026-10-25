export type MotionPhase = 'idle' | 'enter' | 'exit';
export type MotionState<T> = { value: T; phase: MotionPhase; direction: number };
export type MotionTiming = { enter: number; exit: number };
type Schedule = (callback: () => void, delay: number) => () => void;

export const dialogTiming: MotionTiming = { enter: 240, exit: 160 };
/** 圆形扩散的时长：新页面从这里铺开。 */
export const wipeDuration = 520;
/** 旧页面退场：比扩散短很多，两个动作错开，不叠成一团。 */
export const wipeExit = 130;
// 页面的 data-motion 必须撑到动画自己跑完，否则 CSS 动画会被提前摘掉、扩散变成硬切。
export const pageTiming: MotionTiming = { enter: wipeDuration, exit: wipeExit };
// 高度动画跟手就行，不能跟着 520ms 一起变慢，否则换页时右边会慢慢挤。
export const heightTiming = { enter: 110 };

/** Retain outgoing content until it has faded; only the latest request may finish. */
export class MotionSequence<T> {
  state: MotionState<T>;
  private cancelTimer?: () => void;
  private revision = 0;
  private timing: MotionTiming;
  private notify: (state: MotionState<T>) => void;
  private schedule: Schedule;
  constructor(initial: T, timing: MotionTiming, notify: (state: MotionState<T>) => void,
    schedule: Schedule = (callback, delay) => { const id = setTimeout(callback, delay); return () => clearTimeout(id); }) {
    this.state = { value: initial, phase: 'idle', direction: 1 };
    this.timing = timing; this.notify = notify; this.schedule = schedule;
  }
  cancel() { this.revision++; this.cancelTimer?.(); this.cancelTimer = undefined; }
  private publish(value: T, phase: MotionPhase, direction: number) {
    this.state = { value, phase, direction }; this.notify(this.state);
  }
  request(value: T, reduced: boolean, direction = 1) {
    this.cancel();
    const revision = this.revision;
    const later = (callback: () => void, delay: number) => {
      this.cancelTimer = this.schedule(() => { if (revision === this.revision) callback(); }, delay);
    };
    if (reduced) { this.publish(value, 'idle', direction); return; }
    if (value === this.state.value && this.state.phase === 'idle') return;
    const enter = () => {
      if (value == null) { this.publish(value, 'idle', direction); return; }
      this.publish(value, 'enter', direction);
      later(() => this.publish(value, 'idle', direction), this.timing.enter);
    };
    if (this.state.value == null || this.state.value === value) enter();
    else { this.publish(this.state.value, 'exit', direction); later(enter, this.timing.exit); }
  }
}
