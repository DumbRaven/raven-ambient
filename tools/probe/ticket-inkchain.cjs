/**
 * 诊断：票根上的字被冲成浅灰。
 *
 * 已排除：纸色伪元素盖在上面（隐掉 ::before 后字仍浅）、纸纹 filter（关掉无变化）。
 * 已确认：把 .ticket-panel 及其后代的 filter/opacity 强制重置后，字能渲成纯蓝。
 * 所以是祖先链上某个 opacity < 1 或 filter 把整棵子树压淡了。
 *
 * 做法：从 .ticket-name 一路走到 body，逐层打印 opacity / filter / animation /
 *       mix-blend / isolation / transform，找出真正带透明度的那一层。
 *
 * 跑法见 docs/开发文档.md，「探针」一节。
 */
const { launch, report, guard, MEDIA_DIR } = require('./harness.cjs');
const { seedImages } = require('./seed-images.cjs');

guard(async () => {
  const media = seedImages(12);
  const probe = await launch({
    width: 1920, height: 1080, template: 'photo', expand: false, settle: 2400,
    patch: { media, mediaDirs: [MEDIA_DIR] },
  });
  const { run } = probe;

  const chain = await run(`(() => {
    const out = [];
    let el = document.querySelector('.ticket-grid .ticket .ticket-name');
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 60),
        opacity: cs.opacity,
        filter: String(cs.filter).slice(0, 40),
        mix: cs.mixBlendMode,
        isolation: cs.isolation,
        anim: String(cs.animationName).slice(0, 40),
        animFill: cs.animationFillMode,
        transform: String(cs.transform).slice(0, 30),
        color: cs.color,
        textFill: cs.webkitTextFillColor,
      });
      el = el.parentElement;
    }
    return out;
  })()`);

  report(chain);
});
