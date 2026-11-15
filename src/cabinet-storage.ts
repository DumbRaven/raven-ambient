import { emptyCabinet, sanitizeCabinet, recordColors, type Cabinet, type RecordItem } from './records.ts';
import { percentToDepth } from './records.ts';
import { getText, readAsset, setText } from './store.ts';

const KEY = 'raven-cabinet-v2', LEGACY_KEY = 'raven-settings';
/**
 * 读不出来时，原文在这里留一份。
 *
 * 这是「不死锁」和「不丢数据」能同时成立的唯一办法：读到一半坏掉时，界面必须还能用
 * （否则空柜 + 按钮全灰，用户只能开 DevTools 删 localStorage），但直接放行保存又会
 * 把坏掉的那几条永久抹掉。所以先逐字备份，再放行——用户损失的是「暂时看不到的那几条」，
 * 不是「再也找不回来的那几条」。
 */
const SALVAGE_KEY = 'raven-cabinet-v2-unreadable';
/**
 * 上一次「恢复原文件」写回去的是哪份文本。
 *
 * 恢复操作是把备份的原文写回主键，而那份原文本来就是读不出来的——
 * 写回去之后重载必然再次进 broken 分支。没有这个标记的话，
 * 用户会「点恢复 → 重载 → 横幅又出现 → 再点恢复」无限转，
 * 而另一个按钮（从空柜开始）才是他真正该走的路。
 */
const RESTORED_KEY = 'raven-cabinet-v2-restored';

export class CabinetWriteError extends Error {}

/**
 * 读盘的结果。
 *
 * `lost` 是「读到了但没法用、被丢掉」的唱片条数。它不是致命错误：坏掉的那几条
 * 丢掉，剩下的照常能用——用户几百张唱片里有一条 ID3 标签异常，不该让整柜消失。
 *
 * `broken` 是整份都读不出来（JSON 语法坏了、结构完全对不上、或者版本不认识）。
 * 这时退回空柜，但**不自动放行保存**：一旦放行，下一次随便什么操作都会拿空柜
 * 盖掉主键，而用户可能根本不知道发生过什么。要不要用空柜重开，得由人决定。
 */
export type CabinetLoad = {
  cabinet: Cabinet;
  /** 有几条记录读不出来被丢掉了。 */
  lost: number;
  /** 整份都读不出来时为 true，此时 cabinet 是空柜，且保存被锁住。 */
  broken: boolean;
  /** 给人看的原因，正常加载时是空串。 */
  reason: string;
  /** 读坏时有没有留下备份（`restoreSalvage()` 能把原文拿回来）。 */
  salvage: boolean;
  /**
   * 这份坏掉的原文之前已经点过一次「恢复原文件」并且仍然读不出来。
   *
   * 为 true 时界面只该给「不要了，从空柜开始」——把一条注定失败的按钮
   * 摆在那里，用户只会一遍遍点它、一遍遍看同一个横幅。
   */
  retried: boolean;
};

/** 每个窗口持有自己的读取快照；读失败或快照已过期时，绝不覆盖原文。 */
export class CabinetStorage {
  private writable = false;
  private snapshot: string | null = null;
  private legacy: string | null = null;
  /** 读盘降级后的第一次保存要无条件覆盖，否则乐观并发保护会把自己拦住。 */
  private overwriteOnce = false;

