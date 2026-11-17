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
import { pickPalette } from './vinyl';

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

/**
 * 数一张 36×36 的小图里的主色。
 *
 * 分桶、排序、挑四色的实现已经搬到 `vinyl.ts` 的 `pickPalette`，封面和视频
 * 共用同一份——包括去重判据（真实 RGB 色距 > 34）。
 *
 * 原来这里单独写了一份、去重判据比的是十六进制字符串里对应字符的编码差，
 * 注释说这是「有意留着的差异，要统一得先给视频抽色加一条锁住输出的测试」。
 * 2026-11-17 统一了，原因写在 `pickPalette` 的注释里：那条判据在深色画面上
 * 几乎永远只放得出一个色，164 个真实视频里 62 个「挑一个」只有一块可点。
 * `tests/video-palette.test.ts` 补上了当时缺的那条锁输出的测试。
 */
function sample(context: CanvasRenderingContext2D, size: number): string[] {
  return pickPalette(context, size);
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
