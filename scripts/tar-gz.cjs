// 把目录打成一个 tar.gz，纯 Node 实现，不调用外部的 tar 程序。
//
// 为什么自己写：release workflow 里用系统自带的 bsdtar（`tar -c -z`）打包 260 MB 时
// 会在 GitHub Actions 的 runner 上以 0xC0000005（访问冲突）崩掉，本地每次成功。
// 换成 xz 也一样崩，说明不是压缩算法的问题，是那个 tar 程序在 runner 上的问题。
// 发版流程不该依赖一个「本地能跑、CI 崩」的二进制，所以这里直接用 Node 写 tar 格式。
//
// 关于中文文件名：ustar 头的 name 字段按规范是「原始字节」，但 Windows 上的 bsdtar
// 会拿本地代码页（GBK）去解码，UTF-8 的中文名会变成乱码甚至报
// `Invalid empty pathname`。POSIX 给这种情况留的出口是 PAX 扩展头：在真条目之前
// 插一个 typeflag='x' 的小文件，里面用 `path=` 显式写 UTF-8 全名，解包器就会照它来。
// 所以凡是名字含非 ASCII 或超过 100 字节，这里都会补一个 PAX 头。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { once } = require('node:events');

const BLOCK = 512;

// tar 头里的数字都是「八进制文本 + 结尾一个 NUL」，长度固定。
function octal(buf, value, offset, length) {
  const text = Math.max(0, Math.floor(value)).toString(8);
  if (text.length > length - 1) throw new Error(`数值 ${value} 放不进 ${length} 字节的八进制字段`);
  buf.write(text.padStart(length - 1, '0'), offset, length - 1, 'ascii');
  buf[offset + length - 1] = 0;
}

function header(name, size, mode, typeflag, mtime) {
  const buf = Buffer.alloc(BLOCK);
  buf.write(name.slice(0, 100), 0, 100, 'utf8');
  octal(buf, mode, 100, 8);
  octal(buf, 0, 108, 8); // uid
  octal(buf, 0, 116, 8); // gid
  octal(buf, size, 124, 12);
  octal(buf, mtime, 136, 12);
  buf.write('        ', 148, 8, 'ascii'); // 校验和先占 8 个空格
  buf.write(typeflag, 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');

  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += buf[i];
  // 校验和的标准写法：6 位八进制 + NUL + 空格
  buf.write(sum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  buf[154] = 0;
  buf[155] = 0x20;
  return buf;
}

// PAX 记录格式：`<总长度> <key>=<value>\n`，总长度包含它自己那几位数字和一个空格。
function paxRecord(key, value) {
  const body = `${key}=${value}\n`;
  const bodyLength = Buffer.byteLength(body, 'utf8');
  let total = bodyLength + 2;
  // 长度前缀本身的位数会影响总长，迭代到稳定（最多两三轮）
  for (;;) {
    const next = bodyLength + String(total).length + 1;
    if (next === total) break;
    total = next;
  }
  return `${total} ${body}`;
}

function needsPax(name) {
  return Buffer.byteLength(name, 'utf8') > 100 || /[^\x20-\x7E]/.test(name);
}

/**
 * @param {string} srcDir 要打包的目录
 * @param {string} entryName 包里的顶层目录名（解压后得到的文件夹名）
 * @param {string} destFile 输出 .tar.gz
 * @param {(done: number, total: number) => void} [onProgress] 每传完约 20 MB 回调一次
 * @param {number} [totalBytes] 总字节数，只用于算进度百分比
 */
async function pack(srcDir, entryName, destFile, onProgress, totalBytes = 0) {
  const total = totalBytes;

  const gz = zlib.createGzip({ level: 9 });
  const out = fs.createWriteStream(destFile);
  gz.pipe(out);

  let done = 0;
  let lastReport = 0;
  let paxIndex = 0;

  const write = async (chunk) => {
    if (!gz.write(chunk)) await once(gz, 'drain');
  };
  const pad = (size) => ((BLOCK - (size % BLOCK)) % BLOCK);
  const padTo = async (size) => {
    const remain = pad(size);
    if (remain) await write(Buffer.alloc(remain));
  };

  // 给「解包器会读错名字」的条目补一个 PAX 扩展头。
  // 扩展头本身的名字必须是纯 ASCII，所以用 PaxHeaders/<序号>。
  const writePax = async (name, mtime) => {
    const payload = Buffer.from(paxRecord('path', name), 'utf8');
    const tag = `PaxHeaders/${paxIndex}`;
    paxIndex += 1;
    await write(header(tag, payload.length, 0o644, 'x', mtime));
    await write(payload);
    await padTo(payload.length);
  };

  const addEntry = async (abs, name, typeflag, size, mode) => {
    const stat = fs.statSync(abs);
    const mtime = Math.floor(stat.mtimeMs / 1000);
    if (needsPax(name)) await writePax(name, mtime);
    // 有 PAX 头时这里的 name 只作兜底，解包器会用 PAX 里的 path；
    // 仍然截断到 100 字节内，免得留下非法头。
    const fallback = Buffer.from(name, 'utf8').subarray(0, 100).toString('utf8').replace(/\uFFFD+$/, '');
    await write(header(fallback || 'placeholder', size, mode, typeflag, mtime));
  };

  const addFile = async (abs, name) => {
    const stat = fs.statSync(abs);
    await addEntry(abs, name, '0', stat.size, 0o644);
    const stream = fs.createReadStream(abs, { highWaterMark: 1024 * 1024 });
    for await (const chunk of stream) {
      await write(chunk);
      done += chunk.length;
      if (onProgress && total > 0 && done - lastReport > 20 * 1024 * 1024) {
        lastReport = done;
        onProgress(done, total);
      }
    }
    await padTo(stat.size);
  };

  const walk = async (dir, name) => {
    const stat = fs.statSync(dir);
    await addEntry(dir, `${name}/`, '5', 0, 0o755);
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const child = `${name}/${entry.name}`;
      if (entry.isDirectory()) await walk(full, child);
      else if (entry.isFile()) await addFile(full, child);
    }
  };

  await walk(srcDir, entryName);
  await write(Buffer.alloc(BLOCK * 2)); // 两个全零块表示归档结束

  gz.end();
  await once(out, 'finish');
  return fs.statSync(destFile).size;
}

module.exports = { pack };
