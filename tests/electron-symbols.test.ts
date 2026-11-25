/**
 * `electron/*.cjs` 里不能有「引用了但没定义」的裸符号。
 *
 * 起因是一个真实事故（2026-11-16 的 8ecbe00，直到 11-25 在 Mac 上真机启动
 * 才暴露）：那次审计把 `now-playing.cjs` 里内联的
 * `String(webContents.getURL()).includes('mini.html')` 换成了 `isSubWindow(...)`，
 * 但那个函数定义在 `media.cjs` 里、也没导出。于是 `attachNowPlaying()` 的
 * 400ms 轮询每一轮都抛 `ReferenceError: isSubWindow is not defined`。
 *
 * 为什么 tsc 与现有单测都拦不住：
 *   - `electron/*.cjs` 是 .cjs，不在 tsconfig 的 include 里，tsc 根本不看；
 *   - 单测只 require 那些**能独立加载**的模块（media-grants / version /
 *     now-playing-mac），而 `now-playing.cjs` 一加载就 `require('electron')`，
 *     纯 node 下起不来，所以从来没人 require 过它；
 *   - 错误发生在 setInterval 回调里，且是 UnhandledPromiseRejection，
 *     不会崩窗口，只是那一轮什么都不做。
 *
 * 所以这里不执行代码，只做静态检查：把每个文件里「看起来像被调用/读取的
 * 标识符」收集起来，减去它自己定义的和 require 进来的，剩下的必须来自
 * Node 内置或全局。谁再写这种符号，测试直接红。
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const dir = fileURLToPath(new URL('../electron', import.meta.url));

/** 允许直接出现、不需要在本文件声明的全局（含 Electron 主进程注入的）。 */
const GLOBALS = new Set([
  'window', 'document', 'console', 'process', 'module', 'exports', 'require',
  'globalThis', 'Buffer', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'queueMicrotask', 'structuredClone', 'fetch', 'AbortController', 'performance',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Symbol', 'BigInt', 'Intl', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array',
  'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer',
  'DataView', 'SharedArrayBuffer', 'Atomics', 'Reflect', 'Proxy', 'Function',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'escape', 'unescape',
  'Infinity', 'NaN', 'undefined', 'arguments', 'eval',
  // 宿主（Node / Electron / WHATWG）提供的全局构造器与函数
  'Response', 'Request', 'Headers', 'ReadableStream', 'WritableStream',
  'TransformStream', 'Blob', 'File', 'FormData', 'Event', 'EventTarget',
  'AbortSignal', 'WebSocket', 'Worker', 'MessageChannel', 'MessagePort',
  'setImmediate', 'clearImmediate', 'FileReader', 'Image', 'Audio', 'Path2D',
  'WebAssembly', 'FinalizationRegistry', 'WeakRef', 'crypto', 'atob', 'btoa',
]);

/**
 * 不是标识符的常见词。抽符号时用词边界扫，会捎上对象字面量的键、
 * 字符串内容外面那些词，所以先排掉一批明显不是变量的。
 */
const NOT_IDENTIFIERS = new Set([
  'function', 'return', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new',
  'delete', 'typeof', 'instanceof', 'in', 'of', 'void', 'yield', 'await', 'async',
  'class', 'extends', 'super', 'this', 'import', 'export', 'default', 'from', 'as',
  'null', 'true', 'false', 'get', 'set', 'static', 'then', 'catch',
]);

/**
 * 把源码里「所有出现过的标识符」粗提一遍，再逐类减掉定义处。
 * 不是完整的 JS 解析器——这里的目标是**宁严勿松**：只能允许明确
 * 声明过的符号，所以宁可多报几个候选，也不漏掉真问题。
 */
