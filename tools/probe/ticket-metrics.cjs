/**
 * 量票根的排布：把四种版式里每个子元素的真实高度、间距、是否溢出打出来。
 *
 * 目的：票的高度被 aspect-ratio 钉死（1098/526），票面文字必须装得进去。
 * 靠看截图猜字号太慢，这里直接读 layout。
 *
 * 跑法：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   node_modules\electron\dist\electron.exe tools\probe\ticket-metrics.cjs --no-sandbox
 */
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(40);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2600,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run } = probe;

  const out = await run(`(() => {
    const seen = new Map();
    for (const li of document.querySelectorAll('.ticket-grid > li')) {
      const panel = li.querySelector('.ticket-panel');
      const layout = panel?.dataset.layout;
      if (!layout || seen.has(layout)) continue;
      seen.set(layout, li);
    }
    const rows = [];
    for (const [layout, li] of seen) {
      const ticket = li.querySelector('.ticket');
      const panel = li.querySelector('.ticket-panel');
      const shot = li.querySelector('.ticket-shot');
      const tRect = ticket.getBoundingClientRect();
      const pRect = panel.getBoundingClientRect();
      const sRect = shot.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      const kids = [...panel.children].map(node => {
        const r = node.getBoundingClientRect();
        return {
          cls: node.className || node.tagName,
          h: +r.height.toFixed(1),
          w: +r.width.toFixed(1),
          top: +(r.top - pRect.top).toFixed(1),
          font: getComputedStyle(node).fontSize,
        };
      });
      // 内容总高 = 最后一个孩子的底 - 第一个孩子的顶
      const first = kids[0];
      const last = kids[kids.length - 1];
      rows.push({
        layout,
        ticket: { w: +tRect.width.toFixed(1), h: +tRect.height.toFixed(1), ratio: +(tRect.width / tRect.height).toFixed(3) },
        shot: { w: +sRect.width.toFixed(1), h: +sRect.height.toFixed(1), ratio: +(sRect.width / sRect.height).toFixed(3) },
        panel: { w: +pRect.width.toFixed(1), h: +pRect.height.toFixed(1) },
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
        gap: cs.gap,
        contentH: first && last ? +(last.top + last.h - first.top).toFixed(1) : null,
        innerH: +(pRect.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)).toFixed(1),
        overflow: panel.scrollHeight > panel.clientHeight,
        scrollH: panel.scrollHeight,
        clientH: panel.clientHeight,
        kids,
      });
    }
    return rows;
  })()`);

  report({ rows: out });
});
