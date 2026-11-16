#!/usr/bin/env node
/**
 * 把 style-diff 的机器结果按「属性名」聚合，回答一个具体问题：
 * 这次改动有没有碰到 X 之外的任何东西？
 *
 * 为什么需要它：`tools/probe/style-diff.mjs` 的终端输出截断在 40 条
 * （MAX_PRINT=40）。当总结行只说「12 份快照有差异」时，光看终端无法判断
 * 差异是全部落在同一个属性上，还是混进了别的东西。这个脚本读两份快照做
 * 全量聚合，**不截断**，把「改动/缺失/多出」按属性名分组计数。
 *
 * 用法：
 *   node tools/probe/style-diff-tally.mjs .qa/style-before .qa/style-after
 *
 * 输出（示例）：
 *   改动 780 项，按属性分组：
 *     font-style                    780
 *   缺失 12 项，按属性分组：
 *     aria-label                     12
 *
 * 判据：如果某个属性的计数等于总差异数，说明这次改动是「单一属性收敛」的，
 * 可以安全地只审这一项；否则要逐条看。
 */
import fs from 'node:fs';
import path from 'node:path';

const [refDir, curDir] = process.argv.slice(2);
if (!refDir || !curDir) {
  console.error('用法：node tools/probe/style-diff-tally.mjs <基准目录> <当前目录>');
  process.exit(2);
}

/** 读一份快照成 Map：key = "元素 | 伪元素 | 属性"，value = 值。 */
function readSnapshot(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const sep = line.indexOf(': ');
    if (sep < 0) continue;
    map.set(line.slice(0, sep), line.slice(sep + 2));
  }
  return map;
}

// 快照名 = 目录下的 .txt 文件名（与 style-diff.mjs 的约定一致）
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

/** 从 "元素 | 伪元素 | 属性" 里取属性名。属性名一定不含 ' | '。 */
const propOf = (key) => {
  const at = key.lastIndexOf(' | ');
  return at < 0 ? key : key.slice(at + 3);
};

const changed = new Map();
const removed = new Map();
const added = new Map();
const bump = (map, name) => map.set(name, (map.get(name) || 0) + 1);

let views = 0;
let viewsWithDiff = 0;

for (const name of [...names].sort()) {
  const ref = readSnapshot(path.join(refDir, `${name}.txt`));
  const cur = readSnapshot(path.join(curDir, `${name}.txt`));
  if (!ref || !cur) {
    console.error(`✗ ${name} 在一侧缺失`);
    continue;
  }
  views += 1;
  let touched = 0;

  for (const [key, value] of cur) {
    if (!ref.has(key)) { bump(added, propOf(key)); touched += 1; }
    else if (ref.get(key) !== value) { bump(changed, propOf(key)); touched += 1; }
  }
  for (const key of ref.keys()) {
    if (!cur.has(key)) { bump(removed, propOf(key)); touched += 1; }
  }
  if (touched) viewsWithDiff += 1;
}

const sum = (map) => [...map.values()].reduce((a, b) => a + b, 0);
const dump = (label, map) => {
  const total = sum(map);
  if (!total) return;
  console.log(`${label} ${total} 项：`);
  for (const [prop, n] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${prop.padEnd(30)} ${n}`);
  }
};

console.log(`比了 ${views} 份快照，其中 ${viewsWithDiff} 份有差异`);
dump('改动', changed);
dump('缺失', removed);
dump('多出', added);

if (!sum(changed) && !sum(removed) && !sum(added)) {
  console.log('✓ 完全一致');
  process.exit(0);
}