function declaredNames(source: string): Set<string> {
  const names = new Set<string>();

  // const/let/var 声明（含解构粗略处理：把花括号里的词都当声明）
  for (const m of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of source.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const key = part.split(':').pop()?.trim().replace(/=.*$/s, '').trim();
      if (key && /^[A-Za-z_$][\w$]*$/.test(key)) names.add(key);
    }
  }

  // function 声明与函数参数
  for (const m of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    names.add(m[1]);
    for (const arg of m[2].split(',')) {
      const name = arg.trim().replace(/=.*$/s, '').trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  // 箭头函数 / 方法简写的参数
  for (const m of source.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const arg of m[1].split(',')) {
      const name = arg.trim().replace(/=.*$/s, '').trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of source.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);

  // class 名与 class 方法名
  for (const m of source.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);

  // 类方法定义：行首缩进 + 标识符 + `(`。这一条是必需的——类体里的
  // `  stop() {` 与「调用 stop()」在文本上一模一样，不把定义收进来就会
  // 报出一堆假的「没定义」（第一次跑时正是 65 条全是这个）。
  // 方法自己的参数也要收——`on(channel, handler) { ... handler(payload) }`
  // 里 handler 就是参数，不是漏定义。
  for (const m of source.matchAll(
    /(?:^|\n)[ \t]+(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g,
  )) {
    names.add(m[1]);
    for (const arg of m[2].split(',')) {
      const name = arg.trim().replace(/=.*$/s, '').trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // 对象字面量里的方法简写：`  name(args) {` 同上，但键名前面可能是 `,`
  for (const m of source.matchAll(/[,{]\s*(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)) {
    names.add(m[1]);
  }

  // catch (e)
  for (const m of source.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);

  // require('x') 解构进来的名字
  for (const m of source.matchAll(/require\s*\(\s*['"][^'"]+['"]\s*\)/g)) {
    const before = source.slice(Math.max(0, m.index! - 200), m.index!);
    const destructure = before.match(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*$/);
    if (destructure) {
      for (const part of destructure[1].split(',')) {
        const key = part.split(':').pop()?.trim().replace(/=.*$/s, '').trim();
        if (key && /^[A-Za-z_$][\w$]*$/.test(key)) names.add(key);
      }
    }
    const direct = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
    if (direct) names.add(direct[1]);
  }

  return names;
}

/** 把模板字面量的正文里「非 ${} 的文本」换成空串，只留下表达式。 */
function blankTemplateText(body: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const start = body.indexOf('${', i);
    if (start === -1) break;
    out += '${';
    // 找配对的右花括号，够用即可（这套代码里没有嵌套到需要完整解析的）
    let depth = 1;
    let j = start + 2;
    while (j < body.length && depth > 0) {
      if (body[j] === '{') depth += 1;
      else if (body[j] === '}') depth -= 1;
      if (depth === 0) break;
      j += 1;
    }
    out += body.slice(start + 2, j) + '}';
    i = j + 1;
  }
  return out;
}

/** 去掉注释与字符串字面量，避免把散文当成代码来扫。 */
function strip(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i];

    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === quote) break;
        j += 1;
      }
      if (quote === '`') {
        // 模板字面量里只有 `${...}` 是代码，文本部分要抹掉，否则
        // `` `${drive}:\Program Files (x86)\...` `` 会被扫成「调用了 Files()」。
        out += '`' + blankTemplateText(source.slice(i + 1, j)) + '`';
      } else {
        out += '""';
      }
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

test('electron/ 下没有“引用了但没定义”的符号', () => {
  const problems: string[] = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.cjs')) continue;
    const raw = readFileSync(path.join(dir, file), 'utf8');
    const code = strip(raw);
    const declared = declaredNames(code);

    // 只扫「被调用」和「被当作值读取」的标识符：`name(` 与 `=== name` 之类。
    // 属性访问 `obj.name` 前一个字符是 `.`，不算。
    const referenced = new Set<string>();
    for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) referenced.add(m[1]);

    for (const name of referenced) {
      if (GLOBALS.has(name)) continue;
      if (declared.has(name)) continue;
      if (NOT_IDENTIFIERS.has(name)) continue;
      // 保留字开头的 API 方法里常见的 `item(` 之类由上面 declared 覆盖；
      // 走到这里的才是真缺定义。
      problems.push(`${file}: ${name}()`);
    }
  }

  assert.deepEqual(problems, [], `这些符号被调用了但没有定义：\n${problems.join('\n')}`);
});

test('isSubWindow 只有一份实现，两个使用者都 require 它', () => {
  const subs = readFileSync(path.join(dir, 'sub-window.cjs'), 'utf8');
  assert.match(subs, /function isSubWindow/, 'sub-window.cjs 里应当有 isSubWindow 的定义');

  for (const file of ['media.cjs', 'now-playing.cjs']) {
    const src = readFileSync(path.join(dir, file), 'utf8');
    assert.match(
      src,
      /require\(['"]\.\/sub-window\.cjs['"]\)/,
      `${file} 应当从 sub-window.cjs 引入 isSubWindow，而不是自己再写一份`,
    );
    // 也不能在自己文件里重新定义一份——两份判据迟早有一份漏掉 desktop.html
    assert.doesNotMatch(
      src,
      /function isSubWindow/,
      `${file} 不该自己定义 isSubWindow`,
    );
  }
});
