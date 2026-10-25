import { parseBlob } from 'music-metadata';
import { defaultDuckDepth, fingerprint, recordColors, type RecordItem, type RecordType } from './records';
import { matchAmbientCover } from './ambient-covers';

export async function inspectAudio(file: File, category: RecordType, index: number): Promise<{ record: RecordItem; cover?: Blob }> {
  if (file.size > (category === 'ambient' ? 50 : 200) * 1024 * 1024) throw new Error(`${file.name} 超过${category === 'ambient' ? '环境音 50' : '音乐 200'} MB 限制`);
  const url = URL.createObjectURL(file), audio = new Audio();
  let duration = 0;
  try {
    duration = await new Promise<number>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timeout); audio.onloadedmetadata = null; audio.onerror = null; error ? reject(error) : resolve(audio.duration); };
      const timeout = setTimeout(() => finish(new Error(`${file.name} 读取超时`)), 12000);
      audio.onloadedmetadata = () => finish(); audio.onerror = () => finish(new Error(`${file.name} 无法解码，请换成 MP3、WAV 或 FLAC`));
      audio.preload = 'metadata'; audio.src = url;
    });
  } finally { audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`${file.name} 没有可识别的音频时长`);
  if (category === 'ambient' && duration > 600) throw new Error(`${file.name} 超过环境音 10 分钟限制`);
  let metadataTimer: ReturnType<typeof setTimeout> | undefined;
  const metadata = await Promise.race([
    parseBlob(file, { duration: false, skipCovers: false }).catch(() => undefined),
    new Promise<undefined>(resolve => { metadataTimer = setTimeout(() => resolve(undefined), 5000); }),
  ]);
  clearTimeout(metadataTimer);
  const picture = metadata?.common.picture?.find(p => ['image/jpeg', 'image/png', 'image/webp'].includes(p.format) && p.data.byteLength <= 5 * 1024 * 1024);
  const id = crypto.randomUUID();
  const preset = category === 'ambient' && !picture ? matchAmbientCover(`${file.name} ${metadata?.common.title ?? ''}`) : undefined;
  const record: RecordItem = {
    id, assetId: id, name: (metadata?.common.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 100),
    artist: (metadata?.common.artist || '本地收藏').slice(0, 100), description: '', category, duration,
    format: file.name.split('.').at(-1)?.toUpperCase() ?? 'AUDIO', size: file.size,
    color: preset?.color ?? recordColors[index % recordColors.length], fingerprint: fingerprint(file),
    volume: category === 'ambient' ? 45 : 80, pan: 0, warmth: category === 'ambient' ? 15 : 0,
    coverId: picture ? `cover-${id}` : undefined, coverPreset: preset?.id, duckDepth: defaultDuckDepth,
  };
  return { record, cover: picture ? new Blob([new Uint8Array(picture.data)], { type: picture.format }) : undefined };
}
