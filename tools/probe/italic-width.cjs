#!/usr/bin/env node
/**
 * 判断 font-style: italic 到底是「真斜体」还是「死声明」。
 *
 * 原理：Canvas 的 measureText 会真实走字体回退链。同一个字符串在
 * italic 与 normal 下量出的宽度如果**完全一致**，说明字体里没有 italic
 * face 参与排版——要么浏览器合成（本项目 `font-synthesis: none` 关掉了合成，
 * 见 src/styles.css:1 的 :root），要么这条声明压根没产生任何字形差异。
 *
 * 对照组必须带上：Playfair Display 已装在用户级字体目录
 * （~/AppData/Local/Microsoft/Windows/Fonts/PlayfairDisplay-Italic-VariableFont_wght.ttf），
 * 它是**预期会变宽**的那一组。若对照组也不变宽，说明测量方法本身有问题，
 * 不能据此下结论。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/italic-width.cjs --no-sandbox
 */
const { launch, guard } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ expand: true });
  const { run } = probe;

  const out = await run(`(() => {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');

    // 量一组字符串在指定 font 简写下的宽度
    const widths = (font) => {
      ctx.font = font;
      return {
        Ocean: +ctx.measureText('Ocean').width.toFixed(3),
        DUMBRAVEN: +ctx.measureText('DUMBRAVEN').width.toFixed(3),
        // 中文：Noto Serif SC 里没有 italic face，应该完全不宽
        cjk: +ctx.measureText('播放未收藏').width.toFixed(3),
      };
    };

    // 拿实际计算出来的 family 栈（浏览器会按顺序回退，和 CSS 一致）
    const fieldsSpan = document.querySelector('.tpl-fields > div > span');
    const badge = document.querySelector('.tpl-badge');
    const fieldsFamily = fieldsSpan ? getComputedStyle(fieldsSpan).fontFamily : '';
    const badgeFamily = badge ? getComputedStyle(badge).fontFamily : '';

    const result = {};
    const STACKS = [
      ['badge/Playfair', badgeFamily, 700, 58],
      ['fields/Noto Serif SC', fieldsFamily, 600, 13],
      ['control/Georgia', 'Georgia, serif', 700, 40],
    ];

    for (const [label, family, weight, size] of STACKS) {
      result[label] = {
        family,
        normal: widths(\`normal \${weight} \${size}px \${family}\`),
        italic: widths(\`italic \${weight} \${size}px \${family}\`),
      };
      // 差值为 0 就是「这条 italic 没有产生任何字形差异」
      const n = result[label].normal, it = result[label].italic;
      result[label].delta = {
        Ocean: +(it.Ocean - n.Ocean).toFixed(3),
        DUMBRAVEN: +(it.DUMBRAVEN - n.DUMBRAVEN).toFixed(3),
        cjk: +(it.cjk - n.cjk).toFixed(3),
      };
    }

    // 附带：font-synthesis 是否真的关着
    const rootStyle = getComputedStyle(document.documentElement);
    result.rootFontSynthesis = rootStyle.fontSynthesis;

    return result;
  })()`);

  console.log('ITALIC-WIDTH ' + JSON.stringify(out, null, 1));
  probe.close();
});
