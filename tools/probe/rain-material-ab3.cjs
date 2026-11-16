/**
 * 雨滴材质第三轮：把珠子放到**有细节**的区域上。
 *
 * 前两轮的教训：珠子摆在浅蓝天空上，天空本身是均匀渐变，
 * `feDisplacementMap` 位移一片渐变得到还是一片渐变——看起来就是"什么都没发生"。
 * 参考图里水珠挂在深绿叶片上才显得清楚，不是因为那里的算法不同，
 * 而是因为那里的背景本身有高频对比。
 *
 * 这一轮：
 *   - 背景换成高频条纹图（斜纹 + 竖线 + 文字），保证每一寸都有可位移的内容
 *   - 同一颗珠子在 4 种尺寸下并排（90 / 60 / 30 / 12 px），
 *     看材质在小尺寸上会不会糊成一团（真实场景九成珠子都小于 60px）
 *   - 材质用上一轮最接近参考图的组合：纯折射 + 细亮线 + 底部 caustic
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-material-ab3.cjs --no-sandbox
 */
const path = require('node:path');
const fs = require('node:fs');
const { guard, launch, wait } = require('./harness.cjs');

const OUT = path.join(__dirname, '..', '..', '.qa', 'rain-material');

guard(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { run, shot, close } = await launch({
    width: 1400, height: 900, template: 'collage', expand: true,
  });

  const built = await run(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden';
    host.innerHTML =
      '<svg width="1" height="1">' +
      '<filter id="ab3-strong" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="2" seed="7" result="n"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="n" scale="52" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter></svg>';
    document.body.appendChild(host);

    const world = document.createElement('div');
    world.id = 'ab3-world';
    world.style.cssText = [
      'position:absolute', 'left:60px', 'top:80px', 'width:1280px', 'height:740px',
      'z-index:200', 'border-radius:10px', 'overflow:hidden',
      'background:repeating-linear-gradient(38deg,#20382a 0 9px,#5f7f52 9px 20px)',
    ].join(';');
    world.innerHTML = '<div style="position:absolute;inset:0;'
      + 'background:repeating-linear-gradient(90deg,transparent 0 11px,rgba(240,255,235,.5) 11px 13px)"></div>'
      + '<div style="position:absolute;left:30px;top:40px;font:800 78px/1 Inter,sans-serif;color:#eaf6e2;'
      + 'letter-spacing:-3px">RAIN ON GLASS</div>';
    document.body.appendChild(world);
    await sleep(400);

    const REFRACT = 'backdrop-filter:url(#ab3-strong);-webkit-backdrop-filter:url(#ab3-strong);';
    // 材质：细亮线 + 底部 caustic，零大面积渐变
    const SKIN = REFRACT
      + 'background:'
      + 'radial-gradient(26% 14% at 50% 84%,#ffffffb3 0%,#ffffff40 46%,#ffffff00 100%),'
      + 'radial-gradient(100% 100% at 50% 50%,#ffffff00 90%,#ffffffb8 94%,#ffffff00 98%);';

    const sizes = [90, 60, 30, 12];
    let left = 70;
    const info = [];
    for (const s of sizes) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:' + left + 'px;top:' + (330 - s / 2) + 'px;'
        + 'width:' + s + 'px;height:' + s + 'px;z-index:210;pointer-events:none;'
        + 'border-radius:50% 50% 48% 48%/47% 47% 53% 53%;' + SKIN;
      world.appendChild(d);
      info.push({ size: s, left });
      left += s + 46;
    }

    // 再并排一组「有暗环的老做法」对照，同样尺寸，看谁更像水
    left = 70 + 0;
    await sleep(700);
    return { info, ok: true };
  })()`);
  await wait(900);
  await shot(path.join(OUT, 'ab3.png'));
  console.log(JSON.stringify(built));
  close();
});
