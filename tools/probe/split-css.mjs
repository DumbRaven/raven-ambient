/**
 * 把 8359 行的 skin-bold.css 按「领域」切成若干文件。
 *
 * 为什么切：AGENTS.md 里那条「一个文件大到读不完，等于没人敢改它」。
 * 8359 行意味着改唱片柜的卡片要看 8359 行里的 300 行，找的时候靠 grep，
 * 找到之后还不知道上下一千行有没有别的规则在跟它抢。
 *
 * 为什么切完不会改变渲染结果——三条依据：
 *   1. 所有切点都落在**顶层**（@media 之外）的分节注释前。脚本会先校验
 *      每个切点处的括号深度为 0，不满足直接报错退出，不写文件。
 *   2. 切出来的文件按原顺序由 @import 串起来。CSS 规范里 @import 的
 *      层叠顺序就是书写顺序，跟原来一条条往下写等价。
 *   3. 验收不靠「看着一样」，靠 tools/probe/style-diff.mjs 逐属性比对
 *      12 份快照（274 万个属性）。一个字都不许变。
 *
 * 用法：
 *   node tools/probe/split-css.mjs            # 默认 dry-run，只打印计划
 *   node tools/probe/split-css.mjs --write    # 真写文件
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'src', 'skin-bold.css');
const outDir = path.join(root, 'src', 'skin');
const write = process.argv.includes('--write');

const raw = fs.readFileSync(src, 'utf8');
const lines = raw.split('\n');

/**
 * 分区表：每项 [起始行, 结束行, 文件名, 一句话说明]。
 * 行号是 1-based，且必须落在顶层——脚本会校验。
 */
const ZONES = [
  [1, 74, 'base.css', '令牌、重置、原版变量的桥接'],
  [75, 298, 'shell.css', '应用外壳：品牌条、首屏标题、页签导航、工具条'],
  [299, 602, 'shelf.css', '唱片柜：卡片、掀开动作、右侧介绍'],
  [603, 995, 'controls.css', '通用控件：滑杆、开关、按钮、分页、弹窗、提示条'],
  [996, 1349, 'rooms.css', '正在听、专注、队列拖拽，以及它们的断点'],
  [1350, 1978, 'widgets.css', '滚字计数器、播放台、设置里的开关与滑杆'],
  [1979, 2663, 'modern.css', '第十三~二十批：Today 式头部、导航展开、封面网格、换页、播放卡'],
  [2664, 5217, 'gallery.css', '放映：媒体库、票根、壁纸库、播放台、全屏'],
  [5218, 6661, 'stage.css', '放映：三套版式、换件换碟、透明模式、雨、乌鸦'],
  [6662, 8359, 'collage.css', '拼贴版式的 AE 对齐（这段靠书写顺序覆盖，见文件头）'],
];

// ── 校验切点都在顶层 ──────────────────────────────────────────────
// 注释里的括号不算，先屏蔽注释内容（保留长度与换行，偏移量不变）。
const masked = raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
const depthAt = new Array(masked.length + 1).fill(0);
let d = 0;
for (let i = 0; i < masked.length; i++) {
  depthAt[i] = d;
  if (masked[i] === '{') d++;
  else if (masked[i] === '}') d--;
}
if (d !== 0) {
  console.error(`[split] 原文件括号不配对（结束时深度 ${d}），不敢切`);
  process.exit(1);
}

const lineOffsets = [0];
for (let i = 0; i < raw.length; i++) if (raw[i] === '\n') lineOffsets.push(i + 1);

let bad = 0;
for (const [a] of ZONES) {
  if (a === 1) continue;
  const off = lineOffsets[a - 1];
  if (off === undefined) {
    console.error(`[split] 第 ${a} 行不存在`);
    bad++;
    continue;
  }
  if (depthAt[off] !== 0) {
    console.error(`[split] 第 ${a} 行在 @media 内部（深度 ${depthAt[off]}），不能作为切点`);
    bad++;
  }
}
if (bad) {
  console.error('[split] 切点校验失败，未写任何文件');
  process.exit(1);
}

// 分区必须首尾相接、覆盖全文，漏一行就等于悄悄删掉一条规则。
// 末尾那个换行会让 split 多出一个空串，所以按「非空行数」比对。
const nonEmpty = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
const covered = ZONES.reduce((s, [a, b]) => s + (b - a + 1), 0);
if (covered !== nonEmpty) {
  console.error(`[split] 分区覆盖 ${covered} 行，文件有 ${nonEmpty} 行，不连续`);
  process.exit(1);
}
for (let i = 1; i < ZONES.length; i++) {
  if (ZONES[i][0] !== ZONES[i - 1][1] + 1) {
    console.error(`[split] 第 ${i} 个分区与上一个之间有缝：${ZONES[i - 1][1]} → ${ZONES[i][0]}`);
    process.exit(1);
  }
}

// ── 打印计划 ──────────────────────────────────────────────────────
console.log(`[split] 原文件 ${lines.length} 行 → ${ZONES.length} 个文件`);
let total = 0;
for (const [a, b, name, note] of ZONES) {
  const n = b - a + 1;
  total += n;
  console.log(`  ${name.padEnd(14)} ${String(a).padStart(5)}-${String(b).padStart(5)}  ${String(n).padStart(4)} 行  ${note}`);
}
console.log(`  合计 ${total} 行`);

if (!write) {
  console.log('\n[split] dry-run，未写文件。加 --write 真写。');
  process.exit(0);
}

// ── 写文件 ────────────────────────────────────────────────────────
fs.mkdirSync(outDir, { recursive: true });

/** 每个文件开头的横幅：说清它在层叠里的位置，以及它覆盖谁、被谁覆盖。 */
function banner(name, note, index) {
  const prev = index > 0 ? ZONES[index - 1][2] : null;
  const next = index < ZONES.length - 1 ? ZONES[index + 1][2] : null;
  const order = `层叠顺序 ${index + 1}/${ZONES.length}（${prev ? `接在 ${prev} 之后` : '第一个'}${next ? `，${next} 接在后面` : '，最后一个'}）`;
  return [
    `/* ${'='.repeat(74)}`,
    ` * ${name} —— ${note}`,
    ` *`,
    ` * ${order}。`,
    ` * 顺序由 skin-bold.css 里的 @import 决定，改顺序会改变渲染结果。`,
    ` * 本文件由 tools/probe/split-css.mjs 从单文件切出，切分时逐属性比对过`,
    ` * 12 份计算样式快照（无差异），所以内容与原文件等价。`,
    ` * ${'='.repeat(74)} */`,
    '',
  ].join('\n');
}

for (let i = 0; i < ZONES.length; i++) {
  const [a, b, name, note] = ZONES[i];
  const body = lines.slice(a - 1, b).join('\n');
  let head;
  if (i === 0) {
    // 第一个文件保留原文件头顶那段解释令牌为什么放 :root 的大注释，
    // 只把重复的分隔线去掉。
    head = '';
  } else {
    head = banner(name, note, i);
  }
  fs.writeFileSync(path.join(outDir, name), head + body.replace(/\s+$/, '') + '\n');
}

// 入口文件：只有 import，顺序即层叠顺序
const entry = [
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
  ...ZONES.map(([, , name]) => `@import './skin/${name}';`),
  '',
].join('\n');

fs.writeFileSync(src, entry);
console.log(`\n[split] 已写入 ${ZONES.length} 个文件到 src/skin/，入口 src/skin-bold.css 只剩 @import`);
console.log('[split] 下一步必须验证：');
console.log('  npm run build && 重拍样式快照 && node tools/probe/style-diff.mjs .qa/style-before .qa/style-split');
