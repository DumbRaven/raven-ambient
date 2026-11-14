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

export class CabinetWriteError extends Error {}

/**
 * 读盘的结果。
 *
 * `lost` 是「读到了但没法用、被丢掉」的唱片条数。它不是致命错误：坏掉的那几条
 * 丢掉，剩下的照常能用——用户几百张唱片里有一条 ID3 标签异常，不该让整柜消失。
 *
 * `broken` 是整份都读不出来（JSON 语法坏了、结构完全对不上）。这时退回空柜，
 * 但**仍然允许写入**：读不出来是数据问题，不该变成软件不可用（以前就是这样，
 * 结果是空唱片柜 + 所有导入按钮全灰，用户只能开 DevTools 删 localStorage 才能自救）。
 */
export type CabinetLoad = {
  cabinet: Cabinet;
  /** 有几条记录读不出来被丢掉了。 */
  lost: number;
  /** 整份都读不出来时为 true，此时 cabinet 是空柜。 */
  broken: boolean;
  /** 给人看的原因，正常加载时是空串。 */
  reason: string;
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
      reason = error instanceof Error ? error.message : String(error);
      parsed = null;
    }

    if (current !== null) {
      const raw = (parsed ?? {}) as { records?: unknown[] };
      const rawCount = Array.isArray(raw.records) ? raw.records.length : 0;
      const cabinet = sanitizeCabinet(parsed);
      const lost = broken ? 0 : Math.max(0, rawCount - cabinet.records.length);

      if (broken || suspect || lost > 0) {
        // 有东西读不出来：先原样留一份，再放行。
        // 备份成功才敢放行覆盖；备份失败（存满了之类）就维持原来的锁，
        // 宁可这次不能存，也不能把用户数据抹了。
        try {
          setText(SALVAGE_KEY, current);
          this.writable = true;
          this.snapshot = current;
          this.overwriteOnce = true;
          return { cabinet, lost, broken: broken || !!suspect, reason };
        } catch {
          this.writable = false;
          return { cabinet: structuredClone(emptyCabinet), lost: 0, broken: true, reason: reason || '存储空间不足' };
        }
      }

      this.writable = true;
      this.snapshot = current;
      this.overwriteOnce = false;
      return { cabinet, lost: 0, broken: false, reason: '' };
    }

    // 没有 v2 数据，试试 v0.1 的老结构。
    try {
      const cabinet = await readLegacy(parsed as LegacyShape | null);
      this.writable = true;
      this.snapshot = current;
      this.overwriteOnce = false;
      return { cabinet, lost: 0, broken: false, reason: '' };
    } catch (error) {
      const legacyText = legacy ?? '';
      try {
        setText(SALVAGE_KEY, legacyText);
        this.writable = true;
        this.snapshot = current;
        this.overwriteOnce = true;
      } catch {
        this.writable = false;
      }
      return {
        cabinet: structuredClone(emptyCabinet),
        lost: 0,
        broken: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
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

const storage = new CabinetStorage();
export function saveCabinet(cabinet: Cabinet) { storage.save(cabinet); }
export function loadCabinet() { return storage.load(); }

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
