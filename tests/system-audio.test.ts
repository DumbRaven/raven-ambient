/**
 * mac 系统音频这一层的可测部分。
 *
 * 只测纯函数与纯状态机：真正的抓取要 Core Audio、要 TCC 权限、要真机，
 * 那些只能在 Mac 上验（见 docs/macOS-实测记录.md 第 5.4 节）。
 * 但「字节怎么转」「状态怎么翻成话」这两件事有确定性答案，值得钉住——
 * 它们错了，症状都是「没声音」，而没声音是最难查的一种。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmToFloat } from '../src/audio-tap.ts';
import { systemAudioHint } from '../src/system-audio.ts';

/** 造一段 16 位小端 PCM。 */
function pcm(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

test('PCM 转浮点：满量程与零点都落在 [-1, 1] 内', () => {
  const out = pcmToFloat(pcm([0, 32767, -32768, 16384]));
  assert.equal(out.length, 4);
  assert.equal(out[0], 0);
  // 32767 不该被放大到 1 以上
  assert.ok(out[1] < 1, `正满量程应小于 1，实际 ${out[1]}`);
  assert.ok(out[1] > 0.999, `正满量程应接近 1，实际 ${out[1]}`);
  // -32768 除以 32768 正好是 -1；用 32767 会得到 -1.0000305 并被裁
  assert.equal(out[2], -1);
  assert.equal(out[3], 0.5);
});

test('PCM 转浮点：结果是普通 ArrayBuffer，能直接交给 AudioData', () => {
  const out = pcmToFloat(pcm([1, 2, 3]));
  // AudioData 的 data 要求 ArrayBufferView<ArrayBuffer>。
  // `new Float32Array(n)` 在 TS 5.9 里会被推断成 ArrayBufferLike（含 SharedArrayBuffer），
  // 传进去编译期就报错。这条测试钉住「底层确实是普通 ArrayBuffer」。
  assert.ok(out.buffer instanceof ArrayBuffer, '底层应当是普通 ArrayBuffer');
  assert.ok(!(out.buffer instanceof SharedArrayBuffer), '不该是 SharedArrayBuffer');
});

test('PCM 转浮点：奇数字节只取完整样本，不抛异常', () => {
  // 管道给的片段永远可能在样本中间断开，这一层必须自己扛住。
  const odd = pcm([100]).slice(0, 1);
  const out = pcmToFloat(odd);
  assert.equal(out.length, 0);
});

test('PCM 转浮点：忽略 byteOffset，只读属于这一段的那几个字节', () => {
  const whole = pcm([1000, -1000, 500]);
  // 模拟 Buffer.subarray 得到的视图：底层 ArrayBuffer 更大，byteOffset 不为 0
  const view = new Uint8Array(whole.buffer, 2, 4);
  const out = pcmToFloat(view);
  assert.equal(out.length, 2);
  assert.equal(out[0], -1000 / 32768);
  assert.equal(out[1], 500 / 32768);
});

test('四种失败各有各的说法，不能混成一句', () => {
  const hints = {
    denied: systemAudioHint('denied'),
    missing: systemAudioHint('missing'),
    unsupported: systemAudioHint('unsupported'),
    error: systemAudioHint('error'),
  };
  const all = Object.values(hints);
  assert.equal(new Set(all).size, 4, '四种原因必须是四句不同的话');

  // 没权限那句必须指出具体去哪开——用户看到「没权限」之后唯一想问的就是这个。
  assert.ok(hints.denied.includes('系统设置'), '没权限时要指路到系统设置');
  assert.ok(hints.denied.includes('录屏与系统录音'), '要写出面板名');
  assert.ok(hints.denied.includes('仅系统录音'), '要写出具体那一节');

  // 缺程序是打包事故，用户自己修不了，别让他去翻设置。
  assert.ok(!hints.missing.includes('系统设置'), '缺程序不该让用户去系统设置里找');

  // 任何一句都不要提虚拟声卡：mac 上根本不需要那个东西，
  // 提了只会让人去搜一个不存在的下载页。
  for (const hint of all) {
    assert.ok(!hint.includes('虚拟声卡'), `mac 的提示里不该出现「虚拟声卡」：${hint}`);
    assert.ok(!hint.includes('VB-Cable'), `mac 的提示里不该出现 VB-Cable：${hint}`);
    assert.ok(!hint.includes('CABLE'), `mac 的提示里不该出现 CABLE：${hint}`);
  }
});

test('只有「没权限」这一种是用户能自己解决的，措辞要给出动作', () => {
  assert.ok(systemAudioHint('denied').includes('打开'), '要告诉用户去打开那个开关');
  // 其余三种不该出现「打开开关」这种让用户徒劳去点的指令
  assert.ok(!systemAudioHint('unsupported').includes('打开'), '不支持的时候没有开关可开');
});
