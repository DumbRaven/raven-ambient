#!/usr/bin/env node
/**
 * 删掉「确定不会生效」的声明与整块。
 *
 * 只处理 `dead-decls.mjs` 认定**确定**的两类：
 *
 *   1. 同一串选择器、同一 @media 上下文、后来重复声明同一属性。
 *      两条规则命中完全相同的元素集合，后者在层叠里必然赢，前面的声明
 *      一行都不会生效。删掉不改变任何渲染。
 *
 *   2. 同名的 `@keyframes` 后一份会整块替换前一份。前一份一帧都不会用上。
 *
 * 刻意**不**处理「被更具体的选择器压住」那类：`.a` 被 `.x .a` 覆盖只在
 * 「同时带 .x」的元素上成立，没有 .x 的地方前者仍是唯一来源。那需要 DOM
 * 才能判断，交给人或计算样式快照。
 *
 * 删完之后如果某条规则的所有声明都死了，整条规则一起删（含它前面的注释，
 * 因为注释解释的是那条已经不存在的代码）。
 *
 * 用法：
 *   node tools/probe/clean-dead.mjs          干跑，打印将要删除的内容
 *   node tools/probe/clean-dead.mjs --write  真删
 *
 * 验收：style-diff 12 份必须逐属性一致。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIN = path.join(ROOT, 'src', 'skin');
const write = process.argv.includes('--write');

/**
 * 读层叠顺序。顺序即层叠：`@import` 的先后决定谁压谁，
 * 所以这个顺序必须从入口文件读，不能在这里再抄一份。
 */
