/**
 * 环境音的响度归一化。
 *
 * 用户自己上传的素材响度差别很大：实测同一份收藏里，「书写」比「冬季森林的氛围」
 * 低 13 dB（约 1/5 响度），用户把滑杆推到 100% 仍觉得它太小。这不是滑杆的问题，
 * 是素材本身不齐——滑杆的意义应该是「相对比例」，不该拿来补素材的缺陷。
 *
 * 所以这里做两件事：
 * 1. 算出把这段素材拉到基准响度需要多少增益；
 * 2. 增益有上限，剩下的交给音频链路上的软限幅器兜底（见 audio.ts 的 limiter）。
 *
 * 只做增益不做限幅是不行的：峰值为 0 dB、RMS 只有 -37 dB 的素材，
 * 补 14 dB 会先把峰值顶穿，听感上直接变成刺耳的失真。
 */

/** 归一化的目标电平（门限内均方根）。−23 dB 大约是环境音里「清楚但不抢戏」的位置。 */
export const TARGET_LEVEL_DB = -23;

/**
 * 最多补 15 dB。
 *
 * 一开始定在 12 dB，理由是「再往上，素材自带的底噪和房间声也会被一起抬起来」。
 * 但实测推翻了这个顾虑：有了每一路自己的软限幅器之后，补 14.8 dB 的那段素材
 * 只有 0.05% 的采样点触到拐点，限幅前后 RMS 只差 0.4 dB——没有吃掉动态，
 * 只是把偶尔的爆点压平了。而 12 dB 的上限会让轻素材停在离基准 2.8 dB 的地方，
 * 用户还是得回去推滑杆，就白做了。
 */
export const MAX_BOOST_DB = 15;

/** 最多压 12 dB。已经够响的素材没必要为了「整齐」被压小。 */
export const MAX_CUT_DB = 12;

/** 统计块的长度（秒）。沿用 EBU R128 的 400ms，人感知的「一段响度」差不多是这个尺度。 */
const BLOCK_SECONDS = 0.4;

/** 每块最多取这么多个采样点来估电平，够稳且不随素材时长变慢。 */
const SAMPLES_PER_BLOCK = 400;

/** 绝对静音门限：低于 −70 dBFS 的块一律不算，避免整段静音被当成「需要补」的素材。 */
const SILENCE_FLOOR_DB = -70;

/**
 * 相对门限：比中位数还低 40 dB 的块，算静音、淡入淡出或片头底噪，不参与电平统计。
 *
 * 为什么是相对中位数而不是相对峰值：峰值容易被一下爆音抬起来，
 * 中位数代表「这段时间里大致在响的水平」，用它划线更稳。
 */
const GATE_BELOW_MEDIAN_DB = 40;

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function linearToDb(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : Number.NEGATIVE_INFINITY;
}

/**
 * 算一段素材的「代表电平」：按 400ms 切块，剔掉静音块后取均方根。
 *
 * 早先这里是整段一个均方根。问题是平均值会把片头静音、淡入淡出也算进去：
 * 一段开头两秒空白、后面正常的录音，平均下来偏轻，增益就补过头，
 * 切到它时会「轰」一下——这正是用户说的「看起来推满了还是不对」。
 * 分块 + 门限把这类块剔掉，剩下的才是人实际听到的那段。
 *
 * 这不是完整的 EBU R128：没做 K 加权，所以低频重的素材仍会被估得偏响一点。
 * 但对本地环境音和黑胶转录，静音与淡入淡出是主要偏差来源，先解决这个。
 */
export function measureLevel(buffer: AudioBuffer): number {
  const channels = Math.min(buffer?.numberOfChannels ?? 0, 2);
  if (!channels || !buffer.length || typeof buffer.getChannelData !== 'function') return 0;

  const sampleRate = typeof buffer.sampleRate === 'number' && buffer.sampleRate > 0 ? buffer.sampleRate : 48000;
  const blockSize = Math.max(1, Math.round(sampleRate * BLOCK_SECONDS));
  const levels: number[] = [];

  for (let start = 0; start < buffer.length; start += blockSize) {
    const end = Math.min(start + blockSize, buffer.length);
    const step = Math.max(1, Math.floor((end - start) / SAMPLES_PER_BLOCK));
    let sum = 0;
    let count = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = start; index < end; index += step) {
        sum += data[index] * data[index];
        count += 1;
      }
    }
    if (count) levels.push(Math.sqrt(sum / count));
  }

  if (!levels.length) return 0;

  const sorted = [...levels].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const gate = Math.max(dbToLinear(SILENCE_FLOOR_DB), median * dbToLinear(-GATE_BELOW_MEDIAN_DB));

  let energy = 0;
  let kept = 0;
  for (const level of levels) {
    if (level < gate) continue;
    energy += level * level;
    kept += 1;
  }
  return kept ? Math.sqrt(energy / kept) : 0;
}

/**
 * 把实测电平拉到基准需要的增益倍率。
 *
 * 量不出来（静音、空音频、测试桩）就返回 1，宁可不动也不要乱放大。
 */
export function loudnessGain(level: number): number {
  if (!(level > 0)) return 1;
  const raw = dbToLinear(TARGET_LEVEL_DB) / level;
  // 上界是「最多补多少」，下界是「最多压多少」。
  // 早先这两个用反了（补的上界写成 CUT），两个常量碰巧都是 12 时看不出来，
  // 直到把补的上限放宽到 15 才发现增益被卡在 12 dB。
  return Math.min(dbToLinear(MAX_BOOST_DB), Math.max(dbToLinear(-MAX_CUT_DB), raw));
}
