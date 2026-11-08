/**
 * 扫一遍大理石条纹的角度，看哪个方向最像「海浪」。
 *
 * 用户 m06345：「这个胶囊虽然不是大理石样式，但是我觉得很好看，
 * 有点那种海浪的感觉」。现在条纹是 108deg，接近竖直、略带倾斜，
 * 纹路是从上往下斜着走的。海浪是层层叠叠的横向浪脊，
 * 所以想试试把条纹压向水平（角度接近 0deg）会不会更"浪"。
 *
 * 只扫角度、不动别的：滤镜管线、黑白配色、overlay、透明度全部固定。
 * 一次只变一个变量，才分得清是哪个因素在起作用。
 *
 * 页面里注入一条同样选择器的 style 覆盖 background（同特异性后写的赢），
 * 不改源码。扫完把每张截图的 tag 区域裁出来拼成一张横条，
 * 一眼就能比出方向。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-sweep.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

// 条纹的色带本身不变，只换渐变线方向
const BANDS = `#00000000 0px, #00000000 7px, #ffffff 9px, #ffffff 11px,
  #00000000 14px, #00000000 31px, #000000ac 33px, #00000000 38px,
  #ffffffc4 47px, #00000000 52px, #00000052 74px, #00000000 79px`;

const ANGLES = [0, 20, 40, 60, 80, 108, 130, 160];

function setAngle(deg) {
  // 同选择器、同特异性，插在文档末尾所以后写赢
  return `(() => {
    let style = document.getElementById('sweep-angle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'sweep-angle';
      document.head.appendChild(style);
    }
    style.textContent = \`
      .template-collage .tpl-tag::before {
        background: repeating-linear-gradient(${deg}deg, ${BANDS});
      }\`;
    return getComputedStyle(document.querySelector('.tpl-tag'), '::before').backgroundImage.slice(0, 60);
  })()`;
}

/** 把几张同尺寸截图横向拼起来，中间留 8px 白缝。 */
function concat(images, gap = 8) {
  const { nativeImage } = require('electron');
  const width = images.reduce((a, i) => a + i.getSize().width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map(i => i.getSize().height));
  const out = Buffer.alloc(width * height * 4, 255); // BGRA，填白
  let x = 0;
  for (const img of images) {
    const { width: w, height: h } = img.getSize();
    const src = img.toBitmap();
    for (let row = 0; row < h; row++) {
      src.copy(out, ((row * width) + x) * 4, row * w * 4, (row + 1) * w * 4);
    }
    x += w + gap;
  }
  return nativeImage.createFromBitmap(out, { width, height });
}

const AREA = `(() => {
  const r = document.querySelector('.tpl-tag').getBoundingClientRect();
  return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6,
           width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
})()`;

guard(async () => {
  const probe = await launch({ expand: true });
  await wait(500);
  const area = await probe.run(AREA);

  const shots = [];
  const seen = [];
  for (const deg of ANGLES) {
    const bg = await probe.run(setAngle(deg));
    await wait(240); // 等一帧渲染
    const img = await probe.win.webContents.capturePage(area);
    shots.push(img);
    seen.push({ deg, bg });
    fs.writeFileSync(path.join(__dirname, `tag-${deg}.png`), img.toPNG());
  }

  const strip = concat(shots);
  const file = path.join(__dirname, 'tag-sweep.png');
  fs.writeFileSync(file, strip.toPNG());

  report({
    angles: ANGLES,
    // 确认每张图确实换过 background（第 60 个字符前能看到角度不同）
    seen,
    strip: file,
    stripSize: strip.getSize(),
    // 单张的尺寸，方便对着看是第几张
    cell: shots[0].getSize(),
  });
});
