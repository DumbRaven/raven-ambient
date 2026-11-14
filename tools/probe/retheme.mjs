/**
 * 令牌收口：把硬编码色值换成语义令牌。
 *
 * 为什么不能一把 sed 全替换：
 *   - 色值可能出现在注释里（本项目有 6 处注释写着「参考图实测 #C5AF83」），
 *     注释里的值有史料价值，替换掉就丢了「当初为什么用这个色」的依据。
 *   - 有色值出现在 `url("data:image/svg+xml,...")` 里，那是 base64 之外的
 *     SVG 源码，改颜色会改掉图形本身。
 *   - 有色值是**绘制参数**而不是**主题色**（黑胶盘面那串
 *     `repeating-radial-gradient(... #1c1c1c 0, #1c1c1c 1px, #0d0d0d 1px ...)`），
 *     它们凑成一个连续的纹路，换成语义令牌反而看不清谁是谁。
 *
 * 所以这个脚本只做 A 组：**已经有令牌、且令牌值就是原值**的那三个色。
 * 这种替换的正确性标准是「计算样式逐字节不变」，而不是「看起来差不多」——
 * 因此它必须配合 tools/probe/styles.cjs 使用，跑完要零差异。
 *
 * 用法：
 *   node tools/probe/retheme.mjs <规则文件.mjs>
 *
 * 规则文件格式（默认导出）：
 *   export default [
 *     { from: '#101010', to: 'var(--bold-ink)' },
 *     ...
 *   ]
 *
 * 也可以带 `only` 字段把替换限制在特定属性上（见下）。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const target = path.join(root, 'src', 'skin-bold.css');

/**
 * 把 CSS 切成「代码段 / 注释段 / 字符串段」三类片段。
 *
 * 只有代码段允许替换。字符串段（引号内）覆盖 `url("data:...")` 那种情况；
 * 注释段覆盖 `/* ... #C5AF83 ... *&#47;` 那种。
 *
 * 手写一小段扫描器而不是上 PostCSS：PostCSS 会把值重新序列化，
 * 空格、换行、引号风格都可能被它改掉，那样就没法用「逐字节零差异」当验收标准了。
 * 这里只做纯文本替换，未命中的部分一个字符都不动。
 */
function segments(css) {
  const out = [];
  let i = 0;
  let start = 0;
  let mode = 'code';

  const push = (end, kind) => {
    if (end > start) out.push({ text: css.slice(start, end), kind });
  };

  while (i < css.length) {
    if (mode === 'code') {
      if (css[i] === '/' && css[i + 1] === '*') {
        push(i, 'code');
        start = i;
        i += 2;
        mode = 'comment';
        continue;
      }
      if (css[i] === '"' || css[i] === "'") {
        push(i, 'code');
        start = i;
        const quote = css[i];
        i++;
        mode = quote === '"' ? 'dquote' : 'squote';
        continue;
      }
      i++;
      continue;
    }
    if (mode === 'comment') {
      if (css[i] === '*' && css[i + 1] === '/') {
        i += 2;
        push(i, 'comment');
        start = i;
        mode = 'code';
        continue;
      }
      i++;
      continue;
    }
    // 字符串内：允许反斜杠转义
    if (css[i] === '\\') { i += 2; continue; }
    if ((mode === 'dquote' && css[i] === '"') || (mode === 'squote' && css[i] === "'")) {
      i++;
      push(i, 'string');
      start = i;
      mode = 'code';
      continue;
    }
    i++;
  }
  push(css.length, 'code');
  return out;
}

/**
 * 构造色值正则：必须**整词匹配**，不能在更长的 hex 里当子串命中。
 *
 * 这个坑踩过：`#ffffff` 会匹配到 `#ffffff1f`（= rgba(255,255,255,0.12)）的
 * 前六个字符，替换成 `var(--bold-bg)1f` —— 那不是合法色值，整条声明被
 * 浏览器丢弃，元素退回初始值。界面上表现为「按钮底色、边框、阴影整片消失」，
 * 而控制台一个字都不报。
 *
 * 加负向先行断言 `(?![\da-fA-F])` 之后，`#ffffff` 只在后面不跟 hex 字符时命中。
 * 顺带解决了 `#fff` 是 `#ffffff` 前缀的问题——B 组用得上。
 */
