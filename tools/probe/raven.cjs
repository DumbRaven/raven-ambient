#!/usr/bin/env node
/**
 * 查两色乌鸦：翅膀那条 path 到底有没有渲染、fill 算成了什么。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/raven.cjs --no-sandbox
 */
const { launch, guard } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ expand: true });
  const { run } = probe;

  const out = await run(`(() => {
    const svg = document.querySelector('.tpl-raven');
    if (!svg) return { error: '找不到 .tpl-raven' };
    const paths = [...svg.querySelectorAll('path')].map((p, at) => {
      const s = getComputedStyle(p);
      const r = p.getBoundingClientRect();
      return {
        at,
        cls: p.getAttribute('class'),
        dLen: (p.getAttribute('d') || '').length,
        dHead: (p.getAttribute('d') || '').slice(0, 60),
        dTail: (p.getAttribute('d') || '').slice(-30),
        fill: s.fill,
        fillRule: s.fillRule,
        fillOpacity: s.fillOpacity,
        display: s.display,
        visibility: s.visibility,
        bbox: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        totalLength: typeof p.getTotalLength === 'function' ? Math.round(p.getTotalLength()) : null,
      };
    });
    const svgStyle = getComputedStyle(svg);
    const root = document.querySelector('.template-collage');
    const rootStyle = root ? getComputedStyle(root) : null;
    return {
      svgRect: (() => { const r = svg.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; })(),
      svgColor: svgStyle.color,
      panel: rootStyle && rootStyle.getPropertyValue('--tpl-panel'),
      bar: rootStyle && rootStyle.getPropertyValue('--tpl-bar'),
      paths,
    };
  })()`);

  console.log('RAVEN ' + JSON.stringify(out, null, 1));
  probe.close();
});
