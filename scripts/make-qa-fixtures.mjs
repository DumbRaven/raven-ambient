import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { makeDemoMusic } from '../src/audio.ts';

await mkdir('.qa', { recursive: true });
await writeFile('.qa/test-melody.wav', Buffer.from(await makeDemoMusic().arrayBuffer()));
await writeFile('.qa/not-audio.mp3', 'This is intentionally not an audio file.');
const crc = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
};
const width = 640, height = 360, header = Buffer.alloc(13);
header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
const pixels = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const at = y * (width * 3 + 1) + 1 + x * 3;
  pixels[at] = 190; pixels[at + 1] = 85; pixels[at + 2] = 95;
}
await writeFile('.qa/rose-palette.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
await mkdir('.qa/cabinet-music', { recursive: true });
await mkdir('.qa/cabinet-ambient', { recursive: true });
function wave(seconds, generator) {
  const rate = 22050, length = rate * seconds, bytes = Buffer.alloc(44 + length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + length * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, generator(i / rate))) * 32767), 44 + i * 2);
  return bytes;
}
await writeFile('.qa/cabinet-music/01 - 月光来信.wav', wave(6, t => Math.sin(t * Math.PI * 2 * 261.63) * .12 * Math.min(1, t * 10, (6 - t) * 5)));
await writeFile('.qa/cabinet-music/02 - 缓慢的午后.wav', wave(6, t => Math.sin(t * Math.PI * 2 * 329.63) * .12 * Math.min(1, t * 10, (6 - t) * 5)));
await writeFile('.qa/cabinet-music/readme.txt', 'Non-audio fixture: folder import should skip this file.');
await writeFile('.qa/cabinet-ambient/窗边的雨.wav', wave(8, t => (Math.random() * 2 - 1) * .06 * Math.min(1, t * 20, (8 - t) * 20)));
await writeFile('.qa/cabinet-ambient/松林微风.wav', wave(8, t => (Math.random() * 2 - 1) * .04 * Math.min(1, t * 20, (8 - t) * 20)));
console.log('Created local test fixtures in .qa/');
