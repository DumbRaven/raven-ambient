import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { isMediaKind, sanitizeCabinet, type MediaItem } from '../src/records.ts';
import { dropWallpapers, isInside, looseMedia, mediaSrc, mergeMedia, replaceMediaDir, replaceWallpapers, toMediaItem, toWallpaperItem, type WallpaperFile } from '../src/media.ts';

const file = (path: string) => ({ path, name: path.split(/[\\/]/).pop() ?? path, kind: 'image' as const, size: 1024, src: '' });

test('媒体条目的 id 就是绝对路径，同一个文件扫两次不会变成两条', () => {
  const item = toMediaItem(file('F:\\图片\\海边.png'));
  assert.equal(item.id, 'F:\\图片\\海边.png');
  assert.equal(item.kind, 'image');
  const merged = mergeMedia([item], [toMediaItem(file('F:\\图片\\海边.png'))]);
  assert.equal(merged.length, 1);
});

test('合并时新扫到的覆盖旧的，旧条目保持原有顺序', () => {
  const a = toMediaItem({ ...file('F:\\a.png'), size: 10 });
  const b = toMediaItem(file('F:\\b.png'));
  const a2 = toMediaItem({ ...file('F:\\a.png'), size: 99 });
  const merged = mergeMedia([a, b], [a2]);
  assert.deepEqual(merged.map(item => item.id), ['F:\\a.png', 'F:\\b.png']);
  assert.equal(merged[0].size, 99);
});

test('媒体地址把路径整个编码，中文和空格都不会把 URL 拆坏', () => {
  const item = toMediaItem(file('F:\\我的 素材\\a & b #c.png'));
  const src = mediaSrc(item);
  assert.ok(src.startsWith('media://local/'));
  assert.equal(decodeURIComponent(src.slice('media://local/'.length)), 'F:\\我的 素材\\a & b #c.png');
  // 路径里不能有裸的 & 和 #，否则会被当成查询串和锚点
  assert.ok(!src.includes('&'));
  assert.ok(!src.includes('#'));
});

test('重扫时用新结果替换整个目录，删掉的文件要跟着消失', () => {
  const items: MediaItem[] = [
    toMediaItem(file('F:\\素材\\a.png')),
    toMediaItem(file('F:\\素材\\gone.png')),
    toMediaItem(file('F:\\别处\\keep.png')),
  ];
  const next = replaceMediaDir(items, 'F:\\素材', [toMediaItem(file('F:\\素材\\a.png')), toMediaItem(file('F:\\素材\\new.png'))]);
  assert.deepEqual(next.map(item => item.id).sort(), ['F:\\别处\\keep.png', 'F:\\素材\\a.png', 'F:\\素材\\new.png']);
});

test('判断路径归属时，前后缀相似的目录不能误伤', () => {
  assert.equal(isInside('F:\\素材\\a.png', 'F:\\素材'), true);
  assert.equal(isInside('F:\\素材\\子目录\\a.png', 'F:\\素材'), true);
  assert.equal(isInside('F:\\素材二\\a.png', 'F:\\素材'), false);
  assert.equal(isInside('F:\\素材\\a.png', 'F:\\素材\\'), true);
  assert.equal(isInside('f:\\素材\\a.png', 'F:\\素材'), true);
});

test('旧版本存下来的收藏里没有 media 字段，读出来是空数组而不是报错', () => {
  const legacy = { version: 2, records: [], queue: [], ambience: [], master: 60, musicVolume: 70, ducking: true, order: 'sequence', transition: 'crossfade', lineMode: false, lineVolume: 100, muted: [], theme: '#9a8b78', imageName: '' };
  const cabinet = sanitizeCabinet(legacy);
  assert.deepEqual(cabinet.media, []);
  assert.deepEqual(cabinet.mediaDirs, []);
});

test('坏掉的媒体条目在读收藏时被丢掉，好的留下', () => {
  const cabinet = sanitizeCabinet({
    version: 2, records: [], queue: [], ambience: [],
    media: [
      { id: 'F:\\ok.png', kind: 'image', path: 'F:\\ok.png', name: 'ok.png', size: 10 },
      { id: 'F:\\bad.png', kind: 'audio', path: 'F:\\bad.png', name: 'bad.png', size: 10 },
      { id: '', kind: 'image', path: '', name: '', size: 0 },
      null,
    ],
    mediaDirs: ['F:\\素材', '', 42, 'F:\\另一处'],
  });
  assert.deepEqual(cabinet.media.map(item => item.id), ['F:\\ok.png']);
  assert.deepEqual(cabinet.mediaDirs, ['F:\\素材', 'F:\\另一处']);
});

