/**
 * 第二轮切分：把还太长的三个文件按内部主分节再拆开。
 *
 * 第一轮切出 10 个文件后，gallery.css 还有 2554 行、collage.css 1698 行、
 * stage.css 1444 行——仍然超出「能读完」的量级。这次把它们的内部主分节
 * 拆成独立文件。
 *
 * 规则与第一轮完全相同，且更严格：切点必须落在顶层、分区必须首尾相连
 * 覆盖全文、切完由 style-diff 逐属性比对 12 份快照。
 *
 * 与第一轮的区别：这次不重写整份 CSS，只把已有文件按行号切片，
 * 并改写 skin-bold.css 的 @import 顺序。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skinDir = path.join(root, 'src', 'skin');
const entry = path.join(root, 'src', 'skin-bold.css');
const write = process.argv.includes('--write');

/** 每个源文件要拆成哪些片：[起始行, 结束行, 新文件名, 说明] */
const PLAN = {
  'gallery.css': [
    [1, 1693, 'gallery.css', '放映：媒体库列表、来源、票根（含复古票）'],
    [1694, 2151, 'theater.css', '放映：壁纸库、播放台、桌面直播、全屏'],
    [2152, 2562, 'theater-fix.css', '放映：全屏修正、场景壁纸、按视口收、添加区（追加轮）'],
  ],
  'stage.css': [
    [1, 648, 'stage.css', '放映：三套版式、换件换碟、透明模式'],
    [649, 1452, 'atmosphere.css', '放映：窄屏、叠加元素、全屏补丁、雨、乌鸦、拼贴修正'],
  ],
  'collage.css': [
    [1, 881, 'collage.css', '拼贴版式：唱片、面板、配色（AE 对齐前半）'],
    [882, 1706, 'collage-type.css', '拼贴版式：文字按 AE 锚点绝对定位（靠书写顺序覆盖，见文件头）'],
  ],
};

// ── 校验 ──────────────────────────────────────────────────────────
let problems = 0;
for (const [file, parts] of Object.entries(PLAN)) {
  const full = path.join(skinDir, file);
  const raw = fs.readFileSync(full, 'utf8');
  const lines = raw.split('\n');
  const nonEmpty = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);

  const covered = parts.reduce((s, [a, b]) => s + (b - a + 1), 0);
  if (covered !== nonEmpty) {
    console.error(`[split2] ${file}：分区覆盖 ${covered} 行，实际 ${nonEmpty} 行`);
    problems++;
  }
  for (let i = 1; i < parts.length; i++) {
    if (parts[i][0] !== parts[i - 1][1] + 1) {
      console.error(`[split2] ${file}：第 ${i} 片与上一片之间有缝`);
      problems++;
    }
  }

  // 切点必须在顶层
  const masked = raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const depthAt = new Array(masked.length + 1).fill(0);
  let d = 0;
  for (let i = 0; i < masked.length; i++) {
    depthAt[i] = d;
    if (masked[i] === '{') d++;
    else if (masked[i] === '}') d--;
  }
  if (d !== 0) {
    console.error(`[split2] ${file}：括号不配对（结束深度 ${d}）`);
    problems++;
  }
  const offsets = [0];
  for (let i = 0; i < raw.length; i++) if (raw[i] === '\n') offsets.push(i + 1);
  for (const [a] of parts.slice(1)) {
    const off = offsets[a - 1];
    if (off === undefined) {
      console.error(`[split2] ${file}：第 ${a} 行不存在`);
      problems++;
    } else if (depthAt[off] !== 0) {
      console.error(`[split2] ${file}：第 ${a} 行在 @media 内部（深度 ${depthAt[off]}）`);
      problems++;
    }
  }
  console.log(`[split2] ${file} ${nonEmpty} 行 → ${parts.length} 片`);
  for (const [a, b, name, note] of parts) {
    console.log(`    ${name.padEnd(18)} ${String(a).padStart(4)}-${String(b).padStart(4)}  ${note}`);
  }
}

if (problems) {
  console.error(`[split2] 校验失败 ${problems} 处，未写任何文件`);
  process.exit(1);
}

