/**
 * 分析「同一选择器被定义多次」的合并可行性。
 *
 * 背景：拼贴版式那几个选择器被定义了 4~7 次（.tpl-words 7 次、
 * .tpl-title-text 6 次、.tpl-sub 6 次），全是照 AE 稿对锚点时在文件末尾
 * 追加的。每次只改一两个属性，靠「写在后面」赢。
 *
 * 合并看起来简单——把每个属性取最后一次的值、合成一条规则——但有一个
 * 不明显的坑：**合并会把规则挪到最后一次出现的位置**，如果两次之间夹着
 * 一条「选择器不同但特异性相同、且能匹配同一个元素」的规则，合并就会让
 * 前者压过后者，改变渲染结果。
 *
 * 所以这个脚本对每个属性单独判断：
 *   在「该属性第一次出现」与「最后一次出现」之间，是否存在
 *   选择器尾段相同（即可能命中同一元素）、且特异性不低于它的规则，
 *   也声明了同一个属性。
 * 存在 → 该属性不合并（整个选择器组就跳过）。
 *
 * 只做分析，不改文件。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skinDir = path.join(root, 'src', 'skin');
const entry = fs.readFileSync(path.join(root, 'src', 'skin-bold.css'), 'utf8');
const order = [...entry.matchAll(/@import '\.\/skin\/([^']+)'/g)].map(m => m[1]);

/** 解析一份 CSS，返回规则列表。pos 是全文递增的序号，用于判断先后。 */
function parseFile(file, text, basePos) {
  const masked = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const rules = [];
  const stack = [];
  let pos = 0;
  let start = 0;
  while (pos < masked.length) {
    const ch = masked[pos];
    if (ch === '{') {
      const sel = masked.slice(start, pos).trim();
      const line = masked.slice(0, pos).split('\n').length;
      if (sel.startsWith('@')) {
        stack.push({ kind: 'at', sel });
      } else {
        stack.push({
          kind: 'rule',
          sel: sel.replace(/\s+/g, ' '),
          file,
          line,
          media: stack.filter(s => s.kind === 'at').map(s => s.sel).join(' && '),
          bodyStart: pos + 1,
        });
      }
      start = pos + 1;
    } else if (ch === '}') {
      const r = stack.pop();
      if (r && r.kind === 'rule') {
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

/** 把声明体拆成 [{prop, val, imp}]。 */
function decls(body) {
  const out = [];
  for (const part of body.split(';')) {
    const m = part.match(/^\s*(--[\w-]+|[-a-zA-Z]+)\s*:\s*([\s\S]+)$/);
    if (m) out.push({ prop: m[1].toLowerCase(), val: m[2].trim().replace(/\s+/g, ' ') });
  }
  return out;
}

/**
 * 选择器特异性（近似）。只用来判断「可能不高于」，所以按 (id, class, type) 三元组算。
 * 属性选择器、伪类都算 class 级，伪元素算 type 级——与本项目的用法一致。
 */
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

/** 选择器的「尾段」：最后一个复合选择器里的类名。用来判断可能命中同一元素。 */
function tailKey(sel) {
  // 取逗号分组里每一组的最后一段，连起来。够保守：多认一些比漏认好。
  return sel.split(',')
    .map(part => {
      const tail = part.trim().split(/[\s>+~]+/).filter(Boolean).pop() || '';
      return (tail.match(/\.[\w-]+/g) || []).join('');
    })
    .filter(Boolean)
    .sort()
    .join('|');
}

let pos = 0;
const all = [];
for (const f of order) {
  const text = fs.readFileSync(path.join(skinDir, f), 'utf8');
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

const multi = [...groups.values()].filter(g => g.length >= 2);
console.log(`规则 ${all.length} 条，被定义 2 次以上的选择器 ${multi.length} 个`);

const mergeable = [];
const blocked = [];

for (const group of multi) {
  const sel = group[0].sel;
  const tail = tailKey(sel);
  const spec = specificity(sel.split(',')[0]);
  const firstPos = group[0].pos;
  const lastPos = group[group.length - 1].pos;

  // 收集这一组里所有出现过的属性
  const props = new Map(); // prop -> [出现位置...]
  for (const r of group) {
    for (const d of decls(r.body)) {
      if (!props.has(d.prop)) props.set(d.prop, []);
      props.get(d.prop).push(r.pos);
    }
  }

  // 检查组内每个属性的区间里，有没有「别人」也声明了它
  const reasons = [];
  for (const [prop, occurrences] of props) {
    if (occurrences.length < 2) continue; // 只声明过一次，谈不上合并
    const from = occurrences[0];
    const to = occurrences[occurrences.length - 1];
    for (const other of all) {
      if (other.pos <= from || other.pos >= to) continue;
      if (group.includes(other)) continue;
      if (other.media !== group[0].media) continue;
      if (!decls(other.body).some(d => d.prop === prop)) continue;
      if (tailKey(other.sel) !== tail) continue;
      const os = Math.min(...other.sel.split(',').map(specificity));
      if (os >= spec) {
        reasons.push(`${prop} 在 ${other.file}:${other.line}（${other.sel.slice(0, 44)}）被夹在中间`);
        break;
      }
    }
  }

  if (reasons.length) {
    blocked.push({ sel, count: group.length, reasons });
  } else {
    mergeable.push({
      sel,
      count: group.length,
      files: [...new Set(group.map(r => r.file))],
      props: props.size,
    });
  }
}

console.log(`\n可安全合并：${mergeable.length} 个选择器`);
let savedProps = 0;
for (const m of mergeable.sort((a, b) => b.count - a.count)) {
  savedProps += m.count - 1;
  console.log(`  ${m.count}次 ${m.sel.slice(0, 58).padEnd(60)} ${m.files.join(' + ')}`);
}

console.log(`\n有夹层规则、不能合并：${blocked.length} 个`);
for (const b of blocked) {
  console.log(`  ${b.count}次 ${b.sel.slice(0, 50).padEnd(52)}`);
  for (const r of b.reasons.slice(0, 2)) console.log(`       ${r}`);
}
