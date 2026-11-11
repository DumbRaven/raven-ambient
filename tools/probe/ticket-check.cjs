/**
 * 核对：真实构建里 `.ticket.is-current` 到底拿到了什么 transform / box-shadow，
 * 以及为什么列表首张的字还是浅的（128，普通卡 65，浮层 54）。
 *
 * 上一轮 ticket-stable.cjs 用注入 CSS（带 !important）时读数正常（56~59），
 * 写回源码后仍是 128，说明注入版与源码版有差别。这里把两者的计算值都打出来。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const { launch, report, guard, wait, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2200,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run } = probe;

  const before = await run(`(async () => {
    const card = document.querySelector('.ticket-grid .ticket');
    card.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -70);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const cs = getComputedStyle(card);
    const panel = card.querySelector('.ticket-panel');
    const pcs = getComputedStyle(panel);
    const name = card.querySelector('.ticket-name').getBoundingClientRect();
    return {
      cls: card.className,
      transform: cs.transform,
      boxShadow: cs.boxShadow,
      transition: cs.transition,
      border: cs.borderRadius,
      panelMask: pcs.maskImage.slice(0, 80),
      panelPosition: pcs.position,
      name: { x: Math.round(name.x), y: Math.round(name.y), w: Math.round(name.width), h: Math.round(name.height) },
    };
  })()`);

  await run(`(() => {
    document.getElementById('probe-chk')?.remove();
    const s = document.createElement('style');
    s.id = 'probe-chk';
    s.textContent = '.ticket.is-current { transform: translate3d(0, -3px, 0) !important; }';
    document.head.appendChild(s);
    return 1;
  })()`);
  await wait(300);

  const after = await run(`(async () => {
    const card = document.querySelector('.ticket-grid .ticket');
    const cs = getComputedStyle(card);
    return { transform: cs.transform, boxShadow: cs.boxShadow };
  })()`);

  report({ before, after });
});
