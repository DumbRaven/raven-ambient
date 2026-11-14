// 主进程的扫描函数单测。
//
// scan 只碰 node:fs（不碰 electron API），所以在纯 node 里能直接跑。
// 这里验证的核心是：扫出来的每一项都带 mtime——票面上的 DATE / TIME 印的就是它。
// 之前 size 是单独一次 statSync 拿的，加了 mtime 之后合并成一次；别让后人又拆回去。
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { scan } = require('../electron/media.cjs') as {
  scan: (root: string, depth?: number, out?: ScanItem[]) => ScanItem[];
};

type ScanItem = { path: string; name: string; kind: string; size: number; mtime: number };

/** 建一个临时目录，塞几个文件并把修改时间设成已知值。 */
function fixture(): { dir: string; at: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raven-scan-'));
  const at = new Date(2023, 7, 21, 14, 5).getTime();
  for (const name of ['海边.png', '雪景.jpg', '片段.mp4']) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, 'x'.repeat(32));
    fs.utimesSync(file, at / 1000, at / 1000);
  }
  // 不该被收进来的：扩展名不认识、隐藏文件
  fs.writeFileSync(path.join(dir, '说明.txt'), 'x');
  fs.writeFileSync(path.join(dir, '.secret.png'), 'x');
  return { dir, at };
}

test('扫描把大小和修改时间一起带出来（票面日期靠它）', () => {
  const { dir, at } = fixture();
  try {
    const found = scan(dir);
    assert.deepEqual(found.map(item => item.name).sort(), ['海边.png', '雪景.jpg', '片段.mp4'].sort());
    for (const item of found) {
      assert.equal(item.size, 32);
      // utimes 只有秒级精度，允许 1 秒误差。
      assert.ok(Math.abs(item.mtime - at) < 1000, `${item.name} 的 mtime 没带上：${item.mtime}`);
      assert.equal(item.kind, item.name.endsWith('.mp4') ? 'video' : 'image');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('扫描按名字排序，重扫的排列不会跳', () => {
  const { dir } = fixture();
  try {
    const names = scan(dir).map(item => item.name);
    // localeCompare zh-CN + numeric：文件名里带数字时也稳定
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
