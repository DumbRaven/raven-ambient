// 把目录打成一个 zip，纯 Node 实现，不调用任何外部程序。
//
// 为什么自己写而不是调系统的 tar / Compress-Archive：
// 1. 系统的 bsdtar 在 GitHub Actions 的 runner 上压 260 MB 会以 0xC0000005（访问冲突）
//    崩掉，本地却每次成功。发版流程不能押在一个「本地能跑、CI 崩」的二进制上。
// 2. Compress-Archive 在 pwsh 里能跑，但它会把整个目录重新读一遍、而且不同 PowerShell
//    版本行为有细微差别；用 Node 写死，本地和 CI 就是同一段代码。
//
// 为什么是 zip 而不是 tar.gz：两种格式实测体积几乎一样（zip 114.1 MB / tar.gz 110.9 MB，
// 差 3%），但 zip 双击就能解压，不用额外配一个 .cmd 脚本。分发体验换这 3 MB 值。
//
// 关于中文文件名：zip 没有 PAX 那种扩展头，标准做法是打开通用标志位第 11 位
// （UTF-8 标志），让解包器按 UTF-8 解 name 字段。Windows 10 之后的资源管理器和
// 7-Zip 都认这一位，所以「可选-虚拟声卡」「先看这里.txt」这类名字不会变乱码。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Transform } = require('node:stream');

const UTF8_FLAG = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

// zip 里的时间用 MS-DOS 格式：秒只有 2 秒精度，年份从 1980 起算。
function dosStamp(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

function localHeader(name, method, flags, stamp, crc, compSize, size) {
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4); // 解压需要的版本 2.0
  head.writeUInt16LE(flags, 6);
  head.writeUInt16LE(method, 8);
  head.writeUInt16LE(stamp.time, 10);
  head.writeUInt16LE(stamp.date, 12);
  head.writeUInt32LE(crc >>> 0, 14);
  head.writeUInt32LE(compSize, 18);
  head.writeUInt32LE(size, 22);
  head.writeUInt16LE(name.length, 26);
  head.writeUInt16LE(0, 28); // 没有 extra 字段
  return Buffer.concat([head, name]);
}

function centralHeader(entry) {
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(0x031e, 4); // 生成者：UNIX，版本 3.0
  head.writeUInt16LE(20, 6);
  head.writeUInt16LE(entry.flags, 8);
  head.writeUInt16LE(entry.method, 10);
  head.writeUInt16LE(entry.stamp.time, 12);
  head.writeUInt16LE(entry.stamp.date, 14);
  head.writeUInt32LE(entry.crc >>> 0, 16);
  head.writeUInt32LE(entry.compSize, 20);
  head.writeUInt32LE(entry.size, 24);
  head.writeUInt16LE(entry.name.length, 28);
  head.writeUInt16LE(0, 30); // extra
  head.writeUInt16LE(0, 32); // comment
  head.writeUInt16LE(0, 34); // 起始磁盘
  head.writeUInt16LE(0, 36); // 内部属性
  // 外部属性：高 16 位放 UNIX 权限位。这里必须 `>>> 0`——
  // JS 的 `<<` 是 32 位有符号位移，`0o100644 << 16` 会变成负数，
  // writeUInt32LE 直接抛 "out of range"。
  head.writeUInt32LE(entry.external >>> 0, 38);
  head.writeUInt32LE(entry.localOffset, 42);
  return Buffer.concat([head, entry.name]);
}

function endOfCentral(count, cdSize, cdOffset) {
  const head = Buffer.alloc(22);
  head.writeUInt32LE(0x06054b50, 0);
  head.writeUInt16LE(0, 4);
  head.writeUInt16LE(0, 6);
  head.writeUInt16LE(count, 8);
  head.writeUInt16LE(count, 10);
  head.writeUInt32LE(cdSize, 12);
  head.writeUInt32LE(cdOffset, 16);
  head.writeUInt16LE(0, 20);
  return head;
}

