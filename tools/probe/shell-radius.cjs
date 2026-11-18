// 量「外壳」各主容器的实际圆角，跟放映页的 16px 比。
const { guard, report, launch } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ width: 1920, height: 1080 });
  async function grab(page, sels) {
    return JSON.parse(await probe.run(`(() => {
      const sels = ${JSON.stringify(sels)};
      const out = [];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) { out.push({ sel, missing: true }); continue; }
        const r = el.getBoundingClientRect();
        if (r.width < 8) { out.push({ sel, hidden: true }); continue; }
        out.push({ sel, radius: getComputedStyle(el).borderRadius, w: Math.round(r.width), h: Math.round(r.height) });
      }
      return JSON.stringify(out);
    })()`));
  }
  function go(label) {
    return probe.run(`(async () => {
      const b = [...document.querySelectorAll('.view-tabs > button')].find(x => (x.getAttribute('aria-label')||'').includes(${JSON.stringify(label)}));
      if (b) b.click();
      await new Promise(r => setTimeout(r, 500));
    })()`);
  }

  const out = {};
  await go('唱片柜');
  out.cabinet = await grab('唱片柜', ['.cabinet', '.record-card', '.select-record', '.notes-select', '.search input']);
  await go('正在听');
  out.listening = await grab('正在听', ['.turntable', '.music-queue li', '.ambient-chips button', '.dock-disc']);
  await go('专注');
  out.focus = await grab('专注', ['.focus-dial', '.focus-notes', '.primary-button', '.icon-button']);
  await go('相集');
  out.media = await grab('相集', ['.theater-screen', '.template-collage', '.tpl-block', '.icon-button', '.theater-tools']);
  report(out);
});
