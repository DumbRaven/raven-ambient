/**
 * macOS 的外部音乐解析。
 *
 * 测的是 `electron/now-playing-mac.cjs` 里的 `parseLine`：把 media-control
 * 吐的一行 JSON 翻成页面认得的快照。
 *
 * **这个文件最值得测的原因是它无法在本机验证**：Windows 上没有
 * media-control，`start()` 会直接返回 false，整条路径跑不起来。
 * 而 `parseLine` 是纯函数，只要字段映射错了，页面那边就会
 * 「有歌在放但什么都不显示」——这种 bug 只能靠测试挡。
 *
 * 字段契约见 `src/now-playing.ts` 的 `parseNowPlaying`：
 *   - `status` 必须是 'Playing' / 'Paused' / 'Stopped' / 'None' 之一
 *   - `cover` 必须以 `data:image/` 开头，否则页面会丢掉
 *   - `playing` 由页面从 status 反推，这里给的是给页面看的冗余字段
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { parseLine } = require('../electron/now-playing-mac.cjs');

/** media-control 的 `stream` 形状：外面裹一层 { diff, payload }。 */
function stream(payload: object) {
  return JSON.stringify({ diff: false, payload });
}

/** media-control 的 `get` 形状：平铺。 */
function flat(payload: object) {
  return JSON.stringify(payload);
}

test('正在播放的歌：status 是 Playing，封面拼成 data URL', () => {
  const got = parseLine(
    stream({
      title: 'Blue in Green',
      artist: 'Miles Davis',
      album: 'Kind of Blue',
      playing: true,
      bundleIdentifier: 'com.spotify.client',
      artworkData: 'AAAA',
      artworkMimeType: 'image/jpeg',
    }),
  );
  assert.deepEqual(got, {
    app: 'com.spotify.client',
    title: 'Blue in Green',
    artist: 'Miles Davis',
    album: 'Kind of Blue',
    status: 'Playing',
    playing: true,
    cover: 'data:image/jpeg;base64,AAAA',
  });
});

test('暂停时有标题但 playing 是 false，status 必须是 Paused', () => {
  const got = parseLine(stream({ title: '夜航', playing: false }));
  assert.equal(got?.status, 'Paused');
  assert.equal(got?.playing, false);
});

test('没有标题就是 None——不能猜成 Paused', () => {
  // 播完了 / 播放器关了，media-control 会吐一个只有 playing:false 的空壳。
  // 这时如果当成 Paused，页面会显示「已暂停」但上面什么都没有。
  const got = parseLine(stream({ playing: false }));
  assert.equal(got?.status, 'None');
});

test('get 的平铺形状与 stream 的包裹形状解析结果完全一样', () => {
  const payload = { title: 'Ocean', artist: 'DumbRaven', playing: true };
  assert.deepEqual(parseLine(flat(payload)), parseLine(stream(payload)));
});

test('封面缺 MIME 时退回 image/jpeg，不能拼出 data:;base64', () => {
  // media-control 在不支持的格式上可能不给 artworkMimeType。
  // 拼成 "data:;base64,..." 的话页面那句 startsWith('data:image/') 会判 false，
  // 封面就白丢了——宁可给它一个大概率对的默认。
  const got = parseLine(stream({ title: 'x', playing: true, artworkData: 'BBBB' }));
  assert.equal(got?.cover, 'data:image/jpeg;base64,BBBB');
});

test('没有封面时 cover 是空串', () => {
  const got = parseLine(stream({ title: 'x', playing: true }));
  assert.equal(got?.cover, '');
});

test('字段类型不对时收成空串，不把 undefined 漏给页面', () => {
  const got = parseLine(stream({ title: 42, artist: null, album: undefined, playing: 'yes' }));
  // title 不是字符串 → 当作没有标题；playing 不是 true → 不是 Playing。
  assert.equal(got?.title, '');
  assert.equal(got?.artist, '');
  assert.equal(got?.album, '');
  assert.equal(got?.status, 'None');
});

test('不是 JSON 的行返回 null，调用方据此跳过', () => {
  assert.equal(parseLine('not json'), null);
  assert.equal(parseLine(''), null);
  assert.equal(parseLine('null'), null);
  assert.equal(parseLine('[]'), null);
});
