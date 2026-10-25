import { readAsset, storeAsset } from './store.ts';

/**
 * 资产相关的兼容层。
 *
 * 真正的读写已经交给 ./store，这里保留原来的函数名，免得调用点全都要改。
 * prepareImage 是纯图像处理（缩放 + 取色），跟存储无关，留在这一层。
 */

export { readAsset, storeAsset };

export async function prepareImage(file: File): Promise<{ blob: Blob; color: string }> {
  if (file.size > 20 * 1024 * 1024) throw new Error('请选择小于 20 MB 的图片。');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('支持 JPG、PNG 和 WebP 图片。');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const sample = document.createElement('canvas'); sample.width = sample.height = 32;
  const sampleCtx = sample.getContext('2d')!;
  sampleCtx.drawImage(canvas, 0, 0, 32, 32);
  const data = sampleCtx.getImageData(0, 0, 32, 32).data;
  const buckets = new Map<string, { r: number; g: number; b: number; count: number; weight: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = data.slice(i, i + 4);
    const high = Math.max(r, g, b), low = Math.min(r, g, b);
    if (a < 128 || high < 25 || low > 235) continue;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, weight: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
    bucket.weight += 1 + (high - low) / 128;
    buckets.set(key, bucket);
  }
  const winner = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  const rgb = winner ? [winner.r, winner.g, winner.b].map(n => Math.round(n / winner.count)) : [145, 185, 167];
  // Keep the sampled hue, lifting dark colors for readable controls on dark surfaces.
  const lift = Math.max(0, 160 - Math.max(...rgb));
  const color = '#' + rgb.map(n => Math.min(225, n + lift).toString(16).padStart(2, '0')).join('');
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片处理失败')), 'image/jpeg', 0.88));
  return { blob, color };
}