  async load(): Promise<CabinetLoad> {
    const current = getText(KEY), legacy = current === null ? getText(LEGACY_KEY) : null;
    this.legacy = legacy;

    let parsed: unknown = null;
    let broken = false;
    /** 结构说不上坏，但也不是我们认识的版本——同样得先备份再动。 */
    let suspect = '';
    let reason = '';
    try {
      parsed = current !== null ? JSON.parse(current) : JSON.parse(legacy ?? 'null');
      if (current !== null) {
        const shape = parsed as { version?: unknown; records?: unknown };
        if (!parsed || typeof parsed !== 'object') { broken = true; reason = '收藏格式无法识别'; }
        else if (shape.version !== 2) { suspect = `未知的收藏版本 ${String(shape.version)}`; reason = suspect; }
        else if (!Array.isArray(shape.records)) { broken = true; reason = '收藏格式无法识别'; }
      }
    } catch (error) {
      broken = true;
      // 不把 JSON.parse 的原文递出去：那是给开发者看的英文，用户读到
      // 「Unexpected end of JSON input」除了慌之外没有别的用处。
      // 但仍然要能区分「就是坏了」和「版本不认识」——两者的正确操作完全不同。
      reason = error instanceof RangeError ? '收藏数据太大' : '收藏文件损坏';
      parsed = null;
    }

    if (current !== null) {
      const raw = (parsed ?? {}) as { records?: unknown[] };
      const rawCount = Array.isArray(raw.records) ? raw.records.length : 0;
      const cabinet = sanitizeCabinet(parsed);
      const lost = broken ? 0 : Math.max(0, rawCount - cabinet.records.length);

      if (broken || suspect) {
        // 整份读不出来：留一份原文，但**不放行保存**。
        //
        // 这里原本是先备份、再 overwriteOnce = true 放行——以为「备份了就等于没丢」。
        // 实际上 SALVAGE_KEY 全库零处读，备份是一句空头承诺；而放行之后用户随便
        // 调一下音量，空柜就把主键盖掉了。所以改成：备份照旧做（用户想恢复时
        // 有东西可恢复），但锁住保存，把「要不要拿空柜重开」交给人。
        const salvaged = this.salvage(current);
        // retried 告诉界面：这份原文已经试过一次「恢复原文件」而且仍然读不出来。
        // 备份没写成时也照样报 retried=false，界面会给出「恢复原文件」——
        // 那条路能不能走通由 restore() 的返回值决定，不再由「备份成没成」决定要不要显示横幅。
        const retried = this.alreadyRestored(current);
        return { cabinet: structuredClone(emptyCabinet), lost: 0, broken: true, reason, salvage: salvaged, retried };
      }

      // 只是个别唱片坏掉：直接放行。用户损失的是一两条，不值得为它弹窗，
      // 但原文照样留一份——万一他后来发现「少的那条其实很重要」。
      if (lost > 0) this.salvage(current);

      this.writable = true;
      this.snapshot = current;
      this.overwriteOnce = false;
      return { cabinet, lost, broken: false, reason: '', salvage: lost > 0, retried: false };
    }

    // 没有 v2 数据，试试 v0.1 的老结构。
    try {
      const cabinet = await readLegacy(parsed as LegacyShape | null);
      this.writable = true;
      this.snapshot = current;
      this.overwriteOnce = false;
      return { cabinet, lost: 0, broken: false, reason: '', salvage: false, retried: false };
    } catch (error) {
      const salvaged = this.salvage(legacy ?? '');
      return {
        cabinet: structuredClone(emptyCabinet),
        lost: 0,
        broken: true,
        // 老结构的错误信息同样不该原样丢给用户看。
        reason: error instanceof Error ? '旧版收藏数据读不出来' : '旧版收藏数据读不出来',
        salvage: salvaged,
        retried: false,
      };
    }
  }

  /**
   * 把原文逐字存进备份键，成功返回 true。
   *
   * 只做备份，不改变任何可写状态——「备份了」和「允许覆盖」是两件事，
   * 之前把它们绑在一起，才出现「说备份了、其实没人能读回来」的情况。
   */
  private salvage(text: string): boolean {
    try { setText(SALVAGE_KEY, text); return true; } catch { return false; }
  }

  /**
   * 把备份的原文写回主键。
   *
   * 这是「已备份」这句承诺的兑现入口：只有用户明确点了「恢复原文件」才调用它。
   * 写完把当前窗口置为不可写，避免这个窗口的快照跟主键对不上后把人锁在外面。
   *
   * 注意这条路**天生可能无效**：备份的就是那份读不出来的原文，写回去大概率
   * 还是读不出来。所以这里记一笔「这份原文已经试过恢复了」，下次 load 看到
   * 同样的文本就不再给这个按钮——否则用户会「点恢复 → 重载 → 横幅又出现 →
   * 再点恢复」，转到他自己放弃为止。
   */
  restore(): boolean {
    const text = getText(SALVAGE_KEY);
    if (text === null) return false;
    try {
      setText(KEY, text);
      setText(RESTORED_KEY, text);
    } catch {
      return false;
    }
    this.writable = false;
    this.overwriteOnce = false;
    return true;
  }

  /**
   * 这份读不出来的原文之前是不是已经点过「恢复原文件」了。
   *
   * 用来让界面第二次只给「不要了，从空柜开始」，不再拿一条注定失败的按钮骗人。
   */
  alreadyRestored(current: string | null): boolean {
    if (current === null) return false;
    return getText(RESTORED_KEY) === current;
  }

