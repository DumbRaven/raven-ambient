#!/usr/bin/env node
/**
 * 计算样式快照比对：逐行 diff 两份 styles.cjs 的产物。
 *
 * 为什么能当硬门禁用：重构样式表时，只要最终算出来的值一个都没变，
 * 用户看到的就是同一个界面——不管中间怎么改选择器、怎么重排规则。
 * 反过来，任何一处值变了都会被抓出来，并且直接指出元素和属性名，
 * 比像素比对「差 1 个色阶」有用得多。
 *
 * 用法：
 *   node tools/probe/style-diff.mjs .qa/style-before .qa/style-after
 *
 * 输出：
 *   完全一致 → 打印统计，退出码 0
 *   有差异   → 按「新增 / 删除 / 改动」分组列出，最多 40 条，退出码 1
 *
 * 期望的合法差异（重构时会出现，需要人工确认后忽略）：
 *   元素签名里带了排序后的类名，如果重构改动的是**类名本身**，
 *   那一整块元素都会显示为「删除 + 新增」。这是类名变了的正常表现，
 *   不是视觉回归——视觉回归的定义是「同一个元素同一个属性值变了」。
 */
import fs from 'node:fs';
import path from 'node:path';

const [refDir, curDir] = process.argv.slice(2);
if (!refDir || !curDir) {
  console.error('用法：node tools/probe/style-diff.mjs <基准目录> <当前目录>');
  process.exit(2);
}

/** 读一份快照成 Map：key = "元素 | 伪元素 | 属性"，value = 值。 */
function readSnapshot(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const sep = line.indexOf(': ');
    if (sep < 0) continue;
    // key 里可能含 ': '（比如 label=xx: yy），所以取**最后一个**分隔更稳？
    // 不行——值本身也可能含 ': '（`content: "a: b"`）。属性名一定不含空格，
    // 所以在第一个 ': ' 处切最稳：key 侧到那里为止。
    map.set(line.slice(0, sep), line.slice(sep + 2));
  }
  return map;
}

function loadManifest(dir) {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const refManifest = loadManifest(refDir);
const curManifest = loadManifest(curDir);
if (refManifest && curManifest && refManifest.dpr !== curManifest.dpr) {
  console.error(`✗ DPR 不一致：基准 ${refManifest.dpr} → 当前 ${curManifest.dpr}`);
  console.error('  标尺本身出了问题，先查 PROBE_DPR，比对没有意义。');
  process.exit(1);
}

const names = new Set();
for (const dir of [refDir, curDir]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.txt')) names.add(f.slice(0, -4));
  }
}
if (!names.size) {
  console.error(`✗ 两个目录里都没有 .txt 快照：${refDir} / ${curDir}`);
  process.exit(1);
}

let failed = 0;
let totalProps = 0;
const MAX_PRINT = 40;
let printed = 0;

for (const name of [...names].sort()) {
  const ref = readSnapshot(path.join(refDir, `${name}.txt`));
  const cur = readSnapshot(path.join(curDir, `${name}.txt`));
  if (!ref) {
    console.log(`  ${name}  仅当前有（基准里没有，不判为回归）`);
    continue;
  }
  if (!cur) {
    console.log(`  ${name}  ✗ 当前缺失`);
    failed++;
    continue;
  }

  const removed = [];
  const added = [];
  const changed = [];

  for (const [key, value] of ref) {
    if (!cur.has(key)) { removed.push([key, value]); continue; }
    const now = cur.get(key);
    if (now !== value) changed.push([key, value, now]);
  }
  for (const [key, value] of cur) {
    if (!ref.has(key)) added.push([key, value]);
  }

  totalProps += ref.size;
  const diff = removed.length + added.length + changed.length;

  // 判定口径：只认「同一个元素同一个属性值变了」和「有属性消失」。
  // 「新增属性」单独算——新增一条**在别处已经被别的规则覆盖**的声明，
  // 算出来还是同一个值，不会出现在这里；能出现在这里的都是真的多了一眼。
  // 但为了让门禁够硬，新增也判失败，肉眼确认后可以放宽。
  if (diff === 0) {
    console.log(`  ${name}  ✓ 一致  ${ref.size} 个属性`);
    continue;
  }

  failed++;
  console.log(`  ${name}  ✗ 有差异  改动 ${changed.length} / 缺失 ${removed.length} / 多出 ${added.length}`);

  const show = (label, rows) => {
    for (const row of rows) {
      if (printed >= MAX_PRINT) return;
      printed++;
      if (label === '改动') console.log(`      ~ ${row[0]}\n          ${row[1]}  →  ${row[2]}`);
      else if (label === '缺失') console.log(`      - ${row[0]}: ${row[1]}`);
      else console.log(`      + ${row[0]}: ${row[1]}`);
    }
  };
  show('改动', changed);
  show('缺失', removed);
  show('多出', added);
  if (printed >= MAX_PRINT) {
    console.log(`      …… 还有更多，已截断（MAX_PRINT=${MAX_PRINT}）`);
  }
}

if (printed >= MAX_PRINT) {
  console.log(`\n[style-diff] 差异条目超过 ${MAX_PRINT}，输出已截断。`);
}
if (failed) {
  console.log(`\n[style-diff] ✗ ${failed} 份快照有差异（共比 ${totalProps} 个属性）`);
  process.exit(1);
}
console.log(`\n[style-diff] ✓ 全部 ${names.size} 份快照一致（共比 ${totalProps} 个属性）`);