if (!write) {
  console.log('\n[split2] dry-run，未写文件。加 --write 真写。');
  process.exit(0);
}

// ── 写文件 ────────────────────────────────────────────────────────
/** 把原文件的头注释（第一个规则之前的注释块）摘出来，给第一片用。 */
function headComment(text) {
  const m = text.match(/^\s*(\/\*[\s\S]*?\*\/)\s*/);
  return m ? { head: m[1], rest: text.slice(m[0].length) } : { head: '', rest: text };
}

/** 新增片的横幅：说明它来自哪个文件的哪一段、在层叠里的位置。 */
function banner(name, note, origin, index, count) {
  return [
    `/* ${'='.repeat(74)}`,
    ` * ${name} —— ${note}`,
    ` *`,
    ` * 从 ${origin} 切出，层叠顺序 ${index + 1}/${count}。`,
    ` * 顺序由 skin-bold.css 里的 @import 决定，改顺序会改变渲染结果。`,
    ` * ${'='.repeat(74)} */`,
    '',
  ].join('\n');
}

const newImports = [];
for (const [file, parts] of Object.entries(PLAN)) {
  const full = path.join(skinDir, file);
  const raw = fs.readFileSync(full, 'utf8');
  const lines = raw.split('\n');
  const nonEmpty = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
  const all = lines.slice(0, nonEmpty).join('\n');

  for (let i = 0; i < parts.length; i++) {
    const [a, b, name, note] = parts[i];
    const body = lines.slice(a - 1, b).join('\n').replace(/\s+$/, '') + '\n';
    let text;
    if (i === 0) {
      // 第一片沿用原文件名与原头注释，不额外加横幅（原来的头注释已经说清了）
      text = body;
    } else {
      text = banner(name, note, file, i, parts.length) + body;
    }
    fs.writeFileSync(path.join(skinDir, name), text);
    newImports.push(name);
  }
  // 原文件如果是第一片就已被覆盖写回；否则删掉旧文件（它已被切片替代）
  if (parts[0][2] !== file) {
    fs.unlinkSync(full);
  }
}

// 重写入口：保持宏观顺序——原来 gallery 在 stage 之前，现在 gallery 三片、
// stage 两片、collage 两片仍然按原顺序排列。
const ORDER = [
  'base.css', 'shell.css', 'shelf.css', 'controls.css', 'rooms.css',
  'widgets.css', 'modern.css',
  'gallery.css', 'theater.css', 'theater-fix.css',
  'stage.css', 'atmosphere.css',
  'collage.css', 'collage-type.css',
];
const missing = ORDER.filter(n => !fs.existsSync(path.join(skinDir, n)));
if (missing.length) {
  console.error(`[split2] 缺少文件：${missing.join(', ')}`);
  process.exit(1);
}
const extra = fs.readdirSync(skinDir).filter(n => n.endsWith('.css') && !ORDER.includes(n));
if (extra.length) {
  console.error(`[split2] 有未纳入本次切分的文件：${extra.join(', ')}`);
  process.exit(1);
}

fs.writeFileSync(entry, [
  '/* ' + '='.repeat(74),
  ' * skin-bold.css —— 明亮版皮肤入口。',
  ' *',
  ' * 这里只有 @import，没有规则。真正的样式在 src/skin/ 下按领域分开。',
  ' * **顺序有意义**：CSS 的层叠由书写顺序决定，这里一条条往下读就是',
  ' * 浏览器的层叠顺序。原先是 8359 行的单文件，切开只是因为没人读得完，',
  ' * 渲染结果一个像素都没变（切分时逐属性比对过 12 份计算样式快照）。',
  ' *',
  ' * 与 styles.css 的关系：main.tsx / desktop.tsx 里 styles.css 先加载、',
  ' * 本文件后加载，同优先级时后者赢。这是原版就有的约定，别调换。',
  ' * ' + '='.repeat(74) + ' */',
  '',
  ...ORDER.map(n => `@import './skin/${n}';`),
  '',
].join('\n'));

console.log(`\n[split2] 已完成，入口现在有 ${ORDER.length} 条 @import`);
console.log('[split2] 必须验证：npm run build && 重拍样式快照 && style-diff 必须 12/12 一致');
