#!/usr/bin/env node
/**
 * 拍 README 用的放映页截图（窗口态，不是全屏）。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/readme-shot.cjs --no-sandbox
 *
 * 为什么不用全屏态：`docs/images/` 里其它七张都是窗口态，README 里并排显示时
 * 只有尺寸一致才不突兀。全屏态那种 16:9 横条放在这一组里会很怪。
 *
 * 前置：`npm.cmd run build`。
 * 产物：docs/images/07-media.png
 */
const path = require('node:path');
const { launch, guard, ROOT } = require('./harness.cjs');

guard(async () => {
  // 1600 宽是为了截图清晰：README 里按 33% 宽度显示，1600 缩下去仍然锐利。
  // 高度按 16:10 给，跟其它截图的比例接近。
  const probe = await launch({ width: 1600, height: 1000, expand: false });

  // 等取色和唱片动画落定。取色要读 canvas，稍慢。
  await new Promise(r => setTimeout(r, 1800));

  const out = path.join(ROOT, 'docs', 'images', '07-media.png');
  await probe.shot(out);
  console.log('SAVED ' + out);
  probe.close();
});
