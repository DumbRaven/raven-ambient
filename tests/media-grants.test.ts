/**
 * `electron/media-grants.cjs` 的行为测试。
 *
 * 这几条钉的是一类**安全边界**：写错了不会有任何报错，只会在某天变成
 * 「`media://` 能读整块盘」。所以每个绕过手法都要有一条对应的断言，
 * 而且要用真实的目录 / 链接来跑，不靠推理。
 *
 * 背景：白名单原本只是一个内存 Set，重启就空，靠页面启动时用 `restore`
 * 把收藏里的路径递回来。问题不是页面参与恢复，而是主进程分不清
 * 「用户授权过的」和「页面现在编的」——`statSync` 只证明路径存在。
 * 现在授权由用户点对话框产生、主进程写台账，页面不再能自己发授权。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { MediaGrants, looksLikeFolder, isWithin } =
  require('../electron/media-grants.cjs') as {
    MediaGrants: new (file: string) => {
      dirs: Set<string>; files: Set<string>; existed: boolean; dirty: boolean;
      load: () => unknown; save: () => boolean;
      addDir: (dir: string) => boolean; addFile: (file: string) => boolean;
      removeDir: (dir: string) => boolean;
      migrate: (dirs: unknown, files: unknown) => number;
    };
    looksLikeFolder: (dir: string) => boolean;
    isWithin: (target: string, dirs: string[]) => boolean;
  };

/** 建一个临时目录树，用完由调用方删。 */
function tempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-grants-'));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('盘根与系统目录不能作为授权目标', () => {
  // 用户想整理素材不会选区区的整个磁盘，误选到盘根会把整盘变成可读范围
  assert.equal(looksLikeFolder('C:\\'), false);
  assert.equal(looksLikeFolder('C:\\Windows'), false);
  assert.equal(looksLikeFolder('C:\\Windows\\Fonts'), false, '子目录同样拒');
  assert.equal(looksLikeFolder('C:\\Program Files\\Steam'), false);
  assert.equal(looksLikeFolder('c:\\windows'), false, '大小写不敏感');
  // 普通素材目录要放行，否则功能就不能用了
  assert.equal(looksLikeFolder('D:\\素材\\壁纸'), true);
});

test('目录内的文件放行，目录外的不放行', () => {
  const { root, cleanup } = tempTree();
  try {
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub);
    const file = path.join(sub, 'a.png');
    fs.writeFileSync(file, 'x');

    assert.equal(isWithin(file, [root]), true);
    assert.equal(isWithin(sub, [root]), true, '子目录本身也在范围内');
    assert.equal(isWithin(root, [root]), false, '目录本身不算（rel 为空）');
    assert.equal(isWithin(path.resolve(root, '..', 'outside.png'), [root]), false);
    assert.equal(isWithin(path.join(root, 'nope.png'), [root]), false, '不存在的文件一律判否');
  } finally {
    cleanup();
  }
});

test('符号链接绕不过白名单', () => {
  // 这是第 2 条的回归测试。原先 insideAllowed 直接用 path.resolve，
  // 链接在它看来只是个普通名字：链接指向外面，path.relative 却算出「还在里面」。
  const { root, cleanup } = tempTree();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-outside-'));
  try {
    const secret = path.join(outside, 'secret.png');
    fs.writeFileSync(secret, 'top secret');
    const link = path.join(root, 'link.png');

    let linked = false;
    try {
      // Windows 上文件符号链接要开发者模式或管理员；junction 只能指目录。
      // 建不出来就跳过这条——不能因为环境不支持就假装验过了。
      fs.symlinkSync(secret, link, 'file');
      linked = true;
    } catch { /* 没权限，见下面 skip */ }

    if (!linked) {
      assert.ok(true, '当前环境不支持创建符号链接，跳过');
      return;
    }

    assert.equal(isWithin(link, [root]), false, '链接指到外面，就不该被当成白名单里的文件');
    assert.equal(isWithin(secret, [root]), false, '真实文件本身也不在白名单目录下');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    cleanup();
  }
});

test('台账能读回，坏的台账不炸', () => {
  const { root, cleanup } = tempTree();
  try {
    const file = path.join(root, 'media-grants.json');
    const g = new MediaGrants(file).load() as any;
    assert.equal(g.existed, false, '文件还没有');

    g.addDir('D:\\素材');
    g.addFile('D:\\素材\\a.png');
    assert.equal(g.save(), true);
    assert.equal(fs.existsSync(file), true);

    const back = new MediaGrants(file).load() as any;
    assert.equal(back.existed, true);
    assert.deepEqual([...back.dirs], ['D:\\素材']);
    assert.deepEqual([...back.files], ['D:\\素材\\a.png']);

    // 手改坏了也不能让应用起不来
    fs.writeFileSync(file, '{ 这不是 json');
    const broken = new MediaGrants(file).load() as any;
    assert.equal(broken.dirs.size, 0);
    assert.equal(broken.files.size, 0);
  } finally {
    cleanup();
  }
});

