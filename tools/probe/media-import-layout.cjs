/**
 * 探针：页尾添加区里两个入口的几何分布。
 *
 * 为什么要量中心而不是只看截图：flex:1 的主按钮会把文字居中到「自己那块」，
 * 而它那块和整条虚线框并不是同一个中心——整条看着就偏了。
 * 这里把每个盒子的 left/width/中心都打出来，偏多少一目了然。
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, guard, wait, report } = require('./harness.cjs');

const READ = `(() => {
  const strip = document.querySelector('.media-import');
  if (!strip) return { error: 'no-strip' };
  const box = el => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      left: Math.round(b.left * 10) / 10,
      width: Math.round(b.width * 10) / 10,
      center: Math.round((b.left + b.width / 2) * 10) / 10,
    };
  };
  const stripBox = strip.getBoundingClientRect();
  const stripCenter = Math.round((stripBox.left + stripBox.width / 2) * 10) / 10;
  const main = strip.querySelector('.media-import-main');
  const alt = strip.querySelector('.media-import-alt');
  // flex 到底怎么分的：basis / grow / shrink / min-width 全打出来，
  // 只量宽度的话，两边差 28px 时看不出是 padding 还是 min-width 干的。
  const flexOf = el => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      // 这里不能用模板字符串：READ 本身就是一个模板字符串，
      // 内层的插值会被外层提前求值（上一版就是这么炸的，连注释里写出来都会炸）。
      flex: s.flexGrow + ' ' + s.flexShrink + ' ' + s.flexBasis,
      minWidth: s.minWidth,
      boxSizing: s.boxSizing,
      padding: s.padding,
    };
  };
  const mainText = main ? main.getBoundingClientRect() : null;
  const altText = alt ? alt.getBoundingClientRect() : null;
  return {
    viewport: { width: window.innerWidth },
    strip: { ...box(strip), center: stripCenter },
    add: box(strip.querySelector('.media-add')),
    main: box(main),
    alt: box(alt),
    // 文字本身的中心：按钮再居中，按钮盒子比字宽时，眼睛看的是字。
    mainLabelCenter: mainText ? Math.round((mainText.left + mainText.width / 2) * 10) / 10 : null,
    altLabelCenter: altText ? Math.round((altText.left + altText.width / 2) * 10) / 10 : null,
    offsetFromStripCenter: {
      strip: 0,
      add: Math.round((box(strip.querySelector('.media-add')).center - stripCenter) * 10) / 10,
      main: Math.round((box(main).center - stripCenter) * 10) / 10,
      alt: Math.round((box(alt).center - stripCenter) * 10) / 10,
    },
    flex: {
      add: flexOf(strip.querySelector('.media-add')),
      main: flexOf(main),
      alt: flexOf(alt),
    },
    /**
     * 真正要看的对称量：两个按钮「内边»（去掉左右 padding 后的可用区）
     * 的中心，与整条中心的偏差应当互为相反数、且绝对值相等。
     * 只比按钮盒子不够——padding 不一样时盒子等宽、字也不在一条视线上下。
     */
    symmetry: (() => {
      const usableCenter = el => {
        const b = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const padL = parseFloat(s.paddingLeft);
        const padR = parseFloat(s.paddingRight);
        return Math.round(((b.left + padL) + (b.right - padR)) / 2 * 10) / 10;
      };
      if (!main || !alt) return null;
      return {
        mainUsable: usableCenter(main) - stripCenter,
        altUsable: usableCenter(alt) - stripCenter,
      };
    })(),
  };
})()`;

guard(async () => {
  const probe = await launch({ width: 1440, height: 900, expand: false, settle: 2600 });
  const { run } = probe;

  const out = {};
  out.layout = await run(READ);

  await run(`(() => {
    const strip = document.querySelector('.media-import');
    if (strip) strip.scrollIntoView({ block: 'end' });
    return 1;
  })()`);
  await wait(300);

  const png = (await probe.win.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(__dirname, 'media-import-layout.png'), png);
  out.shot = 'tools/probe/media-import-layout.png';

  report(out);
});
