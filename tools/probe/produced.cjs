#!/usr/bin/env node
/**
 * 量右下角署名 `Produced By / DumbRaven` 的 DOM 几何与样式。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/produced.cjs --no-sandbox
 *
 * 参考图实测（画布百分比，1917×1072）：
 *   胶囊 87.43 / 82.46，宽 11.94%，高 9.33%
 *   第一行金字 y 84.51..86.57  第二行 y 87.78..89.83（两行**一样大**）
 *   金字核心色 #d4a040
 *
 * 两个已验证的坑：
 *   1. **唱片阴影会盖住署名**。`.tpl-disc` 的 z-index 是 6，署名原来只有 3，
 *      唱片外阴影 `0 2.2cqw 5cqw #00000052` 半径 5cqw，正好铺到署名的上半行，
 *      把金字压成灰褐色。署名必须 z-index 7。
 *   2. **不要给 `<b>` 加 display:block**。源码里第一行后面已有 `<br />`，
 *      再加上 block 会多出一个空行盒，行距从 1.84cqw 撑到 2.7cqw。
 */
const { launch, guard, CQW_PROBE } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ expand: true });
  const { run } = probe;

  const cqw = await run(CQW_PROBE);

  const data = await run(`(() => {
    const C = document.querySelector('.template-collage');
    if (!C) return { error: 'no collage' };
    const cb = C.getBoundingClientRect();
    const pct = r => ({
      x: +((r.x - cb.x) / cb.width * 100).toFixed(2),
      y: +((r.y - cb.y) / cb.height * 100).toFixed(2),
      w: +(r.width / cb.width * 100).toFixed(2),
      h: +(r.height / cb.height * 100).toFixed(2),
    });

    const p = document.querySelector('.tpl-produced');
    if (!p) return { error: 'no produced' };
    const cs = getComputedStyle(p);
    const b = p.querySelector('b');

    return {
      rect: pct(p.getBoundingClientRect()),
      style: {
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        color: cs.color,
        textAlign: cs.textAlign,
        padding: cs.padding,
        borderRadius: cs.borderRadius,
        background: cs.backgroundColor,
        zIndex: cs.zIndex,
        whiteSpace: cs.whiteSpace,
      },
      // 源码结构是 Produced By + <br /> + <b>DumbRaven</b>。
      // 注意：这段代码在模板字符串里，注释里不能再出现反引号，会把字符串截断。
      html: p.innerHTML,
      bStyle: b ? {
        fontSize: getComputedStyle(b).fontSize,
        display: getComputedStyle(b).display,
        fontWeight: getComputedStyle(b).fontWeight,
      } : null,
      // 量一下两行基线距离：把 <br> 换成 span 太脏，改用 Range 取两行矩形。
      lines: (() => {
        const r = document.createRange();
        const out = [];
        const walk = (node) => {
          if (node.nodeType === 3) {
            r.selectNodeContents(node);
            for (const rect of r.getClientRects()) {
              out.push({ text: node.textContent.trim().slice(0, 20), ...pct(rect) });
            }
          } else if (node.nodeType === 1) {
            [...node.childNodes].forEach(walk);
          }
        };
        [...p.childNodes].forEach(walk);
        return out;
      })(),
      discZ: getComputedStyle(document.querySelector('.tpl-disc')).zIndex,
      discShadow: getComputedStyle(document.querySelector('.tpl-disc')).boxShadow,
    };
  })()`);

  console.log(JSON.stringify({ cqw, ...data }, null, 1));
  probe.close();
});
