#!/usr/bin/env node
/**
 * 找出「写了但确定被后来规则覆盖」的声明。
 *
 * 判定标准刻意保守——只认**同一串选择器、同一 @media 上下文、后来重复声明
 * 同一属性**这一种。这种覆盖不需要知道 DOM 结构就能断定：两个规则命中完全相同
 * 的元素集合，后出现的那个在层叠里必然赢，前面的声明一行都不会生效。
 *
 * 反过来，`.a` 被 `.x .a` 覆盖**不算**——后者只在 `.x` 的后代上生效，
 * 没有 `.x` 的地方前者仍然是唯一来源。那种「部分命中」的判断依赖 DOM，
 * 静态分析做不准，交给计算样式快照去验（见 style-snapshot.cjs）。
 *
 * 用法：node tools/probe/dead-decls.mjs [--list]
 *   --list  逐条列出（默认只给统计）
 *
 * 只读，不修改文件。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SKIN = path.join(ROOT, 'src', 'skin');

// 顺序即层叠顺序，从入口文件的 @import 读，避免两处维护
function loadOrder() {
  const entry = fs.readFileSync(path.join(ROOT, 'src', 'skin-bold.css'), 'utf8');
  return [...entry.matchAll(/@import\s+['"]\.\/skin\/([\w-]+\.css)['"]/g)].map(m => m[1]);
}

/**
 * 把 CSS 切成规则列表。
 *
 * 注释必须先替换成**等长空白**再解析：直接删掉会让后面所有行号错位
 * （踩过一次，报的行 295 实际是 322）。保留换行是等长替换的关键。
 *
 * `pos` 必须是**跨文件的全局序号**，不能按文件从 0 数——否则 modern.css
 * 里 pos=5 的规则会被 rooms.css 里 pos=9 的规则判成「后面来的」，
 * 结论整个反过来。层叠顺序是「文件顺序 → 文件内顺序」，两者合成一个序号。
 */
function parse(file, source, offset) {
  const masked = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const out = [];
  const stack = [];
  let pos = 0;
  let start = 0;
  while (pos < masked.length) {
    const ch = masked[pos];
    if (ch === '{') {
      const sel = masked.slice(start, pos).replace(/\s+/g, ' ').trim();
      if (sel.startsWith('@')) {
        stack.push({ kind: 'at', sel });
      } else {
        stack.push({
          kind: 'rule',
          sel,
          file,
          line: masked.slice(0, pos).split('\n').length,
          media: stack.filter(s => s.kind === 'at').map(s => s.sel).join(' && '),
          pos: offset + out.length,
        });
      }
      start = pos + 1;
    } else if (ch === '}') {
      const frame = stack.pop();
      if (frame && frame.kind === 'rule') {
        frame.body = masked.slice(start, pos);
        out.push(frame);
      }
      start = pos + 1;
    }
    pos++;
  }
  return out;
}

function decls(body) {
  const out = [];
  for (const piece of body.split(';')) {
    const m = piece.match(/^\s*(--[\w-]+|[-a-zA-Z]+)\s*:\s*([\s\S]+)$/);
    if (m) out.push({
      prop: m[1].toLowerCase(),
      val: m[2].trim(),
      important: /!\s*important/i.test(m[2]),
    });
  }
  return out;
}

const rules = [];
for (const file of loadOrder()) {
  const source = fs.readFileSync(path.join(SKIN, file), 'utf8');
  rules.push(...parse(file, source, rules.length));
}

const norm = s => s.replace(/\s+/g, ' ').trim();

/**
 * 一条声明要算死，必须是**每个**选择器片段都被后面的规则覆盖到。
 *
 * 2026-11-15 的第一版只要求「任一片段重叠」，于是
 * `.media-empty-actions > .media-add, .media-empty-actions > button { width: 100% }`
 * 被误判成整条死——后面那条确实重写了 `> button` 的 width，但 `> .media-add`
 * 这一支没有，删掉按钮区就窄了。
 * 反过来，只比整串又漏掉真死声明（逗号组与单条永远对不上字符串）。
 * 所以按片段逐个判，全部有着落才算死。
 */
