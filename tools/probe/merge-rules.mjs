/**
 * 把「同一选择器被定义多次」合并成一条规则，取每个属性最后一次的值。
 *
 * 为什么做：拼贴版式那几个选择器被定义了 4~7 次（.tpl-words 7 次、
 * .tpl-title-text 6 次、.tpl-sub 6 次），横跨两个文件。结果是
 * 「改这个标题的位置」要同时读 7 段代码才知道现在实际是多少——
 * 而这个值就是 __x 最后的那个 50.16%，中间那 6 个全是历史。
 *
 * 合并为什么等价：把 N 条同选择器、同媒体查询上下文的规则，
 * 换成 1 条包含「每个属性最后生效值」的规则，只有当**没有任何别的东西
 * 夹在中间把它们拆开**时才等价。这个前提由 merge-analysis.mjs 逐个属性
 * 检查过：48 个选择器满足，13 个不满足（被别的规则夹住）——后者一律不动。
 *
 * 改完仍然要过 style-diff：12 份计算样式快照逐属性一致才算数。
 *
 * 用法：node tools/probe/merge-rules.mjs          # dry-run，打印合并结果
 *       node tools/probe/merge-rules.mjs --write  # 真写
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skinDir = path.join(root, 'src', 'skin');
const entryPath = path.join(root, 'src', 'skin-bold.css');
const entry = fs.readFileSync(entryPath, 'utf8');
const order = [...entry.matchAll(/@import '\.\/skin\/([^']+)'/g)].map(m => m[1]);
const write = process.argv.includes('--write');

/** 解析一份 CSS，返回带原始偏移量的规则列表。 */
function parseFile(file, text, basePos) {
  const masked = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const rules = [];
  const stack = [];
  let pos = 0;
  let start = 0;
  while (pos < masked.length) {
    const ch = masked[pos];
    if (ch === '{') {
      const sel = masked.slice(start, pos).trim().replace(/\s+/g, ' ');
      const line = masked.slice(0, pos).split('\n').length;
      if (sel.startsWith('@')) {
        stack.push({ kind: 'at', sel });
      } else {
        stack.push({
          kind: 'rule', sel, file, line,
          media: stack.filter(s => s.kind === 'at').map(s => s.sel).join(' && '),
          offsetStart: start,
          bodyStart: pos + 1,
        });
      }
      start = pos + 1;
    } else if (ch === '}') {
      const r = stack.pop();
      if (r && r.kind === 'rule') {
        r.offsetEnd = pos + 1;
        r.body = masked.slice(r.bodyStart, pos);
        r.pos = basePos + rules.length;
        rules.push(r);
      }
      start = pos + 1;
    }
    pos++;
  }
  return rules;
}

function decls(body) {
  const out = [];
  for (const part of body.split(';')) {
    const m = part.match(/^\s*(--[\w-]+|[-a-zA-Z]+)\s*:\s*([\s\S]+)$/);
    if (m) out.push({ prop: m[1].toLowerCase(), val: m[2].trim().replace(/\s+/g, ' ') });
  }
  return out;
}

function specificity(sel) {
  const s = sel.trim();
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+/g) || []).length
    + (s.match(/\[[^\]]*\]/g) || []).length
    + (s.match(/:(?!:)[\w-]+/g) || []).length;
  const types = (s.match(/(?<![\w-])[a-zA-Z][\w-]*/g) || []).length
    + (s.match(/::[\w-]+/g) || []).length;
  return ids * 1e6 + classes * 1e3 + types;
}

function tailKey(sel) {
  return sel.split(',').map(part => {
    const tail = part.trim().split(/[\s>+~]+/).filter(Boolean).pop() || '';
    return (tail.match(/\.[\w-]+/g) || []).join('');
  }).filter(Boolean).sort().join('|');
}

