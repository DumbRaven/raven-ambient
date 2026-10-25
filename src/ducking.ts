/**
 * 避让包络：把「音乐是否在响」变成一条连续的控制量。
 *
 * 与 PR 的自动回避思路对齐——不是开关式的压低，而是像关键帧一样
 * 带着淡入淡出地走过去。这里只做纯计算，不碰 Web Audio，
 * 播放器按算出的包络值去写增益。
 */

/** 一张环境音的避让参数。用户只调 depthDb，其余按封面类型定。 */
export type DuckProfile = {
  /** 音乐响起时压低的量，正数分贝。0 表示这张不避让。 */
  depthDb: number;
  /** 音乐越过阈值后，开始压低前的等待，秒。 */
  attackDelay: number;
  /** 压低过程本身用多久，秒。 */
  attackTime: number;
  /** 音乐停下后，保持压低的时间，秒。 */
  holdTime: number;
  /** 恢复用多久，秒。 */
  releaseTime: number;
  /** 判定音乐「在响」的音量阈值，0..1。 */
  threshold: number;
  /** 阈值之上再多高的余量才算真的在响，用来防抖。 */
  hysteresis: number;
};

/** 用户可调的只有深度。其余由封面类型决定，界面上不暴露。 */
export const depthRange = { min: 0, max: 24 };

/** 分贝转线性增益。−9 dB ≈ 0.355。 */
export function dbToGain(db: number): number {
  return Math.pow(10, -Math.max(0, db) / 20);
}

/** 线性增益转分贝，用于把旧的百分比设置迁移过来。 */
export function gainToDb(gain: number): number {
  const clamped = Math.min(1, Math.max(0.0001, gain));
  const db = Math.round(-20 * Math.log10(clamped) * 10) / 10;
  // 1.0 会算出 -0，统一归成 0，避免严格比较和显示都别扭
  return db === 0 ? 0 : db;
}

/**
 * 旧的「降低 N%」换算成分贝。
 * 说「降低 65%」的意思是振幅乘 0.35，也就是 −9.1 dB。
 */
export function percentToDb(percent: number): number {
  const amount = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  if (amount === 0) return 0;
  if (amount >= 100) return depthRange.max;
  return Math.min(depthRange.max, gainToDb(1 - amount / 100));
}

/**
 * 每类环境音的手感。慢的、宽的声音（森林、风）适合更长的淡入淡出，
 * 免得压下去像被人掐住；细碎的声音（雨、火）可以跟得紧一点。
 * 这些值不开放给用户，避免界面变成调音台。
 */
const profiles: Record<string, Omit<DuckProfile, 'depthDb'>> = {
  // 大片、绵延的空间声：慢进慢出，压得深也不突兀
  forest: { attackDelay: 0.45, attackTime: 1.5, holdTime: 1.1, releaseTime: 2.2, threshold: 0.012, hysteresis: 0.006 },
  wind: { attackDelay: 0.55, attackTime: 1.8, holdTime: 1.2, releaseTime: 2.4, threshold: 0.012, hysteresis: 0.006 },
  ocean: { attackDelay: 0.4, attackTime: 1.4, holdTime: 1, releaseTime: 2.1, threshold: 0.012, hysteresis: 0.006 },
  stream: { attackDelay: 0.35, attackTime: 1.2, holdTime: 0.9, releaseTime: 1.8, threshold: 0.012, hysteresis: 0.006 },
  // 有明确起音的：跟得紧，收得快，才有「让位」的感觉
  rain: { attackDelay: 0.2, attackTime: 0.7, holdTime: 0.6, releaseTime: 1.3, threshold: 0.01, hysteresis: 0.005 },
  fire: { attackDelay: 0.25, attackTime: 0.8, holdTime: 0.6, releaseTime: 1.4, threshold: 0.01, hysteresis: 0.005 },
  birds: { attackDelay: 0.15, attackTime: 0.55, holdTime: 0.45, releaseTime: 1.1, threshold: 0.009, hysteresis: 0.004 },
  insects: { attackDelay: 0.15, attackTime: 0.5, holdTime: 0.4, releaseTime: 1, threshold: 0.009, hysteresis: 0.004 },
  // 日常与机械声：几乎立刻让位，恢复也不拖
  keyboard: { attackDelay: 0.08, attackTime: 0.35, holdTime: 0.3, releaseTime: 0.8, threshold: 0.008, hysteresis: 0.004 },
  cafe: { attackDelay: 0.3, attackTime: 1, holdTime: 0.8, releaseTime: 1.6, threshold: 0.011, hysteresis: 0.005 },
  train: { attackDelay: 0.25, attackTime: 0.9, holdTime: 0.7, releaseTime: 1.5, threshold: 0.01, hysteresis: 0.005 },
  city: { attackDelay: 0.3, attackTime: 1.1, holdTime: 0.9, releaseTime: 1.8, threshold: 0.011, hysteresis: 0.005 },
  thunder: { attackDelay: 0.1, attackTime: 0.5, holdTime: 0.5, releaseTime: 1.2, threshold: 0.009, hysteresis: 0.004 },
  snow: { attackDelay: 0.5, attackTime: 1.6, holdTime: 1.2, releaseTime: 2.3, threshold: 0.012, hysteresis: 0.006 },
  noise: { attackDelay: 0.35, attackTime: 1.3, holdTime: 1, releaseTime: 2, threshold: 0.012, hysteresis: 0.006 },
  writing: { attackDelay: 0.2, attackTime: 0.6, holdTime: 0.5, releaseTime: 1.2, threshold: 0.009, hysteresis: 0.004 },
  fan: { attackDelay: 0.3, attackTime: 1, holdTime: 0.8, releaseTime: 1.7, threshold: 0.011, hysteresis: 0.005 },
};