function selParts(sel) { return sel.split(',').map(norm).filter(Boolean); }

const found = [];
for (const rule of rules) {
  const mine = selParts(rule.sel);
  for (const d of decls(rule.body)) {
    // 每个片段各自去找「后面有没有同样带这个片段、又重写了这个属性」的规则
    const covered = mine.every(part =>
      rules.some(later =>
        later.pos > rule.pos
        && later.media === rule.media
        && selParts(later.sel).includes(part)
        // !important 只能被 !important 压住
        && decls(later.body).some(x => x.prop === d.prop && (!d.important || x.important)),
      ),
    );
    if (covered) found.push({ rule, prop: d.prop, val: d.val });
  }
}

const byRule = new Map();
for (const item of found) {
  const key = `${item.rule.file}:${item.rule.line}`;
  if (!byRule.has(key)) byRule.set(key, { rule: item.rule, items: [] });
  byRule.get(key).items.push(item);
}

const list = process.argv.includes('--list');
const groups = [...byRule.values()];
const whole = groups.filter(g => g.items.length >= decls(g.rule.body).length);
const partial = groups.filter(g => g.items.length < decls(g.rule.body).length);

/**
 * 同名的 `@keyframes` 会整块替换，不是逐帧合并。
 * 所以前一个 `@keyframes rain-fall` 里哪怕只有一帧，只要名字重复、位置在后，
 * 整块都不会生效——这是**整块死**，比单条声明更该报出来。
 *
 * 分组不能按 `media` 字符串做键：两个同名块算出来的 media 字符串一模一样，
 * 会被并成一个（第一版就是这么写的，于是永远发现不了重复）。
 * 要按**连续出现的块**分组——同一 media 字符串的相邻帧属于同一个块，
 * 中间隔了别的规则就是新块。
 */
const keyframeBlocks = []; // { name, media, first, last }
for (const r of rules) {
  const m = r.media.match(/^@keyframes\s+([\w-]+)$/);
  if (!m) continue;
  const prev = keyframeBlocks[keyframeBlocks.length - 1];
  if (prev && prev.media === r.media && prev.last.pos === r.pos - 1) {
    prev.last = r;
  } else {
    keyframeBlocks.push({ name: m[1], media: r.media, first: r, last: r });
  }
}
const byName = new Map();
for (const b of keyframeBlocks) {
  if (!byName.has(b.name)) byName.set(b.name, []);
  byName.get(b.name).push(b);
}
const deadKeyframes = [];
for (const [name, blocks] of byName) {
  if (blocks.length < 2) continue;
  const survivor = blocks[blocks.length - 1];
  for (const dead of blocks.slice(0, -1)) {
    deadKeyframes.push({ name, block: dead.first, survivor: survivor.first });
  }
}

console.log(`死声明 ${found.length} 处，涉及 ${groups.length} 条规则（整条 ${whole.length}、部分 ${partial.length}）`);
if (deadKeyframes.length) {
  console.log(`另有 ${deadKeyframes.length} 个 @keyframes 整块被同名定义覆盖`);
}
if (list) {
  for (const g of groups) {
    const total = decls(g.rule.body).length;
    const tag = g.items.length >= total ? '整条死' : `部分 ${g.items.length}/${total}`;
    const where = g.rule.media ? `  @${g.rule.media}` : '';
    console.log(`\n[${tag}] ${g.rule.file}:${g.rule.line}  ${g.rule.sel}${where}`);
    // 覆盖它的可能不止一条（每个选择器片段各自被不同的规则盖住），所以只说「被后面的规则」。
    console.log(`   ${g.items.map(i => i.prop).join(', ')}  →  已被后面的同名规则覆盖`);
  }
  for (const k of deadKeyframes) {
    console.log(`\n[整块死] ${k.block.file}:${k.block.line}  @keyframes ${k.name}  →  被 ${k.survivor.file}:${k.survivor.line} 的同名定义替换`);
  }
}

// 有死声明就退出码 1，方便当门禁用（CI 或改完自查）
process.exit(found.length || deadKeyframes.length ? 1 : 0);
