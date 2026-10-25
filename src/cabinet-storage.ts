import { emptyCabinet, sanitizeCabinet, recordColors, type Cabinet, type RecordItem } from './records.ts';
import { percentToDepth } from './records.ts';
import { getText, readAsset, setText } from './store.ts';

const KEY = 'raven-cabinet-v2', LEGACY_KEY = 'raven-settings';

export class CabinetWriteError extends Error {}

/** 每个窗口持有自己的读取快照；读失败或快照已过期时，绝不覆盖原文。 */
export class CabinetStorage {
  private writable = false;
  private snapshot: string | null = null;
  private legacy: string | null = null;

  async load(): Promise<Cabinet> {
    this.writable = false;
    const current = getText(KEY), legacy = current === null ? getText(LEGACY_KEY) : null;
    const cabinet = await readCabinet(current, legacy);
    this.snapshot = current; this.legacy = legacy; this.writable = true;
    this.assertWritable();
    return cabinet;
  }
  assertWritable() {
    if (!this.writable) throw new CabinetWriteError('收藏尚未成功读取，已暂停保存以保护原数据。请重新打开软件后重试。');
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
  }
}

const storage = new CabinetStorage();
export function saveCabinet(cabinet: Cabinet) { storage.save(cabinet); }
export function loadCabinet() { return storage.load(); }

async function readCabinet(current: string | null, legacy: string | null): Promise<Cabinet> {
  if (current !== null) {
    const raw = JSON.parse(current);
    if (!raw || raw.version !== 2 || !Array.isArray(raw.records)) throw new Error('收藏格式无法识别');
    const cabinet = sanitizeCabinet(raw);
    if (cabinet.records.length !== raw.records.length) throw new Error('部分唱片记录损坏');
    return cabinet;
  }
  const old = JSON.parse(legacy ?? 'null');
  if (!old) return structuredClone(emptyCabinet);
  const records: RecordItem[] = [];
  // Preserve imported v0.1 assets; leave the old settings key intact for recovery.
  for (const track of Array.isArray(old.mix?.tracks) ? old.mix.tracks : []) {
    if (track?.kind !== 'file' || typeof track.id !== 'string') continue;
    const asset = await readAsset(track.id);
    if (asset) records.push({ id: track.id, assetId: track.id, name: track.name, artist: '本地收藏', description: '', category: 'ambient', duration: 0, size: asset.size, format: 'AUDIO', color: recordColors[records.length % recordColors.length], fingerprint: track.id, volume: track.volume, pan: track.pan, warmth: track.warmth, duckDepth: percentToDepth(track.duckAmount ?? old.mix?.duckAmount ?? 65) });
  }
  const music = await readAsset('music');
  if (music) records.push({ id: 'legacy-music', assetId: 'music', name: old.musicName || '我的音乐', artist: '本地收藏', description: '', category: 'music', duration: 0, size: music.size, format: 'AUDIO', color: recordColors[1], fingerprint: 'legacy-music', volume: 85, pan: 0, warmth: 0, duckDepth: percentToDepth(65) });
  return sanitizeCabinet({ ...emptyCabinet, records, master: old.mix?.master ?? 60, musicVolume: old.mix?.musicVolume ?? 70, ducking: old.mix?.ducking, imageName: old.imageName ?? '', theme: old.imageName ? old.theme : emptyCabinet.theme });
}