/** 没有匹配到封面时的通用手感：居中，不抢戏也不拖沓。 */
const fallbackProfile: Omit<DuckProfile, 'depthDb'> = {
  attackDelay: 0.3, attackTime: 1, holdTime: 0.8, releaseTime: 1.7, threshold: 0.011, hysteresis: 0.005,
};

/** 按封面类型取避让手感。传 undefined 走通用值。 */
export function duckProfile(coverId: string | undefined, depthDb: number): DuckProfile {
  const base = (coverId && profiles[coverId]) || fallbackProfile;
  return { ...base, depthDb: Math.min(depthRange.max, Math.max(depthRange.min, depthDb)) };
}

/**
 * 包络跟随器。每个声部一份，各自按自己的手感走。
 *
 * 输出 0..1 的避让量：0 是完全不避让，1 是压到最深。
 * 用线性斜率而不是指数逼近——PR 的关键帧是线性的，
 * 听起来「压下去」和「提起来」的时值才可预期。
 */
export class DuckEnvelope {
  private level = 0;
  private loud = false;
  private loudSince = 0;
  private lastTime?: number;
  private holdUntil = 0;

  /** 当前避让量，0..1。 */
  get value() { return this.level; }

  /** 是否正处于避让中（含保持期），用于界面提示。 */
  get active() { return this.loud || this.level > 0; }

  reset() { this.level = 0; this.loud = false; this.loudSince = 0; this.holdUntil = 0; this.lastTime = undefined; }

  /**
   * 推进一步。
   * @param rms 音乐当前的电平
   * @param now 当前时间，秒
   * @param playing 音乐是否在播
   * @param enabled 用户是否开着自动避让
   * @param profile 这个声部的手感
   * @returns 新的避让量 0..1
   */
  step(rms: number, now: number, playing: boolean, enabled: boolean, profile: DuckProfile): number {
    if (!Number.isFinite(now) || (this.lastTime !== undefined && now < this.lastTime)) return this.level;
    const previous = this.lastTime ?? now;
    // 先沿上一采样的状态推进到 now，再接收本拍的输入。重复时间戳不多走一步。
    if (this.loud) {
      const dt = Math.max(0, now - Math.max(previous, this.loudSince + profile.attackDelay));
      if (dt > 0) this.level = profile.attackTime <= 0 ? 1 : Math.min(1, this.level + dt / profile.attackTime);
    } else {
      const dt = Math.max(0, now - Math.max(previous, this.holdUntil));
      if (dt > 0) this.level = profile.releaseTime <= 0 ? 0 : Math.max(0, this.level - dt / profile.releaseTime);
    }
    this.lastTime = now;
    const latched = this.loud || (this.level > 0 && now < this.holdUntil);
    const loud = enabled && playing && profile.depthDb > 0 && rms > profile.threshold + (latched ? 0 : profile.hysteresis);
    if (loud && !this.loud) this.loudSince = now;
    if (!loud && this.loud) this.holdUntil = now + profile.holdTime;
    this.loud = loud;
    return this.level;
  }
}

/** 把避让量换算成该声部实际该乘的增益。 */
export function duckGain(level: number, depthDb: number): number {
  const target = dbToGain(depthDb);
  const clamped = Math.min(1, Math.max(0, level));
  return 1 + (target - 1) * clamped;
}

/** 界面上的说明文案：把 dB 翻译成人话。 */
export function describeDepth(depthDb: number): string {
  if (depthDb <= 0) return '不避让';
  if (depthDb < 3) return '轻轻让一点';
  if (depthDb < 6) return '明显退后';
  if (depthDb < 10) return '让出位置';
  if (depthDb < 16) return '几乎退到底';
  return '完全让位';
}
