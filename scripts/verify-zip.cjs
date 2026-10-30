// 严格校验一个 zip：读中央目录里的 CRC，解压数据，自己算一遍比对。
// .NET 的 ZipArchive / Expand-Archive 不校验 CRC，7-Zip 会——用户报的就是 7-Zip 的错误。
const fs = require('node:fs');
const zlib = require('node:zlib');

function verify(file) {
  const buf = fs.readFileSync(file);
  // 从尾部找中央目录结束记录
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('找不到中央目录');
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);

  let cursor = cdOffset;
  const bad = [];
  const ok = [];
  for (let index = 0; index < count; index++) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) throw new Error('中央目录签名不对 @' + cursor);
    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const crc = buf.readUInt32LE(cursor + 16);
    const compSize = buf.readUInt32LE(cursor + 20);
    const size = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cursor += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) { ok.push(name); continue; }

    // 本地头里 name/extra 长度可能与中央目录不同，按本地头自己算数据起点
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('本地头签名不对 @' + localOffset);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    const raw = method === 0 ? compressed : zlib.inflateRawSync(compressed);
    const actual = zlib.crc32(raw);
    if (raw.length !== size) bad.push(`${name}: 长度 ${raw.length} != 头部 ${size}`);
    else if (actual !== crc) bad.push(`${name}: CRC ${actual.toString(16)} != 头部 ${crc.toString(16)}`);
    else ok.push(name);
  }
  return { count, ok: ok.length, bad };
}

module.exports = { verify };

// 命令行用法：node scripts/verify-zip.cjs <某个.zip>
if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('用法：node scripts/verify-zip.cjs <file.zip>');
    process.exitCode = 2;
  } else {
    const result = verify(target);
    console.log('条目数 =', result.count, '/ 通过 =', result.ok, '/ 不通过 =', result.bad.length);
    if (result.bad.length) {
      for (const line of result.bad.slice(0, 10)) console.log('  ✖', line);
      process.exitCode = 1;
    } else {
      console.log('全部条目 CRC 与长度校验通过');
    }
  }
}
