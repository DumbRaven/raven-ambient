// 窄屏（440×860）下的触控目标。离屏窗口改不了尺寸，必须走 CDP Emulation。
const { guard, report, launch } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080 });
  const dbg = probe.win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 440, height: 860, deviceScaleFactor: 1, mobile: false,
  });
  await new Promise(r => setTimeout(r, 600));
  const inner = await probe.run('[innerWidth, innerHeight].join("x")');
  const rows = JSON.parse(await probe.run(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      out.push({
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 34),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
    return JSON.stringify(out);
  })()`));
  const small = rows.filter(r => r.w < 44 || r.h < 44);
  await probe.shot('.qa/tap-narrow.png');
  report({ inner, total: rows.length, small: small.length, worst: small.sort((a, b) => a.w * a.h - b.w * b.h).slice(0, 20) });
});
