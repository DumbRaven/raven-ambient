/**
 * 删掉「逐字完全相同」的重复规则——只保留最后一份。
 *
 * 为什么这个操作可以做到零风险：
 *   两份规则的选择器、媒体查询上下文、声明体**完全逐字相同**，
 *   那么无论哪一份生效，计算结果都一样。删掉前一份不改变任何一层
 *   层叠的结果，因为后一份本来就在同样的位置给出同样的值。
 *
 * 这件事之所以值得做，不是因为省那 66 行，而是因为这 20 组重复
 * 全都在 `.template-collage` 那一段——那段是照着 AE 稿一处处对锚点
 * 改出来的，改一次就在文件末尾追加一份。重复本身不是问题，
 * **问题是没有标记，读的人分不清「这份是历史」还是「这份还生效」**。
 *
 * 注意：这个脚本只处理「完全相同」。语义等价但不完全相同（比如
 * 属性顺序不同、或者值写法不同但结果一样）不在范围内——那种需要
 * 人判断，机器猜会出错。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const target = path.join(root, 'src', 'skin-bold.css');
const raw = fs.readFileSync(target, 'utf8');

// 保留换行，让行号可算。注释内容清空但长度不变，这样偏移量与原文件一致，
// 最后可以从原文件按偏移切片删除——而不是把 CSS 重新序列化一遍。
const masked = raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

/** 把 CSS 解析成规则列表，带原始偏移量（用于精确删除）。 */
function parse(text) {
  const rules = [];
  const stack = [];
  let pos = 0;
  let start = 0;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === '{') {
      const sel = text.slice(start, pos).trim();
      if (sel.startsWith('@')) {
        stack.push({ kind: 'at', sel });
      } else {
        stack.push({
          kind: 'rule',
          sel,
          offsetStart: start,
          bodyStart: pos + 1,
          media: stack.filter(s => s.kind === 'at').map(s => s.sel).join(' && '),
        });
      }
      start = pos + 1;
    } else if (ch === '}') {
      const r = stack.pop();
      if (r && r.kind === 'rule') {
        r.offsetEnd = pos + 1;
        r.body = text.slice(r.bodyStart, pos);
        rules.push(r);
      }
      start = pos + 1;
    }
    pos++;
  }
  return rules;
}

const rules = parse(masked);
const keyOf = r => `${r.sel.replace(/\s+/g, ' ')}@@${r.media}@@${r.body.replace(/\s+/g, ' ').trim()}`;

const groups = new Map();
for (const r of rules) {
  const k = keyOf(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

// 收集要删的区间：每组只保留最后一份
const drops = [];
for (const [, list] of groups) {
  if (list.length < 2) continue;
  for (let i = 0; i < list.length - 1; i++) {
    drops.push(list[i]);
  }
}

if (!drops.length) {
  console.log('[dedupe] 没有逐字重复的规则');
  process.exit(0);
}

// 从后往前删，避免偏移量漂移
drops.sort((a, b) => b.offsetStart - a.offsetStart);

// 删除时要连同行尾换行一起去掉，否则会留下成片空行。
// 也不能连前面的空白一起删——前一条规则的 `}` 之后可能是别的内容。
let out = raw;
for (const r of drops) {
  let from = r.offsetStart;
  let to = r.offsetEnd;
  // 往后吃掉紧邻的空白与换行（只吃一层空行，别多吃）
  while (to < out.length && (out[to] === ' ' || out[to] === '\t')) to++;
  if (out[to] === '\r') to++;
  if (out[to] === '\n') to++;
  // 往前吃掉行首缩进
  let back = from;
  while (back > 0 && (out[back - 1] === ' ' || out[back - 1] === '\t')) back--;
  if (back > 0 && out[back - 1] === '\n') {
    if (back > 1 && out[back - 2] === '\r') back--;
    if (back > 1 && out[back - 2] === '\n') back--; // 顺带吃掉上一空白行
  }
  from = back;
  out = out.slice(0, from) + out.slice(to);
}

fs.writeFileSync(target, out);
const before = raw.split('\n').length;
const after = out.split('\n').length;
console.log(`[dedupe] 删掉 ${drops.length} 条逐字重复规则，${before} 行 → ${after} 行`);
console.log('[dedupe] 验收标准是零差异：');
console.log('  node tools/probe/style-diff.mjs .qa/style-before .qa/style-after   # 必须 12/12 一致');
console.log('  python tools/probe/baseline-diff.py --ref .qa/baseline --cur .qa/pix   # 必须 22/22 一致');
