/**
 * 看竖排胶囊里的石纹长什么样。
 *
 * 为什么单独一个探针：石纹是很淡的一层，整页截图缩到 1920 宽之后基本看不清，
 * 而这块纹路变没变好只能靠眼睛判断。这里做两件事：
 *   1. 按元素矩形单独截图并放大（capturePage 支持传 rect）；
 *   2. 报出这层的 computed style，确认滤镜真的挂上了。
 *
 * **滤镜失效是个静默失败**：`filter: url(#x)` 找不到目标时 computed 直接变成
 * `none`，页面不报错、也看不出来——只是纹理忽然变成一块平的半透明白。
 * 所以这里必须把 `filter` 与 `backgroundImage` 一起打出来。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/marble.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard } = require('./harness.cjs');

const PROBE = `(() => {
  const tag = document.querySelector('.tpl-tag');
  if (!tag) return { error: 'no .tpl-tag' };
  const r = tag.getBoundingClientRect();
  const style = getComputedStyle(tag, '::before');
  const badge = document.querySelector('.tpl-badge');
  return {
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    beforeFilter: style.filter,
    beforeBackground: style.backgroundImage.slice(0, 120),
    beforeOpacity: style.opacity,
    beforeBlend: style.mixBlendMode,
    tagBackground: getComputedStyle(tag).backgroundColor,
    badgeFontSize: badge ? getComputedStyle(badge).fontSize : null,
    // 滤镜本体是否真的在 DOM 里：宿主 div 是 1px 隐藏的，取它的 svg 子节点
    filterExists: !!document.getElementById('tpl-marble'),
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: true });
  const detail = await probe.run(PROBE);

  // 截图必须在 report() 之前：report 会 app.exit(0)，窗口当场销毁，
  // 之后再 capturePage 就是 "Object has been destroyed"。
  let shot = null;
  if (detail.rect) {
    const [x, y, w, h] = detail.rect;
    // 四周各外扩 6px，把胶囊的圆角边缘也包进来
    const pad = 6;
    const area = {
      x: Math.max(0, x - pad),
      y: Math.max(0, y - pad),
      width: w + pad * 2,
      height: h + pad * 2,
    };
    const image = await probe.win.webContents.capturePage(area);
    const out = path.join(__dirname, 'marble.png');
    fs.writeFileSync(out, image.toPNG());
    shot = { saved: out, size: image.getSize() };
  }

  report({ ...detail, shot });
});
