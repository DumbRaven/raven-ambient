/**
 * 计算样式快照：把每个元素、每个 CSS 属性的最终取值导出来做逐项比对。
 *
 * 为什么需要它，而不只看截图：
 *   22 张基线截图只覆盖 680×980 / 440×860 视口里**可见**的那部分。折叠起来的
 *   抽屉、`:hover` / `:focus-visible` 独占的规则、视口外滚不到的元素、
 *   `@media (max-height: 700px)` 分支、全屏态……全都拍不到。重构一个 8414 行的
 *   样式文件时，漏掉的那一半才是真正危险的地方——它们不会让图变红，只会在
 *   用户点到时才崩。
 *
 *   计算样式快照拿的是每个元素每个属性最终算出来的值，能覆盖到上述全部盲区，
 *   而且比像素比对精确：像素只能看出「差了 1 个色阶」，快照直接指出
 *   `box-shadow: 0 1px 2px #0000000d → none`。
 *
 * 用法：
 *   const snap = await probe.styleSnapshot();
 *   → { count, byHash }  —— byHash 是「元素签名 → 属性表」的映射
 *
 * 比对由 tools/probe/style-diff.mjs 负责（纯 node，不需要 Electron）。
 *
 * 元素签名怎么定（这是整套东西的关键）：
 *   不能用 DOM 顺序做 key——重构会动结构，顺序一变全错位。所以用
 *   `标签名 + 自身类名(排序) + 角色属性`。同一签名出现多次时按出现顺序编号，
 *   编号放在签名末尾（`div.record-card#0`、`div.record-card#1`）。
 *   这样「同一个元素」在重构前后能对上，而整体结构挪动不影响。
 */

/** 注入页面里执行：导出全量计算样式。 */
const STYLE_SNAPSHOT = `(() => {
  // 这些属性不参与比对：它们要么本身是随机/时间相关的，要么是浏览器内部实现细节。
  // 宁可少比几个，也不能让工具自己制造噪声——一个有噪声的门禁等于没有门禁。
  const SKIP = new Set([
    'animation-play-state',   // 由 :hover / 播放态决定，但值本身在两态之间来回切
    'transition-duration',    // 同上，且与具体规则绑定
    'transition-delay',
    'transition-property',
    'transition-timing-function',
    'animation-composition',
    'z-index',                // 堆叠上下文内部实现，重构时允许变化（只要最终视觉对）
  ]);
  // 伪元素也必须比：这个项目里大量视觉来自 ::before / ::after
  // （唱片盒的微光、封面上的轨道、票根的虚线……），漏掉等于漏掉半个界面。
  const PSEUDOS = [null, '::before', '::after'];

  function signatureOf(el, indexMap) {
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute('class') || '')
      .split(/\\s+/)
      .filter(Boolean)
      // 状态类单独拎出来进签名：带 selected 的卡片和不带的，是两种元素，
      // 属性当然不同，不能混在一个桶里比。
      .sort();
    let role = '';
    if (el.getAttribute('role')) role += '[role=' + el.getAttribute('role') + ']';
    if (el.getAttribute('aria-label')) role += '[label=' + el.getAttribute('aria-label') + ']';
    if (el.getAttribute('aria-pressed')) role += '[pressed=' + el.getAttribute('aria-pressed') + ']';
    const base = tag + (cls.length ? '.' + cls.join('.') : '') + role;
    const n = indexMap.get(base) || 0;
    indexMap.set(base, n + 1);
    return base + '#' + n;
  }

  const indexMap = new Map();
  const byHash = {};
  const els = document.querySelectorAll('*');
  let count = 0;

  for (const el of els) {
    const hash = signatureOf(el, indexMap);
    const entry = {};

    for (const pseudo of PSEUDOS) {
      const cs = getComputedStyle(el, pseudo);
      if (!cs) continue;
      // 伪元素没有内容时，computed style 会返回一大片默认值。这类空伪元素
      // 在不同版本间容易自己变，直接跳过，只比「有实际渲染」的。
      if (pseudo && getComputedStyle(el, pseudo).content === 'none') continue;

      const props = {};
      for (let i = 0; i < cs.length; i++) {
        const name = cs[i];
        if (SKIP.has(name)) continue;
        // 自定义属性（--x）跳过，理由见 SKIP 的说明：
        // 它们会继承到每一个后代元素，改一个令牌会让整棵树几百个元素全部报差异，
        // 而其中绝大多数元素根本不消费它。
        // 不比的代价是零：var() 在实际属性里已经被解析成终值，
        // 真正用到这个令牌的元素仍然会因为 background-color / color 变了而被抓到。
        if (name.startsWith('--')) continue;
        props[name] = cs.getPropertyValue(name);
      }
      entry[pseudo || 'self'] = props;
      count++;
    }

    byHash[hash] = entry;
  }

  return { count, byHash };
})()`;

/**
 * 把快照压成可入库的文本：每行一个「元素签名 :: 伪元素 :: 属性: 值」。
 *
 * 为什么要压平：JSON 会写出几百万行带缩进的东西，git diff 完全没法读。
 * 压平之后一行一个属性，改动一眼就能看出来，而且天然排好序——
 * 排序是为了让比对不受导出顺序影响。
 */
function flatten(snapshot) {
  const lines = [];
  for (const hash of Object.keys(snapshot.byHash).sort()) {
    const entry = snapshot.byHash[hash];
    for (const pseudo of Object.keys(entry).sort()) {
      const props = entry[pseudo];
      for (const name of Object.keys(props).sort()) {
        lines.push(`${hash} | ${pseudo} | ${name}: ${props[name]}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = { STYLE_SNAPSHOT, flatten };
