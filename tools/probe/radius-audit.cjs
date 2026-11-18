// 量放映页内部各块的**实际计算圆角**，找出「几乎直角」的到底是哪几块。
// 两档都量：窗口态（默认）与全屏态（.theater-expand 之后）。
const { guard, report, launch } = require('./harness.cjs');

const PICK = `(() => {
  const sels = [
    '.theater-screen', '.template-collage', '.tpl-block',
    '.tpl-block-media', '.tpl-block-bar', '.tpl-block-panel',
    '.tpl-badge', '.tpl-tag', '.tpl-photo', '.tpl-frame',
    '.ticket', '.ticket-panel', '.ticket-lift-panel',
    '.theater-tools', '.theater-copy',
  ];
  const out = [];
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      out.push({
        sel,
        w: Math.round(r.width), h: Math.round(r.height),
        radius: getComputedStyle(el).borderRadius,
        overflow: getComputedStyle(el).overflow,
      });
      break; // 每类只取第一个，够判断了
    }
  }
  return JSON.stringify(out);
})()`;

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080 });
  // launch 默认已经点过 .theater-expand（expand=true），所以先是全屏态
  const expanded = JSON.parse(await probe.run(PICK));

  // 退出全屏看窗口态
  await probe.run(`(async () => {
    const btn = document.querySelector('.theater-expand');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 700));
  })()`);
  const windowed = JSON.parse(await probe.run(PICK));

  report({ expanded, windowed });
});