let pos = 0;
const files = {};
const all = [];
for (const f of order) {
  const text = fs.readFileSync(path.join(skinDir, f), 'utf8');
  files[f] = text;
  const rules = parseFile(f, text, pos);
  pos += rules.length;
  all.push(...rules);
}

const groups = new Map();
for (const r of all) {
  const k = `${r.sel}@@${r.media}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

/** 判断这一组能不能合并。返回 null 表示可以，否则返回原因。 */
function blockReason(group) {
  const sel = group[0].sel;
  const tail = tailKey(sel);
  const spec = Math.min(...sel.split(',').map(specificity));
  const propOccurrences = new Map();
  for (const r of group) {
    for (const d of decls(r.body)) {
      if (!propOccurrences.has(d.prop)) propOccurrences.set(d.prop, []);
      propOccurrences.get(d.prop).push(r.pos);
    }
  }
  for (const [prop, occ] of propOccurrences) {
    if (occ.length < 2) continue;
    const from = occ[0];
    const to = occ[occ.length - 1];
    for (const other of all) {
      if (other.pos <= from || other.pos >= to) continue;
      if (group.includes(other)) continue;
      // **不要跳过 @media 里的规则**。踩过一次：`.record-grid` 的顶层规则
      // 在 shelf.css 与 modern.css 各有一条（padding: 0 2px），中间夹着
      // rooms.css 里 @media (max-width: 440px) 的 padding: 0。原文件里
      // modern.css 在后面，所以窄屏那条其实一直没生效（层叠事故，但这是
      // 现状）；合并把 modern 的规则提到 shelf 之后，窄屏那条突然赢了，
      // 卡片宽度变了 2px、12 份快照崩 1 份。
      if (!decls(other.body).some(d => d.prop === prop)) continue;
      if (tailKey(other.sel) !== tail) continue;
      if (Math.min(...other.sel.split(',').map(specificity)) >= spec) return `${prop} 被 ${other.file}:${other.line} 夹住`;
    }
  }
  return null;
}

// ── 生成合并计划 ──────────────────────────────────────────────────
const plan = []; // { group, merged: Map<prop,val>, order: [prop...] }
let skippedMedia = 0;
for (const [, group] of groups) {
  if (group.length < 2) continue;
  // **只合并顶层规则**。@media 里的同名规则合并风险完全不同：
  // 同一选择器在多个 @media 块里各写一次是「不同断点各自调参」，
  // 合并到第一次出现的位置会把另一档断点的值搬进这一档。
  // 实测踩过一次：`.view-tabs > button` 在 599px 里有两处
  // （rooms.css:311 与 modern.css:128），合并后窄屏 padding 从 8px 变 10px。
  if (group[0].media !== '') { skippedMedia++; continue; }
  if (blockReason(group)) continue;
  const merged = new Map();
  const orderOf = [];
  for (const r of group) {
    for (const d of decls(r.body)) {
      if (!merged.has(d.prop)) orderOf.push(d.prop);
      merged.set(d.prop, d.val);
    }
  }
  plan.push({ group, merged, orderOf });
}

console.log(`[merge] ${all.length} 条规则，${groups.size} 个选择器，可合并 ${plan.length} 个（跳过 @media 内 ${skippedMedia} 个）\n`);

// dry-run 时把前几个合并结果打出来看
if (!write) {
  for (const p of plan.slice(0, 4)) {
    const last = p.group[p.group.length - 1];
    console.log(`${p.group[0].sel}   ${p.group.length} 次（${p.group.map(r => r.file + ':' + r.line).join(', ')}）`);
    console.log(`  → 合并到 ${last.file}:${last.line}，${p.merged.size} 个属性`);
    for (const prop of p.orderOf) console.log(`     ${prop}: ${p.merged.get(prop).slice(0, 60)}`);
    console.log();
  }
  console.log('[merge] dry-run，未写文件。加 --write 真写。');
  process.exit(0);
}

// ── 执行 ─────────────────────────────────────────────────────────
// 每条合并后规则的落点：**该组第一次出现的位置**，而不是最后一次。
// 理由：第一次出现的地方才是这条规则的「家」——`.view-tabs` 的基础样式
// 在 shell.css 里，如果合并到 modern.css（第十三批的补丁），读 shell.css
// 的人会发现导航没有基础样式，反而更难读。
// 前提是 merge-analysis 已经验证过「中间没有别的规则夹住」，所以提前
// 到第一次出现的位置不会改变结果。
//
// 注意：合并可能横跨文件（第一次在 A、后面几次在 B），所以编辑必须
// **按文件独立收集**——只按「第一次所在文件」分组会把 B 里的旧规则漏掉，
// 那样两组规则并存，结果就变了。
const editsByFile = new Map();
for (const f of order) editsByFile.set(f, []);
let deleted = 0;
let rewritten = 0;

for (const p of plan) {
  const first = p.group[0];
  for (const r of p.group) {
    const list = editsByFile.get(r.file);
    if (r === first) {
      const body = p.orderOf.map(prop => `  ${prop}: ${p.merged.get(prop)};`).join('\n');
      list.push({ start: r.offsetStart, end: r.offsetEnd, text: `${r.sel} {\n${body}\n}` });
      rewritten++;
    } else {
      list.push({ start: r.offsetStart, end: r.offsetEnd, text: '' });
      deleted++;
    }
  }
}

for (const [file, edits] of editsByFile) {
  if (!edits.length) continue;
  const src = files[file];
  let text = src;
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) {
    // `offsetStart` 是上一条规则 `}` 之后的第一个字符——通常就是那个换行符。
    // 不把它移出去的话，替换会把换行吃掉，新规则被顶到上一行末尾，
    // 变成 `}.view-tabs {`（这个 bug 卡了四轮，症状是 40 多处规则粘连）。
    while (e.start < e.end && '\r\n \t'.includes(src[e.start])) e.start++;
    while (e.end > e.start && ' \t'.includes(src[e.end - 1])) e.end--;
    text = e.text === ''
      ? cutRule(text, e.start, e.end)
      : text.slice(0, e.start) + e.text + text.slice(e.end);
  }
  fs.writeFileSync(path.join(skinDir, file), tidy(text));
}

/**
 * 删掉 [start, end) 这一段规则。
 *
 * 踩了四次才定下这个最笨的做法：**区间一个字符都不扩展，原样删掉。**
 *
 * 之前的每一次尝试都是在纠结「怎么把这一行连同它的换行一起删干净」：
 * - 同时吃前后换行 → 相邻规则粘连成 `}.next {`（53 处）
 * - 只吃后面那个换行 → 前一条以 `}` 结尾时同样粘连
 * - 按「连续换行 >= 2 才吃」→ 仍然粘
 *
 * 根因是 `offsetStart` 指向的是**上一条规则 `}` 之后的第一个字符**，
 * 中间那一个 `\n` 属于「分隔符」，归前一条规则还是后一条取决于视角，
 * 在这里纠缠不清楚。干脆不扩展：删掉区间本身，剩下的空行交给 tidy 收。
 */
function cutRule(text, start, end) {
  return text.slice(0, start) + text.slice(end);
}

/**
 * 把连续 2 个以上的空行压成 1 个。
 *
 * 只在一行的内容全是空白时才算空行——`@keyframes` 里那种 `  from { ... }\n`
 * 不算。压缩完顺手保证文件结尾恰好有一个换行。
 */
function tidy(text) {
  const lines = text.split('\n');
  const out = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blanks++;
      if (blanks > 1) continue;
      out.push('');
    } else {
      blanks = 0;
      out.push(line);
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

console.log(`[merge] 合并 ${plan.length} 个选择器，重写 ${rewritten} 条、删掉 ${deleted} 条旧规则`);
console.log('[merge] 必须验证：npm run build && 重拍样式快照 && style-diff 必须 12/12 一致');
