/**
 * 从视频里取一帧，算它的主色。
 *
 * 原来只有图片能取色（`coverPalette` 靠 `<img>` 解码），视频一律退回兜底色，
 * 结果放视频的时候版式永远是灰的，和画面对不上。
 *
 * 做法和图片那条路一样：抽一帧画到 36×36 的 canvas 上，再数颜色。
 * 关键是**跳到一个有内容的时刻**——很多视频开头是黑场或台标，
 * 停在 0 秒取出来是一片黑，等于没取。所以往后跳 12% 处（够越过片头，
 * 又一定在正片里），太短的片子退到中点。
 */
import { toHex } from './vinyl';

const cache = new Map<string, Promise<string[]>>();

/** 抽一帧用的就绪超时——视频读不出来就别一直等，返回空数组走兜底色。 */
const READY_TIMEOUT = 6000;

function waitFor(element: HTMLVideoElement, event: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      element.removeEventListener(event, onEvent);
      element.removeEventListener('error', onError);
      window.clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const onEvent = () => finish();
    const onError = () => finish(new Error('video failed'));
    const timer = window.setTimeout(() => finish(new Error('timeout')), timeout);
    element.addEventListener(event, onEvent, { once: true });
    element.addEventListener('error', onError, { once: true });
  });
}

/** 数一张 36×36 的小图里的主色，逻辑和图片那条完全一致。 */
function sample(context: CanvasRenderingContext2D, size: number): string[] {
  const { data } = context.getImageData(0, 0, size, size);
  const buckets = new Map<string, { r: number; g: number; b: number; count: number; weight: number }>();
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index], g = data[index + 1], b = data[index + 2], alpha = data[index + 3];
    if (alpha < 140) continue;
    const high = Math.max(r, g, b), low = Math.min(r, g, b);
    if (high < 22 || low > 240) continue;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, weight: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
    bucket.weight += 1 + (high - low) / 96;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .sort((a, b) => b.weight * Math.sqrt(b.count) - a.weight * Math.sqrt(a.count))
    .map(bucket => toHex([bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count]));
  const picked: string[] = [];
  for (const color of ranked) {
    if (picked.length >= 4) break;
    if (picked.every(seen => Math.abs(seen.charCodeAt(1) - color.charCodeAt(1)) + Math.abs(seen.charCodeAt(3) - color.charCodeAt(3)) + Math.abs(seen.charCodeAt(5) - color.charCodeAt(5)) > 34)) picked.push(color);
  }
  return picked;
}

/**
 * 取一段视频的主色。结果按 src 缓存——翻页、切版式都不该重抽一遍。
 * 视频在库里切来切去的时候，这份缓存省掉的是每一次都重新解码一帧。
 */
export function videoPalette(src: string): Promise<string[]> {
  const hit = cache.get(src);
  if (hit) return hit;
  const task = new Promise<string[]>(resolve => {
    if (typeof document === 'undefined') { resolve([]); return; }
    const size = 36;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    // 用一个游离的 video：不进 DOM，不发声，只为抽一帧。
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    let settled = false;
    const done = (value: string[]) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };

    if (!context) { resolve([]); return; }

    (async () => {
      try {
        video.src = src;
        await waitFor(video, 'loadedmetadata', READY_TIMEOUT);
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        // 跳到有内容的地方：12% 处越过片头，片子太短就取中点。
        video.currentTime = duration > 1.2 ? duration * 0.12 : duration * 0.5;
        await waitFor(video, 'seeked', READY_TIMEOUT);
        context.drawImage(video, 0, 0, size, size);
        done(sample(context, size));
      } catch {
        done([]);
      }
    })();
  });
  cache.set(src, task);
  return task;
}
