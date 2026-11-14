/**
 * media:// 的响应体：自己解析 Range，按字节段回 206。
 *
 * 为什么不直接 `net.fetch(pathToFileURL(target))`：实测过，它把请求里的
 * `Range` 头整个丢掉——要 `bytes=0-1023` 也回 200 + 整个 92MB 文件，
 * 既没有 `Accept-Ranges` 也没有 `Content-Range`。对 <video> 来说是致命的：
 *
 *   - 拖不动进度条（每次都从头开始）；
 *   - **moov 在文件尾的 MP4 根本起不了播**。ffmpeg 默认把索引写在最后，
 *     Chromium 必须先把整个文件下完才知道时长和关键帧位置。121MB 的 4K
 *     片子走这条路，表现就是转圈、花屏、只出几帧——用户说的「放映有破损」。
 *
 * 所以这里换成自己读文件：Range 语义按 RFC 7233 实现，只认单段 bytes。
 */
const fs = require('node:fs');
const path = require('node:path');

/** 按扩展名给 MIME。给不准会让 <video> 直接不认这个源。 */
const MIME = new Map([
  ['.mp4', 'video/mp4'], ['.m4v', 'video/mp4'], ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'], ['.ogv', 'video/ogg'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  ['.wav', 'audio/wav'], ['.mp3', 'audio/mpeg'], ['.flac', 'audio/flac'],
  ['.ogg', 'audio/ogg'], ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'],
]);

function mimeOf(file) {
  return MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream';
}

/**
 * 解析单段 Range。返回 `{ start, end }`（闭区间），或者：
 *   - `null`：没有 Range 头，或语法不认识 → 按整段回 200
 *   - `'unsatisfiable'`：起点越过文件尾 → 回 416
 *
 * 多段 Range（`bytes=0-99,200-299`）这里按整段处理：视频播放器只用单段，
 * 为多段写一套 multipart/byteranges 不值得。
 */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    // `bytes=-500`：最后 500 字节
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    // 没写结尾就是「从这里到文件尾」，播放器最常用这一种
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return { start, end };
}

/** 把 fs 读流包成 web ReadableStream，边读边推，不把整段读进内存。 */
function streamOf(file, start, end) {
  const stream = fs.createReadStream(file, { start, end, highWaterMark: 1 << 20 });
  return new ReadableStream({
    start(controller) {
      stream.on('data', chunk => {
        controller.enqueue(new Uint8Array(chunk));
        // 消费端暂停时先别急着读下一块
        if (controller.desiredSize !== null && controller.desiredSize <= 0) stream.pause();
      });
      stream.on('end', () => controller.close());
      stream.on('error', error => controller.error(error));
    },
    pull() { stream.resume(); },
    cancel(reason) { stream.destroy(reason instanceof Error ? reason : undefined); },
  });
}

/**
 * 给一个绝对路径造响应。`size` 由调用方传进来，省一次 statSync。
 *
 * 注意：这里假定调用方已经过了白名单与「是不是文件」两道检查。
 */
function mediaResponse(target, request, size) {
  const range = parseRange(request.headers.get('range'), size);
  const common = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeOf(target),
    // 媒体文件按路径区分就够了；加 immutable 让来回切页时不重新发请求
    'Cache-Control': 'no-store',
  };

  // 空文件要单独接住，而且必须排在 `unsatisfiable` 之前——实测过：
  // `size = 0` 时 `parseRange('bytes=0-1023', 0)` 返回 `'unsatisfiable'`，
  // 顺序反过来就永远走 416，下面这段根本执行不到。
  //
  // 为什么是 200 而不是 416：`size = 0` 时 `end = -1`，`createReadStream(start:0, end:-1)`
  // 直接抛 ERR_OUT_OF_RANGE —— 那不是「读不到」，是同步异常，会从协议处理器里
  // 冒成未捕获错误。用户那边看到的是「这张图/这个视频坏了」，而文件本身没问题
  // （空文件常见于刚创建的占位文件、下载中断的残片、编辑器写一半崩掉）。
  //
  // 416 的语义是「你请求的范围没法满足」，浏览器收到会当成服务端拒绝，
  // 把排障方向引到白名单或权限上去——而真相是文件在、就是空的。
  // 回 200 在规范上也站得住：RFC 7233 允许服务端忽略 Range 回整段，
  // 0 字节文件的「整段」就是空 body。
  if (size === 0) {
    return new Response(new Uint8Array(0), {
      status: 200,
      headers: { ...common, 'Content-Length': '0' },
    });
  }

  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...common, 'Content-Range': `bytes */${size}` },
    });
  }

  if (!range) {
    return new Response(streamOf(target, 0, size - 1), {
      status: 200,
      headers: { ...common, 'Content-Length': String(size) },
    });
  }

  const { start, end } = range;
  return new Response(streamOf(target, start, end), {
    status: 206,
    headers: {
      ...common,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
    },
  });
}

module.exports = { mediaResponse, parseRange, mimeOf };