  /**
   * 用户决定「不要那份坏数据了，就从这个空柜开始」。
   *
   * 显式开锁而不是让 load 自动放行：读坏之后每一次静默保存都是拿空柜覆盖真实收藏，
   * 这个决定必须有人按一下。
   */
  adoptEmpty() {
    this.writable = true;
    this.snapshot = getText(KEY);
    this.overwriteOnce = true;
  }

  assertWritable() {
    if (!this.writable) throw new CabinetWriteError('收藏尚未成功读取，已暂停保存以保护原数据。请重新打开软件后重试。');
    if (this.overwriteOnce) return;
    try {
      if (getText(KEY) !== this.snapshot || (this.snapshot === null && getText(LEGACY_KEY) !== this.legacy)) {
        throw new Error('stale cabinet');
      }
    } catch {
      this.writable = false;
      throw new CabinetWriteError('收藏已在别处更改或暂时无法读取，本次修改未保存。请重新打开软件后重试。');
    }
  }
  save(cabinet: Cabinet) {
    this.assertWritable();
    // muted（哪几路环境音被单独按了暂停）只在这一次运行里有效：写盘时一律清空，
    // 下次打开软件回到「全部流动」。内存里的那份照旧生效，界面和音频都不用改。
    const text = JSON.stringify({ ...cabinet, muted: [] });
    setText(KEY, text);
    this.snapshot = text;
    this.overwriteOnce = false;
  }
}

/**
 * 把读坏时留下的备份写回主键。只有用户明确要求时才该调用。
 *
 * 参数必须是**调用方自己正在用的那个实例**——这个文件底部曾经有一个模块级
 * 单例供这些函数用，但 App 每次启动都会 `new CabinetStorage()`，两者不是同一个
 * 对象，于是 `adoptEmpty()` 解的是别人的锁：横幅消失了，保存却照样失败，
 * 用户点「不要了，从空柜开始」等于没点。所以这里把实例改成必填参数。
 */
export function restoreSalvage(storage: CabinetStorage) { return storage.restore(); }
/** 用户决定放弃那份读坏的数据，从这个空柜开始。同样必须传当前实例。 */
export function adoptEmptyCabinet(storage: CabinetStorage) { return storage.adoptEmpty(); }
export const SALVAGE = SALVAGE_KEY;

type LegacyShape = {
  mix?: { tracks?: { kind?: string; id?: string; name?: string; volume?: number; pan?: number; warmth?: number; duckAmount?: number; master?: number; musicVolume?: number; ducking?: boolean }[]; master?: number; musicVolume?: number; ducking?: boolean; duckAmount?: number };
  musicName?: string;
  imageName?: string;
  theme?: string;
};

/** v0.1 的老结构：音频在 IndexedDB 里按 id 存着，不在 localStorage。 */
async function readLegacy(old: LegacyShape | null): Promise<Cabinet> {
  if (!old) return structuredClone(emptyCabinet);
  const records: RecordItem[] = [];
  for (const track of Array.isArray(old.mix?.tracks) ? old.mix.tracks : []) {
    if (track?.kind !== 'file' || typeof track.id !== 'string') continue;
    const asset = await readAsset(track.id);
    if (asset) records.push({ id: track.id, assetId: track.id, name: track.name ?? '未命名', artist: '本地收藏', description: '', category: 'ambient', duration: 0, size: asset.size, format: 'AUDIO', color: recordColors[records.length % recordColors.length], fingerprint: track.id, volume: track.volume ?? 60, pan: track.pan ?? 0, warmth: track.warmth ?? 0, duckDepth: percentToDepth(track.duckAmount ?? old.mix?.duckAmount ?? 65) });
  }
  const music = await readAsset('music');
  if (music) records.push({ id: 'legacy-music', assetId: 'music', name: old.musicName || '我的音乐', artist: '本地收藏', description: '', category: 'music', duration: 0, size: music.size, format: 'AUDIO', color: recordColors[1], fingerprint: 'legacy-music', volume: 85, pan: 0, warmth: 0, duckDepth: percentToDepth(65) });
  return sanitizeCabinet({ ...emptyCabinet, records, master: old.mix?.master ?? 60, musicVolume: old.mix?.musicVolume ?? 70, ducking: old.mix?.ducking, imageName: old.imageName ?? '', theme: old.imageName ? old.theme : emptyCabinet.theme });
}