function colorRe(from) {
  return new RegExp(escapeRe(from) + '(?![0-9a-fA-F])', 'gi');
}

/**
 * 只替换「某个属性值里的色值」。
 *
 * 为什么要按属性限制：同一个色值在不同属性里含义不同。
 * `#fff` 用在 `color` 上是「白字」，用在 `background` 上是「白底」，
 * 用在 `border` 上是「白边」——三者往后要分别叫 `--bold-on-dark` /
 * `--bold-bg` / `--bold-edge`，混成一个令牌就再也拆不开了。
 *
 * 不指定 `only` 时替换所有出现处（A 组三个色就是这么用的：
 * 它们的含义在所有属性里都一致）。
 *
 * 无论哪种模式，都**绝不碰自定义属性的定义处**（`--x: 值`）。
 * 理由：把 `--bold-ink: #101010` 替换成 `--bold-ink: var(--bold-ink)`
 * 就是自引用，CSS 判定为无效，令牌整个失效——所有用它的地方都会退回
 * 初始值或继承值，界面上是「颜色大面积消失」，而错误信息一个都没有。
 * 这个坑第一版就踩了，替换了 344 处，靠人眼看输出才发现。
 */
function replaceInCode(code, rule) {
  const re = colorRe(rule.from);

  // `--name: 值;` 的声明整体不动。先把它挖出来占位，处理完再放回。
  const defs = [];
  let work = code.replace(/(--[a-z0-9-]+\s*:\s*)([^;{}]*?)(;|}|$)/gi, (whole, head, value, tail) => {
    defs.push(whole);
    return `\u0000DEF${defs.length - 1}\u0000`;
  });

  if (rule.only) {
    // 匹配 `属性: ... 色值 ... ;`，逐条声明处理
    work = work.replace(/(([-a-z]+)\s*:\s*)([^;{}]*?)(;|}|$)/g, (whole, head, prop, value, tail) => {
      if (!rule.only.includes(prop)) return whole;
      return head + value.replace(re, rule.to) + tail;
    });
  } else {
    work = work.replace(re, rule.to);
  }

  return work.replace(/\u0000DEF(\d+)\u0000/g, (_, i) => defs[Number(i)]);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ruleFile = process.argv[2];
if (!ruleFile) {
  console.error('用法：node tools/probe/retheme.mjs <规则文件.mjs>');
  process.exit(2);
}

// Windows 上动态 import 绝对路径必须先转成 file:// URL，
// 否则 ESM 加载器会把 `F:\...` 当成不认识的协议（ERR_UNSUPPORTED_ESM_URL_SCHEME）。
const { pathToFileURL } = await import('node:url');
const mod = await import(pathToFileURL(path.resolve(root, ruleFile)).href);
const rules = mod.default;
if (!Array.isArray(rules) || !rules.length) {
  console.error('规则文件必须默认导出非空数组');
  process.exit(2);
}

const css = fs.readFileSync(target, 'utf8');
const segs = segments(css);

let changed = 0;
for (const seg of segs) {
  if (seg.kind !== 'code') continue;
  let text = seg.text;
  for (const rule of rules) {
    const before = text;
    text = replaceInCode(text, rule);
    if (text !== before) {
      const n = (before.match(colorRe(rule.from)) || []).length;
      changed += n;
    }
  }
  seg.text = text;
}

const next = segs.map(s => s.text).join('');
if (next === css) {
  console.log('[retheme] 没有命中任何规则，文件未改动');
  process.exit(0);
}

fs.writeFileSync(target, next);
console.log(`[retheme] 已替换 ${changed} 处，写入 src/skin-bold.css`);
console.log('[retheme] 下一步必须验证：');
console.log('  npx tsc -b --force && npm run build');
console.log('  node tools/probe/style-diff.mjs .qa/style-before .qa/style-after   # 必须零差异');
console.log('  然后跑像素基线，也必须零差异');
