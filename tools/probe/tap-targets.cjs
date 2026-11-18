// 量所有可交互元素的可点面积，找低于 44×44（WCAG 2.5.5 / Apple HIG）的目标。
// 窄屏（440）才是重点：那是给手机/小窗看的，鼠标精度假设不成立。
const { guard, report, launch } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080 });
  const rows = JSON.parse(await probe.run(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      out.push({
        tag: el.tagName,
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
    return JSON.stringify(out);
  })()`));
  const small = rows.filter(r => r.w < 44 || r.h < 44);
  report({
    total: rows.length,
    small: small.length,
    worst: small.sort((a, b) => a.w * a.h - b.w * b.h).slice(0, 25),
  });
});
