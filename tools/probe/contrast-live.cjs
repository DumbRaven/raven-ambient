/**
 * 直接问浏览器：哪些文字**实际**不够清楚。
 *
 * 为什么不靠读 CSS 推理：同一个 var(--bold-faint) 既用在白卡片上，也用在
 * 深色放映菜单里。逐处改色之前得知道它到底压在哪层底上——推理会漏掉
 * 半透明叠加，而这套界面到处是 rgba 叠层。
 *
 * 做法：逐个元素读 computed color，向上找到第一个不透明的背景色，
 * 算出真实对比度。只有真的有文字可读的元素才算（空元素、纯图形另计）。
 *
 * 阈值：正文 4.5:1（WCAG AA），大字号（>=18.66px 且 bold，或 >=24px）3:1。
 */
const path = require('path');
const DATA = path.join(__dirname, '..', '..', '.qa', 'contrast');

const AUDIT = String.raw`(() => {
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(v => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bot) => ({
    r: top.r * top.a + bot.r * (1 - top.a),
    g: top.g * top.a + bot.g * (1 - top.a),
    b: top.b * top.a + bot.b * (1 - top.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const label = (el) => {
    const cls = [...el.classList].slice(0, 3).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const ownText = (el) => [...el.childNodes]
    .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
    .slice(0, 22);
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const text = ownText(el);
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (cs.opacity === '0') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const zoom = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const px = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    if (r + 0.01 < need) {
      out.push({
        el: label(el), text, px: Math.round(px * 10) / 10, weight,
        color: 'rgb(' + [fg.r, fg.g, fg.b].map(Math.round).join(',') + ')',
        bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')',
        ratio: Math.round(r * 100) / 100, need,
      });
    }
  }
  return out;
})()`;

module.exports = { AUDIT, DATA };
