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
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { MacBackend, parseLine, toolPath } = require('../electron/now-playing-mac.cjs');

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

test('toolPath 只返回真实存在的那条候选，找不到就是空串', () => {
  // 这条**不能断言「一定为空」**。我在第一版里就是这么写的，结果在 Windows 上绿、
  // 在装了 media-control 的 Mac 上红——测试被「本机恰好没装」这个巧合骗过了。
  // 真正要钉住的是契约：返回的要么是空串，要么是磁盘上真实存在的文件；
  // 绝不能是「候选列表里的第一条」这种没验证过的字符串。
  const found = toolPath();
  assert.equal(typeof found, 'string');
  if (found !== '') {
    assert.ok(existsSync(found), `toolPath() 返回了 ${found}，但这个文件不存在`);
    assert.match(found, /media-control$/);
  }
});

test('候选路径包含用户自己安装的位置 ~/.local/bin', async () => {
  // 没装 brew 的机器（比如这台 Mac mini）只能把二进制放到 ~/.local/bin。
  // 少了这一条，装好了也认不出来。
  const source = await readFile(new URL('../electron/now-playing-mac.cjs', import.meta.url), 'utf8');
  assert.match(source, /\.local['"]\s*,\s*['"]bin['"]\s*,\s*['"]media-control['"]/);
});

test('先到的是歌名、后到的是封面——第二条不能被去重吃掉', () => {
  // 2026-11-28 真机抓到的 bug：系统分两步给数据，先歌名后封面。
  // 去重签名里若不含封面，第二条签名与第一条相同会被跳过，页面永远没封面。
  // 症状是「有时有、有时没有」，取决于两条消息哪条先到，极难复现。
  const sent: Array<{ title: string; cover: string }> = [];
  const backend = new MacBackend();
  backend.emit = (payload: { title: string; cover: string }) => { sent.push(payload); };

  // 第一条：只有文字，没有封面。
  backend.consume(`${stream({ title: 'Artwork Test', artist: 'A', album: 'B', playing: true })}\n`);
  // 第二条：同一首歌，补上封面（base64 内容随意，长度不同即可）。
  backend.consume(`${stream({ title: 'Artwork Test', artist: 'A', album: 'B', playing: true, artworkData: 'AAAA', artworkMimeType: 'image/jpeg' })}\n`);

  assert.equal(sent.length, 2, '第二条带封面的快照必须推给页面');
  assert.equal(sent[0].cover, '');
  assert.match(sent[1].cover, /^data:image\/jpeg;base64,/);

  // 第三条与第二条完全相同，应当被去重挡掉（否则每 200ms 重算一次配色会掉帧）。
  backend.consume(`${stream({ title: 'Artwork Test', artist: 'A', album: 'B', playing: true, artworkData: 'AAAA', artworkMimeType: 'image/jpeg' })}\n`);
  assert.equal(sent.length, 2, '内容没变时不应重复推送');
});

test('同一首歌，后面那条不带封面也不能把已显示的封面抹掉', () => {
  // 真机实测：封面稳定显示 8 秒后突然变空。原因是系统会反复推同一条消息，
  // 其中一部分不带 artwork——「带封面」→「不带封面」两条会连着推两次，
  // 唱盘中心就被清掉了。修法是同一首歌里把上一张封面留底补回去。
  const sent: Array<{ title: string; cover: string }> = [];
  const backend = new MacBackend();
  backend.emit = (payload: { title: string; cover: string }) => { sent.push(payload); };

  backend.consume(`${stream({ title: 'Same Song', playing: true, artworkData: 'BBBB', artworkMimeType: 'image/jpeg' })}\n`);
  assert.match(sent[0].cover, /^data:image\/jpeg;base64,/);

  // 同一条消息，这次不带封面（系统刷进度时就是这样）。
  backend.consume(`${stream({ title: 'Same Song', playing: true })}\n`);

  // 不该再推一次「没封面」的快照；就算推了，封面也必须是上一张。
  for (const item of sent) {
    assert.match(item.cover, /^data:image\/jpeg;base64,/, '同一首歌的封面不能被后来的无封面消息抹掉');
  }

  // 换了歌之后才允许没有封面（新歌的封面还没到）。
  sent.length = 0;
  backend.consume(`${stream({ title: 'Another Song', playing: true })}\n`);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cover, '', '换歌后不应沿用上一首的封面');
});
