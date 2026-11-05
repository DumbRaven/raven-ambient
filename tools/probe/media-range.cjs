/**
 * 查 media:// 到底支不支持 Range 请求。
 *
 * 这是「有些视频不能放映 / 放映有破损」最可能的根因：
 *   - `net.fetch(file://...)` 会不会把请求里的 Range 头带下去？
 *   - 如果返回 200 而不是 206，Chromium 就没法按段读，只能整段下载；
 *     一个 moov 在文件尾的 121MB MP4，得先下完才能知道时长——表现就是转圈、花屏、只出几帧。
 *
 * 判据：带 Range 的请求必须回 206；Content-Range 的 total 必须等于文件大小。
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const os = require('node:os');
const { launch, report, guard, wait } = require('./harness.cjs');

const WE = 'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\431960';

function workshop(pattern) {
  for (const dir of fs.readdirSync(WE)) {
    const full = path.join(WE, dir);
    let project;
    try { project = JSON.parse(fs.readFileSync(path.join(full, 'project.json'), 'utf8')); } catch { continue; }
    if (!pattern.test(project.title || '')) continue;
    const file = path.join(full, project.file || '');
    if (fs.existsSync(file)) return { path: file, name: project.title, size: fs.statSync(file).size };
  }
  return null;
}

const ocean = workshop(/^Ocean/);
const tokyo = workshop(/^Tokyo/);

const urlOf = file => 'media://local/' + encodeURIComponent(file);

const PROBE = `(async (url) => {
  const out = { url: url.slice(-30) };
  // ① 整段：看是不是 200 + 有没有 Accept-Ranges
  const plain = await fetch(url);
  out.plain = {
    status: plain.status,
    acceptRanges: plain.headers.get('accept-ranges'),
    contentLength: plain.headers.get('content-length'),
    contentType: plain.headers.get('content-type'),
  };
  // 别把整个 90MB 读完
  try { await plain.body?.cancel(); } catch {}

  // ② 要 0..1023 这一段
  const ranged = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  out.ranged = {
    status: ranged.status,
    contentRange: ranged.headers.get('content-range'),
    contentLength: ranged.headers.get('content-length'),
  };
  const buf = await ranged.arrayBuffer();
  out.ranged.bytes = buf.byteLength;

  // ③ 要文件尾部的一段：moov 在尾部的文件全靠这个才能起播
  const tail = await fetch(url, { headers: { Range: 'bytes=-4096' } });
  out.tail = { status: tail.status, contentRange: tail.headers.get('content-range') };
  try { await tail.body?.cancel(); } catch {}
  return out;
})`;

guard(async () => {
  const probe = await launch({ expand: false, patch: { media: [], mediaDirs: [] } });
  await wait(300);
  const results = [];
  for (const [name, item] of [['ocean', ocean], ['tokyo', tokyo]]) {
    if (!item) continue;
    const value = await probe.run(`${PROBE}(${JSON.stringify(urlOf(item.path))})`);
    results.push({ name, fileSize: item.size, ...value });
  }
  report(results);
});
