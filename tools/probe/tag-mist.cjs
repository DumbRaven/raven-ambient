/**
 * 石纹候选对比：现有的「揉弯条带」vs 参考图那种「灰度云雾」。
 *
 * 用户 m06439：「然后如果像做成我视频里那种感觉有办法吗，我想加一种来让用户选择」。
 * 参考图那块（tools/measure/tag-ref.png，放大 5 倍）实测是**灰度云雾**：
 * 大块柔和的明暗团块、边缘晕开、几乎没有方向性脉络，像浓雾或水下。
 * 和现在的「横向浪脊条带」是两种东西，光靠形容词说不清差多少，
 * 所以这里一次做六个候选，截图拼成一张横条并排比。
 *
 * 只换 `::before` 的 background 与它引用的 filter，别的全部固定：
 * mix-blend-mode、opacity、clip-path、面板底色一个都不动。
 * 一次只变「纹理怎么生成」这一个变量。
 *
 * 全部在页面里注入，**不改源码**——选定了再落到 src/marble.ts。
 *
 * 跑法（改完源码先 npm run build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/tag-mist.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

/** 把灰度按 slope/intercept 拉开对比，中间调压成「亮团 + 暗底」两层。 */
function contrast(slope, intercept) {
  const f = `<feFuncR type="linear" slope="${slope}" intercept="${intercept}"/>` +
    `<feFuncG type="linear" slope="${slope}" intercept="${intercept}"/>` +
    `<feFuncB type="linear" slope="${slope}" intercept="${intercept}"/>` +
    // alpha 也必须钉死。feTurbulence 连 alpha 通道都带噪声，
    // 留着它整块纹理就是半透明的，overlay 上去只剩一层灰雾——第一版全灰就是这个原因。
    '<feFuncA type="linear" slope="0" intercept="1"/>';
  return `<feComponentTransfer in="soft" result="shaped">${f}</feComponentTransfer>`;
}

/**
 * 去饱和。
 *
 * feTurbulence 每个通道独立生成，出来是**彩色**的。第一版忘了这一步，
 * 五个云雾候选全是彩虹色。凡是「用噪声当灰度图」都必须先过这里。
 */
const GRAY = '<feColorMatrix in="cloud" type="saturate" values="0" result="cloud"/>';

/**
 * 候选表。
 *
 * `background` 是 ::before 自己的底：条纹系要给它黑白条带，
 * 云雾系只要一片白（噪声是滤镜自己生成的，不看底图）。
 */
const CANDIDATES = [
  {
    name: 'current',
    note: '现在这版：20deg 黑白条带 + 低频位移揉弯',
    background: `repeating-linear-gradient(20deg,
      #00000000 0px, #00000000 7px, #ffffff 9px, #ffffff 11px,
      #00000000 14px, #00000000 31px, #000000ac 33px, #00000000 38px,
      #ffffffc4 47px, #00000000 52px, #00000052 74px, #00000000 79px)`,
    markup: `<feTurbulence type="fractalNoise" baseFrequency="0.006 0.019" numOctaves="4" seed="23" result="warp"/>
      <feDisplacementMap in="SourceGraphic" in2="warp" scale="46" xChannelSelector="R" yChannelSelector="G" result="bent"/>
      <feGaussianBlur in="bent" stdDeviation="0.9" result="soft"/>
      ${contrast(1.55, -0.28)}
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="grain"/>
      <feColorMatrix in="grain" type="saturate" values="0" result="gray"/>
      <feBlend in="shaped" in2="gray" mode="soft-light"/>`,
  },
  {
    name: 'mist-soft',
    note: '纯云雾：低频 fractalNoise + 大模糊，无方向性',
    background: '#ffffff',
    markup: `<feTurbulence type="fractalNoise" baseFrequency="0.010" numOctaves="3" seed="23" result="cloud"/>
      ${GRAY}
      <feGaussianBlur in="cloud" stdDeviation="3" result="soft"/>
      ${contrast(1.9, -0.45)}`,
  },
  {
    name: 'mist-big',
    note: '更大的团：频率再降一档，团块接近胶囊宽度',
    background: '#ffffff',
    markup: `<feTurbulence type="fractalNoise" baseFrequency="0.005 0.009" numOctaves="2" seed="23" result="cloud"/>
      ${GRAY}
      <feGaussianBlur in="cloud" stdDeviation="4" result="soft"/>
      ${contrast(2.6, -0.78)}`,
  },
  {
    name: 'vein',
    note: '纹理对比：type=turbulence（不是 fractalNoise）会出脉络而不是团块',
    background: '#ffffff',
    markup: `<feTurbulence type="turbulence" baseFrequency="0.009" numOctaves="3" seed="23" result="cloud"/>
      ${GRAY}
      <feGaussianBlur in="cloud" stdDeviation="1.6" result="soft"/>
      ${contrast(4.2, -1.95)}`,
  },
  {
    name: 'mist-warp',
    note: '云雾再被揉一遍：团块被拉成有机的流向',
    background: '#ffffff',
    markup: `<feTurbulence type="fractalNoise" baseFrequency="0.010" numOctaves="3" seed="23" result="cloud"/>
      ${GRAY}
      <feTurbulence type="fractalNoise" baseFrequency="0.004 0.013" numOctaves="2" seed="5" result="warp"/>
      <feDisplacementMap in="cloud" in2="warp" scale="60" xChannelSelector="R" yChannelSelector="G" result="bent"/>
      <feGaussianBlur in="bent" stdDeviation="2.2" result="soft"/>
      ${contrast(2.4, -0.66)}`,
  },
  {
    name: 'cloud-grain',
    note: '云雾 + 极轻颗粒：石面不是完全光滑的',
    background: '#ffffff',
    markup: `<feTurbulence type="fractalNoise" baseFrequency="0.008 0.014" numOctaves="3" seed="23" result="cloud"/>
      ${GRAY}
      <feGaussianBlur in="cloud" stdDeviation="2.4" result="soft"/>
      ${contrast(2.8, -0.84)}
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="1" seed="11" result="grain"/>
      <feColorMatrix in="grain" type="saturate" values="0" result="gray"/>
      <feBlend in="shaped" in2="gray" mode="soft-light"/>`,
  },
];

