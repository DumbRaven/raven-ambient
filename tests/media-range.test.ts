/**
 * `electron/media-response.cjs` 的行为测试。
 *
 * 这几条覆盖的是一类**静默失败**：状态码错了不会抛异常，只会让 <video>
 * 拖不动进度条、或者 moov 在尾部的 MP4 永远起不了播。所以必须逐项钉住。
 *
 * 注意 CJS/ESM 的边界：源码里 electron/ 下是 CommonJS（`module.exports`），
 * 测试这边是 ESM（`import`）。`createRequire` 就是桥——直接写 `require`
 * 会报 `ReferenceError: require is not defined in ES module scope`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { parseRange, mimeOf, mediaResponse } = require('../electron/media-response.cjs');

/** 直接调 mediaResponse，把响应读回成 Buffer。绕开真实 protocol 的生命周期。 */
async function fetchLike(file: string, size: number, range: string | null) {
  const headers = new Headers();
  if (range !== null) headers.set('range', range);
  const response = mediaResponse(file, { headers }, size);
  return {
    status: response.status,
    headers: response.headers,
    body: Buffer.from(await response.arrayBuffer()),
  };
}

test('parseRange 认得几种写法，认不出就退回整段', () => {
  assert.deepEqual(parseRange('bytes=0-1023', 1000), { start: 0, end: 999 }, '要的结尾超过文件尾就截到尾部');
  assert.deepEqual(parseRange('bytes=100-', 1000), { start: 100, end: 999 });
  assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
  assert.deepEqual(parseRange('bytes=-200', 100), { start: 0, end: 99 }, '尾段比文件长就整段给');
  assert.equal(parseRange(null, 1000), null, '没有 Range 头');
  assert.equal(parseRange('', 1000), null);
  assert.equal(parseRange('items=0-10', 1000), null, '单位不是 bytes');
  assert.equal(parseRange('bytes=0-10,20-30', 1000), null, '多段按整段处理');
  assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable', '起点越过文件尾');
  assert.equal(parseRange('bytes=500-100', 1000), null, '结尾早于起点');
});

test('mimeOf 认得出视频与图片，认不出给 octet-stream', () => {
  assert.equal(mimeOf('a/b/c.MP4'), 'video/mp4');
  assert.equal(mimeOf('x.webm'), 'video/webm');
  assert.equal(mimeOf('x.jpg'), 'image/jpeg');
  assert.equal(mimeOf('x.unknownext'), 'application/octet-stream');
});

test('空文件不炸，回 200 + 空 body', async () => {
  // 回归测试：`size = 0` 时 `end = -1`，`createReadStream(start:0, end:-1)`
  // 会同步抛 ERR_OUT_OF_RANGE，从协议处理器里冒成未捕获错误。
  // 用户看到的是「这个文件坏了」，而空文件其实很常见：刚创建的占位、下载残片。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-empty-'));
  const file = path.join(dir, 'empty.mp4');
  fs.writeFileSync(file, Buffer.alloc(0));
  try {
    const size = fs.statSync(file).size;
    assert.equal(size, 0, '前提：真的是空文件');

    const plain = await fetchLike(file, size, null);
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get('Content-Length'), '0');
    assert.equal(plain.body.byteLength, 0);

    // 带 Range 也不能走 416：文件在、就是空的，回 200 空 body 才准确
    const ranged = await fetchLike(file, size, 'bytes=0-1023');
    assert.equal(ranged.status, 200);
    assert.equal(ranged.body.byteLength, 0);

    const open = await fetchLike(file, size, 'bytes=0-');
    assert.equal(open.status, 200);
    assert.equal(open.body.byteLength, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mediaResponse 按 Range 回 206，字节数与 Content-Range 都对', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-response-'));
  const file = path.join(dir, 'sample.mp4');
  // 造一个 10000 字节、内容可预测的文件，方便核对读出来的是哪一段
  fs.writeFileSync(file, Buffer.from(Array.from({ length: 10000 }, (_, at) => at % 251)));
  try {
    const size = fs.statSync(file).size;

    const full = await fetchLike(file, size, null);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('Content-Length'), '10000');
    assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
    assert.equal(full.headers.get('Content-Type'), 'video/mp4');
    assert.equal(full.headers.get('Content-Range'), null);
    assert.equal(full.body.byteLength, 10000);

    const ranged = await fetchLike(file, size, 'bytes=0-1023');
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('Content-Range'), 'bytes 0-1023/10000');
    assert.equal(ranged.headers.get('Content-Length'), '1024');
    assert.equal(ranged.body.byteLength, 1024);
    assert.equal(ranged.body[0], 0);
    assert.equal(ranged.body[1], 1);

    const tail = await fetchLike(file, size, 'bytes=-4096');
    assert.equal(tail.status, 206);
    assert.equal(tail.headers.get('Content-Range'), 'bytes 5904-9999/10000');
    assert.equal(tail.body.byteLength, 4096);
    assert.equal(tail.body[0], 5904 % 251, '尾部第一字节应当是第 5904 字节');

    const open = await fetchLike(file, size, 'bytes=9000-');
    assert.equal(open.status, 206);
    assert.equal(open.headers.get('Content-Range'), 'bytes 9000-9999/10000');
    assert.equal(open.body.byteLength, 1000);

    const over = await fetchLike(file, size, 'bytes=10000-');
    assert.equal(over.status, 416);
    assert.equal(over.headers.get('Content-Range'), 'bytes */10000');

    const junk = await fetchLike(file, size, 'items=0-5');
    assert.equal(junk.status, 200, '认不出的 Range 退回整段，不要 400');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
