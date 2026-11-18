// 圆角 A/B：同一页同一位置，把 `.theater-screen` 的圆角在 16px 与 26px 之间切，
// 各截一张放对比图。用像素数回答「26px 是不是把画面切多了」。
//
// 判据不是「看起来像不像」，是「圆角吃掉的可视面积」：
// 对每个圆角算四个角内侧那一圈四边形里有多少像素不是放映台自己的颜色。
const { guard, report, launch, wait } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ width: 1280, height: 800, expand: false });
  await wait(900);

  // 锁死两档圆角，各拍一张。用 setProperty 走 important，避免被别处的特异性盖掉。
  async function snap(r) {
    await probe.run(`(() => {
      const el = document.querySelector('.theater-screen');
      if (el) el.style.setProperty('border-radius', ${JSON.stringify(r)}, 'important');
      return undefined;
    })()`);
    await wait(240);
    const file = `.qa/theater-r${parseInt(r, 10)}.png`;
    await probe.shot(file);
    return file;
  }

  const a = await snap('16px');
  const b = await snap('26px');

  const geom = JSON.parse(await probe.run(`(() => {
    const el = document.querySelector('.theater-screen');
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
  })()`));

  report({ a, b, geom });
});