const AREA = `(() => {
  const r = document.querySelector('.tpl-tag').getBoundingClientRect();
  return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6,
           width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
})()`;

/** 注入第 i 个候选：换 background + 换 filter 引用的那个 id。 */
function apply(index) {
  const c = CANDIDATES[index];
  const id = `tpl-marble-try`;
  // 候选里的 markup 是多行写的（人读着舒服），但它是被塞进**单引号字符串**里
  // 注入页面的——字符串字面量里不许有裸换行，会直接 SyntaxError，
  // 而 executeJavaScript 只会回一句 "Script failed to execute"，
  // 看日志像是在别处出的错。所以先压成一行。
  const markup = c.markup.replace(/\s+/g, ' ').trim();
  // 同上：background 也是多行写的
  const background = c.background.replace(/\s+/g, ' ').trim();
  return `(() => { try {
    const old = document.getElementById('try-filter');
    if (old) old.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'try-filter';
    svg.setAttribute('width', '300');
    svg.setAttribute('height', '300');
    svg.innerHTML = '<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">${markup}</filter>';
    document.body.appendChild(svg);

    let style = document.getElementById('try-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'try-style';
      document.head.appendChild(style);
    }
    style.textContent = \`
      .template-collage .tpl-tag::before {
        background: ${background};
        filter: url(#${id});
      }\`;
    return getComputedStyle(document.querySelector('.tpl-tag'), '::before').filter;
  } catch (e) { return 'ERR ' + e.message; } })()`;
}

/** 把几张同尺寸截图横向拼起来，中间留 8px 白缝。 */
function concat(images, gap = 8) {
  const { nativeImage } = require('electron');
  const width = images.reduce((a, i) => a + i.getSize().width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map(i => i.getSize().height));
  const out = Buffer.alloc(width * height * 4, 255); // BGRA
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

guard(async () => {
  const probe = await launch({ expand: true });
  await wait(500);
  const area = await probe.run(AREA);

  const shots = [];
  const seen = [];
  for (let i = 0; i < CANDIDATES.length; i++) {
    const filter = await probe.run(apply(i));
    await wait(300); // 滤镜重建要一帧以上
    const img = await probe.win.webContents.capturePage(area);
    shots.push(img);
    fs.writeFileSync(path.join(__dirname, `mist-${i}-${CANDIDATES[i].name}.png`), img.toPNG());
    seen.push({ index: i, name: CANDIDATES[i].name, filter });
  }

  const strip = concat(shots);
  const file = path.join(__dirname, 'mist-sweep.png');
  fs.writeFileSync(file, strip.toPNG());

  report({
    // 顺序就是图里从左到右的顺序
    order: CANDIDATES.map((c, i) => `${i}=${c.name}`),
    notes: CANDIDATES.map(c => c.note),
    seen,
    strip: file,
    stripSize: strip.getSize(),
    cell: shots[0].getSize(),
  });
});