/**
 * @param {string} srcDir 要打包的目录，它自己会成为压缩包里唯一的顶层文件夹
 * @param {string} destFile 输出 .zip
 * @param {(done: number, total: number) => void} [onProgress] 每传完约 20 MB 回调一次
 * @param {number} [totalBytes] 总字节数，只用于算进度百分比
 */
async function pack(srcDir, destFile, onProgress, totalBytes = 0) {
  const rootName = path.basename(srcDir);
  const fd = fs.openSync(destFile, 'w');
  const entries = [];
  let offset = 0;
  let done = 0;
  let lastReport = 0;

  const write = (buf) => {
    fs.writeSync(fd, buf, 0, buf.length, offset);
    offset += buf.length;
  };

  const addEntry = async (abs, name, isDir) => {
    const stat = fs.statSync(abs);
    const stamp = dosStamp(stat.mtime);
    const nameBuf = Buffer.from(isDir ? `${name}/` : name, 'utf8');
    const flags = UTF8_FLAG;
    const localOffset = offset;

    // 目录不存数据，用 store；文件用 deflate。哈希和压缩后长度要等数据写完才知道，
    // 所以先占位写一个头，回头在这里按偏移量补写一遍。
    if (isDir) {
      write(localHeader(nameBuf, METHOD_STORE, flags, stamp, 0, 0, 0));
      entries.push({
        name: nameBuf, flags, method: METHOD_STORE, stamp, crc: 0,
        compSize: 0, size: 0, external: (0o040755 << 16) | 0x10, localOffset,
      });
      return;
    }

    const headerSize = 30 + nameBuf.length;
    write(localHeader(nameBuf, METHOD_DEFLATE, flags, stamp, 0, 0, 0));

    const source = fs.createReadStream(abs, { highWaterMark: 1024 * 1024 });
    const deflate = zlib.createDeflateRaw({ level: 9 });

    // zip 头里的 CRC 是**未压缩数据**的校验和，不是压缩流的。
    // 在 deflate 的输出上算 CRC 会让每个文件都过不了校验，
    // 解压时整包报「雜湊驗算發生錯誤 / 壓縮檔已經毀損」——曾经就是这么坏的。
    // 所以先插一个只旁听不改内容的 Transform，在原始字节上算。
    let crc = 0;
    const tap = new Transform({
      transform(chunk, _encoding, callback) {
        crc = zlib.crc32(chunk, crc);
        callback(null, chunk);
      },
    });
    source.pipe(tap).pipe(deflate);

    // 注意不要在这里再 `await once(source, 'end')`：for-await 把 deflate 读完时
    // source 早就触发过 end 了，补一个 once 会永远挂起，进程在无句柄时静默退出，
    // 产出一个只有第一个文件头的残包。
    let compSize = 0;
    for await (const chunk of deflate) {
      write(chunk);
      compSize += chunk.length;
    }

    done += stat.size;
    if (onProgress && totalBytes > 0 && done - lastReport > 20 * 1024 * 1024) {
      lastReport = done;
      onProgress(Math.min(done, totalBytes), totalBytes);
    }

    const size = stat.size;
    const patch = localHeader(nameBuf, METHOD_DEFLATE, flags, stamp, crc, compSize, size);
    fs.writeSync(fd, patch, 0, patch.length, localOffset);

    entries.push({
      name: nameBuf, flags, method: METHOD_DEFLATE, stamp,
      crc, compSize, size, external: 0o100644 << 16, localOffset,
    });
  };

  const walk = async (dir, name) => {
    await addEntry(dir, name, true);
    const children = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const full = path.join(dir, child.name);
      const inside = `${name}/${child.name}`;
      if (child.isDirectory()) await walk(full, inside);
      else if (child.isFile()) await addEntry(full, inside, false);
    }
  };

  try {
    await walk(srcDir, rootName);

    const cdOffset = offset;
    for (const entry of entries) write(centralHeader(entry));
    const cdSize = offset - cdOffset;
    write(endOfCentral(entries.length, cdSize, cdOffset));
  } finally {
    fs.closeSync(fd);
  }

  return fs.statSync(destFile).size;
}

module.exports = { pack };