function loadOrder() {
  const entry = fs.readFileSync(path.join(ROOT, 'src', 'skin-bold.css'), 'utf8');
  return [...entry.matchAll(/@import\s+['"]\.\/skin\/([\w-]+\.css)['"]/g)].map(m => m[1]);
}

/**
 * 解析成规则列表，带**原始偏移量**——删除要按偏移切原文，
 * 不能重新序列化 CSS，那会改掉空格与引号风格，就没法用逐字节比对验收。
 *
 * `pos` 是跨文件全局序号（层叠顺序 = 文件顺序 + 文件内顺序）。
 * 注释换成等长空白（保留换行），否则偏移量与行号都会错。
 *
 * `stmtStart` 是选择器文本的起点：从上一个 `}` 或 `{` 之后的第一个
 * 非空白字符算起，而不是直接取循环里的 `start`。`start` 指向上一个
 * 分隔符的下一个字符，中间可能夹着空白与不相关的注释；直接用它会让
 * 「整条规则删除」把选择器本身留在原地，变成一个空壳 `.record-grid `
 * （踩过，build 会报空规则但视觉无异常，很难发现）。
 */
function parse(file, source, offset) {
  const masked = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const out = [];
  const stack = [];
  /** at-rule 左花括号偏移 → 它自己那层 `}` 的偏移。keyframes 整块删除要用。 */
  const atClose = new Map();
  let pos = 0;
  let start = 0;
  while (pos < masked.length) {
    const ch = masked[pos];
    if (ch === '{') {
      const sel = masked.slice(start, pos).replace(/\s+/g, ' ').trim();
      // 跳过前导空白找到选择器真正的第一个字符
      let stmt = start;
      while (stmt < pos && /\s/.test(masked[stmt])) stmt++;
      if (sel.startsWith('@')) {
        // 记下 at-rule 的**起始语句**偏移（`@` 那个字符），不是左花括号的位置。
        // 整块删除要从 `@` 开始切，只从 `{` 切会留下一个孤零零的
        // `@keyframes rain-fall` 头（踩过）。
        stack.push({ kind: 'at', sel, open: pos, stmtStart: masked.lastIndexOf('@', pos) });
      } else {
        const atFrames = stack.filter(s => s.kind === 'at');
        stack.push({
          kind: 'rule',
          sel,
          file,
          line: masked.slice(0, pos).split('\n').length,
          media: atFrames.map(s => s.sel).join(' && '),
          atOpen: atFrames.length ? atFrames[atFrames.length - 1].open : -1,
          atStmt: atFrames.length ? atFrames[atFrames.length - 1].stmtStart : -1,
          pos: offset + out.length,
          open: pos,
          stmtStart: stmt,
          bodyStart: pos + 1,
        });
      }
      start = pos + 1;
    } else if (ch === '}') {
      const frame = stack.pop();
      if (frame && frame.kind === 'rule') {
        frame.body = masked.slice(frame.bodyStart, pos);
        frame.close = pos;
        out.push(frame);
      } else if (frame && frame.kind === 'at') {
        // at-rule 自己那层右花括号。必须记下来：`@keyframes` 里的帧规则
        // 各自有 `}`，但整块删除要切到外层那个，否则会剩一个孤立的 `}`
        // 让 postcss 报 `Unexpected }`（踩过，build 直接失败）。
        atClose.set(frame.open, pos);
      }
      start = pos + 1;
    }
    pos++;
  }
  // 内层规则入栈时 at-rule 还没闭合，拿不到 closeAll，这里补一遍。
  for (const r of out) {
    if (r.atOpen >= 0 && atClose.has(r.atOpen)) r.closeAll = atClose.get(r.atOpen);
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

const order = loadOrder();
const rules = [];
for (const file of order) {
  const source = fs.readFileSync(path.join(SKIN, file), 'utf8');
  rules.push(...parse(file, source, rules.length));
}

const norm = s => s.replace(/\s+/g, ' ').trim();

// ── 判定：每个声明是不是死的 ──────────────────────────────────────
/**
 * `@keyframes` 内部的帧不参与这个判定。
 *
 * 它们的选择器是 `from` / `to` / `50%`，字面上会「撞车」，但两帧永远不会
 * 命中同一个元素——真正决定生死的是**同名 keyframes 整块替换**，
 * 由下面的 deadBlocks 单独处理。第一版没排除，同一个 `to` 被两个机制
 * 各删一次，删的是重叠的两段偏移，第二次删就会切错位置。
 */
const inKeyframes = r => /^@keyframes\s/.test(r.media);
/**
 * 选择器按逗号拆开逐段比。
 *
 * 与 dead-decls.mjs 保持同一套判据：一条声明要算死，**每个**片段都得被后面的
 * 规则重写。只比整串会漏掉「逗号组压单条」（collage.css 里那两条字号）；
 * 只要求任一片段重叠又会误删（`.media-add, > button` 的 width 只有一支被重写，
 * 删了按钮区就窄了）。
 */
const selParts = sel => sel.split(',').map(norm).filter(Boolean);
/** key = `${file}:${line}` → { rule, props } */
const deadProps = new Map();
for (const rule of rules) {
  if (inKeyframes(rule)) continue;
  const mine = selParts(rule.sel);
  for (const d of decls(rule.body)) {
    const covered = mine.every(part =>
      rules.some(later =>
        later.pos > rule.pos
        && !inKeyframes(later)
        && later.media === rule.media
        && selParts(later.sel).includes(part)
        && decls(later.body).some(x => x.prop === d.prop && (!d.important || x.important)),
      ),
    );
    if (!covered) continue;
    const key = `${rule.file}:${rule.line}`;
    if (!deadProps.has(key)) deadProps.set(key, { rule, props: new Set() });
    deadProps.get(key).props.add(d.prop);
  }
}

// ── 判定：哪些 @keyframes 整块死 ───────────────────────────────────
const keyframeBlocks = [];
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
/** 需要整块删除的 @keyframes：{ file, from, to, name } 按偏移 */
const deadBlocks = [];
for (const [name, blocks] of byName) {
  if (blocks.length < 2) continue;
  for (const dead of blocks.slice(0, -1)) {
    deadBlocks.push({
      file: dead.first.file,
      from: dead.first.atStmt,
      to: dead.last.closeAll ?? dead.last.close,
      line: dead.first.line,
      name,
    });
  }
}

// ── 生成编辑：按文件、按偏移从大到小 ───────────────────────────────
const editsByFile = new Map();
const pushEdit = (file, start, end, note) => {
  if (!editsByFile.has(file)) editsByFile.set(file, []);
  editsByFile.get(file).push({ start, end, note });
};

for (const { rule, props } of deadProps.values()) {
  const all = decls(rule.body);
  if (props.size >= all.length) {
    // 整条规则都死了：连同它前面的注释一起删。
    // 注释解释的是那条已经不存在的代码，留着会误导下一个读的人。
    //
    // 起点必须是 `stmtStart`（选择器第一个字符），不是 `open`（左花括号）。
    // 从 `{` 开始切会把选择器留在原地，文件里出现一行空壳 `.record-grid `
    // ——浏览器会忽略这条空规则，视觉毫无异常，但读代码的人会以为它还活着。
    const source = fs.readFileSync(path.join(SKIN, rule.file), 'utf8');
    let from = rule.stmtStart;
    const before = source.slice(0, from);
    // 只吃紧贴在上面的那一段注释。
    //
    // 不能写 `/(\/\*[\s\S]*?\*\/\s*)$/`：`match` 从**第一个** `/*` 开始尝试，
    // 只要 file 末尾是注释，这个懒量词就会一路吃到结尾，把中间的代码全划进
    // 删除范围。踩过：一条 `.record-grid` 的清理连带删掉了 `container-type: size`，
    // build 照过，只有计算样式快照抓到 367 个属性变化。
    const trimmed = before.replace(/\s+$/, '');
    if (trimmed.endsWith('*/')) {
      const open = trimmed.lastIndexOf('/*');
      // `/*` 与 `*/` 之间若又出现 `*/`，说明不是同一段注释，放弃删除。
      if (open >= 0 && trimmed.indexOf('*/', open) === trimmed.length - 2) from = open;
    }
    pushEdit(rule.file, from, rule.close + 1, `整条 ${rule.sel}`);
  } else {
    // 部分死：只删死掉的声明。
    // 按分号切原文再定位，不能按 decls() 的输出去拼——那会丢掉
    // `!important`、空格与自定义属性的原始写法。
    const source = fs.readFileSync(path.join(SKIN, rule.file), 'utf8');
    const bodyStart = rule.bodyStart;
    const bodyEnd = rule.close;
    let cursor = bodyStart;
    const pieces = [];
    while (cursor < bodyEnd) {
      const semi = source.indexOf(';', cursor);
      const end = semi === -1 || semi > bodyEnd ? bodyEnd : semi + 1;
      const text = source.slice(cursor, end);
      const m = text.match(/^\s*(--[\w-]+|[-a-zA-Z]+)\s*:/);
      if (m && props.has(m[1].toLowerCase())) {
        pieces.push({ start: cursor, end, note: `声明 ${m[1]}（${rule.sel}）` });
      }
      cursor = end;
    }
    for (const p of pieces) pushEdit(rule.file, p.start, p.end, p.note);
  }
}

for (const b of deadBlocks) {
  pushEdit(b.file, b.from, b.to + 1, `@keyframes ${b.name}（被同名定义整块替换）`);
}

// ── 执行或干跑 ────────────────────────────────────────────────────
if (!editsByFile.size) {
  console.log('[clean] 没有可删的死声明。');
  process.exit(0);
}

let removed = 0;
for (const [file, edits] of editsByFile) {
  edits.sort((a, b) => b.start - a.start);
  const full = path.join(SKIN, file);
  let text = fs.readFileSync(full, 'utf8');
  for (const e of edits) {
    removed++;
    if (!write) {
      console.log(`[${file}] ${e.note}`);
      console.log(`    删 ${JSON.stringify(text.slice(e.start, Math.min(e.end, e.start + 90)).trim().slice(0, 90))}`);
      continue;
    }
    text = text.slice(0, e.start) + text.slice(e.end);
  }
  if (write) {
    // 清掉删除留下的连续空行。只压 3 个以上连续空行为 1 个，
    // 保留原本就有的分段空行——那是作者用来分节的可读结构。
    text = text.replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(full, text);
  }
}

if (!write) {
  console.log(`\n[clean] 干跑：共 ${removed} 处。加 --write 真删。`);
} else {
  console.log(`[clean] 已删 ${removed} 处。`);
  console.log('[clean] 必须验证：npm run build && 重拍样式快照 && style-diff 必须 12/12 一致');
}
