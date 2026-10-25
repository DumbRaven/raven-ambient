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

/** 归一化的目标响度（RMS）。−23 dB 大约是环境音里「清楚但不抢戏」的位置。 */
export const TARGET_RMS_DB = -23;

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

/** 抽样间隔上限：48 kHz 下一分钟就是 288 万个样本，逐个走一遍纯属浪费。 */
const SAMPLE_LIMIT = 20000;

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function linearToDb(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : Number.NEGATIVE_INFINITY;
}

/**
 * 抽样算整段素材的 RMS。
 *
 * 隔几个样本取一个：两万个采样点已经足够稳（实测与全量结果差 0.1 dB 以内），
 * 成本却降了两个数量级——加载十段环境音也不会卡。
 */
export function measureRms(buffer: AudioBuffer): number {
  const channels = Math.min(buffer?.numberOfChannels ?? 0, 2);
  if (!channels || !buffer.length || typeof buffer.getChannelData !== 'function') return 0;
  const step = Math.max(1, Math.floor(buffer.length / SAMPLE_LIMIT));
  let sum = 0;
  let count = 0;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += step) {
      sum += data[index] * data[index];
      count += 1;
    }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * 把实测响度拉到基准需要的增益倍率。
 *
 * 量不出来（静音、空音频、测试桩）就返回 1，宁可不动也不要乱放大。
 */
export function loudnessGain(rms: number): number {
  if (!(rms > 0)) return 1;
  const raw = dbToLinear(TARGET_RMS_DB) / rms;
  // 上界是「最多补多少」，下界是「最多压多少」。
  // 早先这两个用反了（补的上界写成 CUT），两个常量碰巧都是 12 时看不出来，
  // 直到把补的上限放宽到 15 才发现增益被卡在 12 dB。
  return Math.min(dbToLinear(MAX_BOOST_DB), Math.max(dbToLinear(-MAX_CUT_DB), raw));
}