test('媒体类型只认图片和视频', () => {
  assert.equal(isMediaKind('image'), true);
  assert.equal(isMediaKind('video'), true);
  assert.equal(isMediaKind('audio'), false);
  assert.equal(isMediaKind(undefined), false);
});

const wallpaper = (key: string, over: Partial<WallpaperFile> = {}): WallpaperFile => ({
  key, path: `${key}\\clip.mp4`, name: 'Ocean', kind: 'video', size: 2048, src: '', note: '', ...over,
});

test('壁纸条目用作品目录做 id，作者改标题或换文件名都不会变成两条', () => {
  const item = toWallpaperItem(wallpaper('C:\\Steam\\431960\\2361096884'));
  assert.equal(item.id, 'C:\\Steam\\431960\\2361096884');
  assert.equal(item.source, item.id);
  assert.equal(item.name, 'Ocean');
  const renamed = toWallpaperItem(wallpaper('C:\\Steam\\431960\\2361096884', { name: 'Ocean 大海', path: 'C:\\Steam\\431960\\2361096884\\new.mp4' }));
  const merged = replaceWallpapers([item], [renamed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Ocean 大海');
});

test('重新读壁纸库时整体替换，但不动用户自己加的文件夹', () => {
  const mine = toMediaItem(file('F:\\我的素材\\a.png'));
  const old = toWallpaperItem(wallpaper('C:\\Steam\\431960\\1'));
  const gone = toWallpaperItem(wallpaper('C:\\Steam\\431960\\2'));
  const next = replaceWallpapers([mine, old, gone], [toWallpaperItem(wallpaper('C:\\Steam\\431960\\1'))]);
  assert.deepEqual(next.map(item => item.id), ['F:\\我的素材\\a.png', 'C:\\Steam\\431960\\1']);
});

test('旧版本存下的场景壁纸预览图，读收藏时会被丢掉', () => {
  // 放映现在只放图片和视频。之前把场景壁纸的 preview.gif 当成一件存了进来，
  // 还带一句 note 说明「这里只显示预览」。这类条目留着只会让人以为能放，
  // 所以在 sanitizeCabinet 这一步就丢掉，不用等界面再过滤一遍。
  const stale = {
    id: 'C:\\Steam\\431960\\9', kind: 'image', path: 'C:\\Steam\\431960\\9\\preview.gif',
    name: 'Winter camp', size: 1016, source: 'C:\\Steam\\431960\\9',
    note: '场景壁纸需要在 Wallpaper Engine 里运行，这里只显示预览',
  };
  const ok = { id: 'C:\\Steam\\431960\\8', kind: 'video', path: 'C:\\Steam\\431960\\8\\a.mp4', name: 'Ocean', size: 2048, source: 'C:\\Steam\\431960\\8' };
  const cabinet = sanitizeCabinet({ version: 2, records: [], queue: [], ambience: [], media: [stale, ok], mediaDirs: [] });
  assert.deepEqual(cabinet.media.map(item => item.name), ['Ocean']);
});

test('壁纸条目靠 source 认出自己，重启后来源标签不会因为「这次没扫过」而消失', () => {
  const mine = toMediaItem(file('F:\\我的素材\\a.png'));
  const wall = toWallpaperItem(wallpaper('C:\\Steam\\431960\\1'));
  assert.equal(mine.source, undefined);
  assert.ok(wall.source);
  // 从收藏读回来之后 source 还在，界面据此数出壁纸件数
  const cabinet = sanitizeCabinet({ version: 2, records: [], queue: [], ambience: [], media: [mine, wall], mediaDirs: [] });
  assert.equal(cabinet.media.filter(item => !!item.source).length, 1);
});

test('恢复目录时不因为列表为空就跳过——壁纸条目从来不在 mediaDirs 里', () => {
  // 主进程收到空的 dirs 也会去补登记壁纸库根目录，所以页面必须发这一条。
  // 曾经写成「dirs 为空就直接 return」，结果重启后壁纸全是 403。
  const source = fs.readFileSync(new URL('../src/media.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function restoreMediaDirs'));
  const head = body.slice(0, body.indexOf('}'));
  assert.ok(!/if \(\s*!?\s*dirs\.length\s*\)\s*return/.test(head), 'restoreMediaDirs 不该在 dirs 为空时提前返回');
});


test('移出壁纸库只清壁纸条目，自己的文件夹和单独导入的文件都留着', () => {
  const mine = { ...toMediaItem(file('F:\\素材\\海边.png')), source: undefined };
  const loose = { ...toMediaItem(file('F:\\桌面\\单张.png')), source: undefined };
  const wall = toWallpaperItem({
    path: 'C:\\Steam\\431960\\1\\a.mp4', name: 'Ocean', kind: 'video', size: 10,
    src: '', key: 'C:\\Steam\\431960\\1', note: '',
  } as WallpaperFile);
  const left = dropWallpapers([mine, loose, wall]);
  assert.deepEqual(left.map(item => item.name), ['海边.png', '单张.png']);
  // 一件壁纸都没有时再点一次不该出问题
  assert.equal(dropWallpapers(left).length, 2);
});

test('单独导入的文件不在任何目录里，重启时要单独补进白名单', () => {
  const dirs = ['F:\\素材'];
  const inside = toMediaItem(file('F:\\素材\\海边.png'));
  const loose = toMediaItem(file('F:\\桌面\\单张.png'));
  assert.deepEqual(looseMedia([inside, loose], dirs), ['F:\\桌面\\单张.png']);
  // 前后缀相似的目录不算「在里面」，否则素材二里的文件会被漏掉
  const near = toMediaItem(file('F:\\素材二\\别的.png'));
  assert.deepEqual(looseMedia([near], dirs), ['F:\\素材二\\别的.png']);
});

test('重扫后新条目覆盖旧条目，修改时间跟着换新', () => {
  const old = toMediaItem({ ...file('F:\\素材\\海边.png'), mtime: 1000 });
  const fresh = toMediaItem({ ...file('F:\\素材\\海边.png'), mtime: 2000 });
  const merged = mergeMedia([old], [fresh]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].mtime, 2000, '重扫拿到的新时间要盖掉存档里的旧值');
});

test('扫描带的修改时间会一路留到票面：扫描 → 条目 → 存档 → 读回', () => {
  const at = new Date(2023, 7, 21, 14, 5).getTime();
  const item = toMediaItem({ ...file('F:\\素材\\海边.png'), mtime: at });
  assert.equal(item.mtime, at, 'toMediaItem 要把 mtime 带上');

  // 存档里没有 mtime 的老条目读回来仍是 undefined——不能补 0，
  // 0 会被票面印成 1970。
  const saved = sanitizeCabinet({ media: [item, toMediaItem(file('F:\\素材\\旧.png'))] });
  assert.equal(saved.media[0].mtime, at);
  assert.equal(saved.media[1].mtime, undefined);
});

/**
 * 主进程的两个分支必须回包。
 *
 * 以前 `pick-files` 挑完发现一个可用文件都没有、`rescan` 发现目录不在台账里，
 * 都是直接 `return` —— 页面永远等不到消息，用户看到的是「点了没反应」，
 * 然后反复重试。这类坏掉最难查，因为没有任何报错。
 *
 * 这里用读源码的方式钉住行为（主进程模块在纯 node 下要 electron，跑不起来）。
 */
test('主进程不会静默吞掉「拒收」，两种情形都要回 rejected', () => {
  const source = fs.readFileSync(new URL('../electron/media.cjs', import.meta.url), 'utf8');

  const pickFiles = source.slice(source.indexOf("if (type === 'pick-files')"), source.indexOf("if (type === 'rescan')"));
  assert.ok(pickFiles.length > 0, '找不到 pick-files 分支');
  assert.ok(/reason: 'empty'/.test(pickFiles), 'pick-files 一个文件都没剩下时必须回 rejected(empty)');
  assert.ok(!/if \(!files\.length\) return;/.test(pickFiles), 'pick-files 不能静默 return');

  const rescan = source.slice(source.indexOf("if (type === 'rescan')"), source.indexOf("if (type === 'forget')"));
  assert.ok(rescan.length > 0, '找不到 rescan 分支');
  assert.ok(/reason: 'missing'/.test(rescan), 'rescan 目录不在台账里时必须回 rejected(missing)');
  assert.ok(!/wallpaperAllowed\.has\(dir\)\)\) return;/.test(rescan), 'rescan 不能静默 return');
});

test('页面侧把三种拒收原因都说成人话', () => {
  const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // 三个分支各自有不同的下一步动作，不能合并成一句「这个位置不能用」
  assert.ok(/reason === 'system'/.test(source));
  assert.ok(/reason === 'empty'/.test(source));
  assert.ok(/重新添加一次就好/.test(source), 'missing 要告诉用户怎么办');
});
