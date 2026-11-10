/**
 * 量配色面板的三组控件：组名、每组的字段、以及真的改了之后画面上的颜色有没有跟着变。
 *
 * 关键在于**改的是同一份状态**：面板里的输入框只是把值写进 localStorage 与 React state，
 * 真正画图的是 TemplateStage 注入的 --tpl-* 变量。所以这里两头都量：
 *   ① DOM 侧：三组 legend 文案、字段数
 *   ② 渲染侧：注入 custom 值后，面板 / 信息条 / 竖排胶囊 / 署名 的 computed color
 */
const { launch, report, guard, wait, MEDIA_DIR, MEDIA_IMG } = require('./harness.cjs');

/** 一组随手可辨的颜色，改完一眼能看出是不是生效了。 */
const CUSTOM = {
  base: '',            // 留空：这一档不测，它只是垫在最底下
  panel: '#2b1b4d',    // 深紫
  onPanel: '#ffe066',
  bar: '#0f5132',      // 深绿
  onBar: '#d1f7e0',
  gold: '#ff3860',     // 亮玫红，跟原来的金色差别极大
};

const MEASURE = `(() => {
  const groups = [...document.querySelectorAll('.tone-group')].map(node => ({
    legend: node.querySelector('legend')?.textContent?.trim() ?? '',
    labels: [...node.querySelectorAll('.tone-field > span')].map(span => span.textContent?.trim() ?? ''),
  }));
  const pick = selector => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const css = getComputedStyle(node);
    return { color: css.color, background: css.backgroundColor };
  };
  return {
    groups,
    panel: pick('.tpl-block-panel'),
    panelText: pick('.tpl-ambient > b'),
    bar: pick('.tpl-block-bar'),
    barText: pick('.tpl-block-bar .tpl-list > b'),
    badge: pick('.tpl-badge'),
    produced: pick('.tpl-produced'),
    star: pick('.tpl-star'),
    goldVar: getComputedStyle(document.querySelector('.template-collage')).getPropertyValue('--tpl-gold').trim(),
  };
})()`;

guard(async () => {
  const probe = await launch({
    expand: true,
    patch: {
      media: [{ id: 'image:1', kind: 'image', path: MEDIA_IMG, name: 'Ocean', size: 1 }],
      mediaDirs: [MEDIA_DIR],
    },
  });
  await wait(600);

  // 打开配色面板（右上角那个按钮），切到「自己填」
  await probe.run(`(async () => {
    document.querySelector('.theater-tone-toggle')?.click();
    return 1;
  })()`);
  await wait(400);
  const opened = await probe.run(`(() => ({
    menu: !!document.querySelector('.theater-tone-menu'),
    modes: [...document.querySelectorAll('.tone-modes button')].map(b => b.textContent.trim()),
  }))()`);

  // 点「自己填」，再把三组值写进 localStorage 并重载（重载最干净，不用模拟六次输入）
  await probe.run(`(() => {
    const custom = [...document.querySelectorAll('.tone-modes button')].find(b => b.textContent.trim() === '自己填');
    custom?.click();
    return !!custom;
  })()`);
  await wait(300);
  const autoShot = await probe.run(MEASURE);

  const tone = {
    mode: 'custom',
    pick: 1,
    custom: { base: '', panel: CUSTOM.panel, onPanel: CUSTOM.onPanel, bar: CUSTOM.bar, onBar: CUSTOM.onBar, gold: CUSTOM.gold },
  };
  await probe.run(`(() => {
    localStorage.setItem('raven-stage-tone', ${JSON.stringify(JSON.stringify(tone))});
    return 1;
  })()`);
  await probe.win.webContents.reload();
  await wait(2200);
  await probe.run(`(() => {
    [...document.querySelectorAll('.view-tabs > button')].find(b => b.getAttribute('aria-label') === '相集')?.click();
    return 1;
  })()`);
  await wait(1200);
  await probe.run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
  await wait(1400);

  await probe.run(`(() => { document.querySelector('.theater-tone-toggle')?.click(); return 1; })()`);
  await wait(400);
  const customShot = await probe.run(MEASURE);

  report({ opened, autoShot, customShot, expect: CUSTOM });
});
