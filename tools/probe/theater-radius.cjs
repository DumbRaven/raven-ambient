// 量放映台在「窗口态」与「全屏态」下的实际圆角，以及圆角切掉了多少可视面积。
//
// 为什么单独写一个：`shell-radius.cjs` 用的 `launch()` 默认 `expand: true`，
// 它会把放映台点成全屏，于是量到的 `.theater-screen` 恒为 0px（全屏那条规则）。
// 要看窗口态必须显式传 `expand: false`。
//
// 圆角变大时有两条要一起看：
//   1. `border-radius` 只切掉四个角，不影响布局。
//   2. 但放映页的「不规则形状」是 `mask-image` 里的 SVG path 画的
//      （见 `src/skin/collage.css:615` 与 `:631`），那层 mask 与圆角叠加，
//      左上 / 右下被切得更多。所以这里用像素数把「切掉了多少」量出来。
const { guard, report, launch, wait } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ width: 1280, height: 800, expand: false });

  async function grab() {
    return JSON.parse(await probe.run(`(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, missing: true };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          sel,
          radius: cs.borderRadius,
          mask: cs.maskImage === 'none' ? 'none' : 'svg-path',
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      };
      return JSON.stringify([
        pick('.media-theater'),
        pick('.theater-screen'),
        pick('.template-collage'),
        pick('.tpl-block-media'),
        pick('.tpl-block-bar'),
      ]);
    })()`));
  }

  await wait(900);
  const windowed = await grab();
  const shot = await probe.shot('.qa/theater-radius-windowed.png');

  report({ windowed, shot: shot.length, dist: 'dist/assets' });
});
