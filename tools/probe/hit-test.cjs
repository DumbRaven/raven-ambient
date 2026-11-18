const { guard, report, launch } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080 });
  await probe.run(`(async () => {
    const hit = document.elementFromPoint(1270, 382);
    if (!hit) return 'null';
    return [hit.tagName, hit.className, hit.textContent.slice(0,20), getComputedStyle(hit).fontSize, getComputedStyle(hit).color].join(' | ');
  })();`);
  const out = await probe.run(`(async () => {
    const hit = document.elementFromPoint(1270, 382);
    if (!hit) return 'null';
    const path = [];
    let n = hit;
    for (let i = 0; i < 6 && n; i++) { path.push(n.tagName + '.' + (typeof n.className === 'string' ? n.className : '')); n = n.parentElement; }
    return JSON.stringify({
      tag: hit.tagName,
      cls: hit.className,
      text: hit.textContent.slice(0, 20),
      fs: getComputedStyle(hit).fontSize,
      color: getComputedStyle(hit).color,
      rect: hit.getBoundingClientRect().toJSON(),
      path,
    }, null, 1);
  })();`);
  report({ hit: out });
});