test('升级迁移只开一次', () => {
  // 老用户从没有台账的版本升上来：收藏里有目录，台账里一条都没有。
  // 不迁就会整个媒体库 403；迁了就必须立刻关窗，否则它又变成任意授权。
  const { root, cleanup } = tempTree();
  try {
    const file = path.join(root, 'media-grants.json');

    const first = new MediaGrants(file).load() as any;
    assert.equal(first.migrate(['D:\\素材'], ['D:\\素材\\a.png']), 2, '首次迁移补登记');
    first.save();

    const second = new MediaGrants(file).load() as any;
    assert.equal(second.migrate(['E:\\别的盘'], []), 0, '台账已存在就不许再迁移');
    assert.deepEqual([...second.dirs], ['D:\\素材'], '迁移来的那条还在，新的那条没进来');
  } finally {
    cleanup();
  }
});

test('移出目录会真的撤销授权', () => {
  // 只从页面收藏里删、台账里留着的话，那个目录仍然能被 media:// 读到
  const { root, cleanup } = tempTree();
  try {
    const file = path.join(root, 'media-grants.json');
    const g = new MediaGrants(file).load() as any;
    g.addDir('D:\\素材');
    g.save();

    assert.equal(g.removeDir('D:\\素材'), true);
    assert.equal(g.dirs.size, 0);
    assert.equal(g.removeDir('D:\\素材'), false, '已经没了');
    g.save();

    const back = new MediaGrants(file).load() as any;
    assert.equal(back.dirs.size, 0, '撤销要落盘');
  } finally {
    cleanup();
  }
});

test('末尾带点号或空格的系统目录也进不来', () => {
  // Windows 的路径末尾点号与空格会被文件系统忽略，`C:\Windows.` 打开的就是
  // `C:\Windows`。台账里若存下带点号的那一份，黑名单就比不上了。
  assert.equal(looksLikeFolder('C:\\Windows.'), false);
  assert.equal(looksLikeFolder('C:\\Windows '), false);
  assert.equal(looksLikeFolder('C:\\Windows. . '), false);
  assert.equal(looksLikeFolder('C:\\Program Files.'), false);
});

test('真的叫「..b」的子目录不算越界', () => {
  // 判越界只认 `..` 本身或者 `..\<名字>`，不能整片 `startsWith('..')`——
  // 那样一个合法叫 `..b` 的目录里所有文件都读不了。
  const { root, cleanup } = tempTree();
  try {
    const odd = path.join(root, '..b');
    fs.mkdirSync(odd, { recursive: true });
    const file = path.join(odd, 'cover.png');
    fs.writeFileSync(file, 'x');
    assert.equal(isWithin(file, [root]), true, '「..b」是个正常目录名');
  } finally {
    cleanup();
  }
});

test('目录里的目录链接指到外面，就走不出去', () => {
  // 早先 isWithin 会拿「解析后的真实路径」与「原路径」各试一次，命中任一就放行。
  // 链接本身就在用户选的目录里，于是原路径那条永远成立 —— 链接穿越成功。
  // 现在只认真实路径。
  const { root, cleanup } = tempTree();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-outside-'));
  try {
    const secret = path.join(outside, 'secret.png');
    fs.writeFileSync(secret, 'top secret');
    const link = path.join(root, 'escape');
    let linked = false;
    try {
      fs.symlinkSync(outside, link, 'junction');
      linked = true;
    } catch { /* 没权限，见下面 */ }

    if (!linked) {
      assert.ok(true, '当前环境建不出目录链接，跳过');
      return;
    }

    assert.equal(isWithin(path.join(link, 'secret.png'), [root]), false, '穿过链接就到了外面');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    cleanup();
  }
});

test('8.3 短名也绕过不了系统目录黑名单', () => {
  // `C:\PROGRA~1` 就是 `C:\Program Files`。普通 realpathSync 原样返回短名，
  // 黑名单里那串长名永远比不上；realpathSync.native 会展开它。
  assert.equal(looksLikeFolder('C:\\PROGRA~1'), false);
  assert.equal(looksLikeFolder('C:\\PROGRA~1\\Common Files'), false);
});
