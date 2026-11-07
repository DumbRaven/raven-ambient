/**
 * 放大看全屏时画面底部那一条：版式的信息条 + 控制栏挤在一起。
 *
 * 用户报「控制栏在下层」，但这个说法有两种可能，肉眼分不清：
 *   a. 真的被盖住（层级问题）——chrome-z.cjs 的 elementFromPoint 已排除，不是；
 *   b. 看得见但**读起来像在下面**——控制条原先是贴满屏宽、贴齐底边、
 *      向上淡出的黑渐变，没有轮廓，而版式信息条正好占画面下部 25%，
 *      于是那 62px 读成「信息条上浮了一层脏东西」。
 *
 * 所以这个探针做三件事：
 *   1. 量控制栏与信息条的位置关系（overlap）；
 *   2. 截整条 + 控制栏特写 + 左端特写（轮廓只能靠特写判断）；
 *   3. 把旧样式（贴底通栏渐变）用内联 style 现场套一遍再截一张，
 *      留作改前/改后的对照——只看新图会忘记旧图长什么样。
 *
 * 跑法（改完源码先 build，探针吃的是 dist/）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/chrome-shot.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch, report, guard } = require('./harness.cjs');

const GEOM = `(() => {
  const bar = document.querySelector('.theater-bar');
  const tplBar = document.querySelector('.tpl-block-bar');
  const r = bar.getBoundingClientRect();
  const t = tplBar ? tplBar.getBoundingClientRect() : null;
  return {
    chrome: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    tplBar: t ? [Math.round(t.x), Math.round(t.y), Math.round(t.width), Math.round(t.height)] : null,
    // 两者在竖直方向重叠多少像素：重叠越多，「谁压着谁」就越难看出来
    overlap: t ? Math.round(Math.max(0, t.bottom - r.top)) : 0,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };
})()`;

/** 在页面里临时改控制栏的样式，只看视觉差异，不改源码。返回改之前的快照。 */
const restyle = css => `(() => {
  const bar = document.querySelector('.theater-bar');
  const before = bar.getAttribute('style') || '';
  bar.setAttribute('style', ${JSON.stringify('')} + ${JSON.stringify(css)});
  return before;
})()`;

const restore = before => `(() => {
  const bar = document.querySelector('.theater-bar');
  ${JSON.stringify(before)} ? bar.setAttribute('style', ${JSON.stringify(before)}) : bar.removeAttribute('style');
  return 1;
})()`;

guard(async () => {
  const probe = await launch({ expand: true });
  const geo = await probe.run(GEOM);

  // 胶囊换了底色，条里的每一项都要重新确认还看得见、还排得下。
  // 只量颜色不够——深色底上灰字可能"量得到但看不清"，所以把实测的
  // 计算色一起带出来，人眼对照截图判断。
  const CONTENT = `(() => {
    const bar = document.querySelector('.theater-bar');
    const r = bar.getBoundingClientRect();
    const items = [...bar.querySelectorAll('button, .theater-copy b, .theater-copy small')].map(node => {
      const b = node.getBoundingClientRect();
      const s = getComputedStyle(node);
      return {
        tag: node.tagName.toLowerCase(),
        text: (node.textContent || '').trim().slice(0, 12),
        // 相对胶囊的位置，用来发现"被圆角切掉""溢出到胶囊外"
        box: [Math.round(b.x - r.x), Math.round(b.y - r.y), Math.round(b.width), Math.round(b.height)],
        color: s.color,
        inside: b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1,
      };
    });
    return { bar: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], items };
  })()`;

  const content = await probe.run(CONTENT);

  const shots = {};
  const shoot = async (name, area) => {
    const image = await probe.win.webContents.capturePage(area);
    const out = path.join(__dirname, `chrome-${name}.png`);
    fs.writeFileSync(out, image.toPNG());
    shots[name] = { saved: out, size: image.getSize() };
  };

  // 底部一截：从信息条顶上 40px 到屏幕底
  const tplTop = geo.tplBar ? geo.tplBar[1] : geo.chrome[1] - 200;
  const area = {
    x: 0,
    y: Math.max(0, Math.round(tplTop - 40)),
    width: geo.innerWidth,
    height: geo.innerHeight - Math.max(0, Math.round(tplTop - 40)),
  };

  await shoot('now', area);

  // 控制栏自身特写：判断「有没有轮廓」只能靠这个，整条缩略图看不出来
  await shoot('bar', {
    x: Math.max(0, geo.chrome[0] - 14),
    y: Math.max(0, geo.chrome[1] - 14),
    width: Math.min(geo.innerWidth, geo.chrome[2] + 28),
    height: Math.min(geo.innerHeight - Math.max(0, geo.chrome[1] - 14), geo.chrome[3] + 28),
  });

  // 左端特写：圆角、描边、与信息条的重叠边缘都在这一段，缩到整条宽就看不清了
  await shoot('bar-left', {
    x: Math.max(0, geo.chrome[0] - 12),
    y: Math.max(0, geo.chrome[1] - 30),
    width: 460,
    height: Math.min(geo.innerHeight - Math.max(0, geo.chrome[1] - 30), geo.chrome[3] + 46),
  });

  // 对照：把旧样式（贴底通栏黑渐变）现场套回去再截一张。
  // 内联 style 优先级最高，能压住样式表里的胶囊规则。
  const before = await probe.run(restyle(
    'left: 0; right: 0; bottom: 0; border-radius: 0; padding: 16px 22px;' +
    'background: linear-gradient(to top, #000000d9, #00000000);' +
    'backdrop-filter: none; -webkit-backdrop-filter: none; box-shadow: none;'
  ));
  await new Promise(r => setTimeout(r, 350));
  await shoot('legacy', area);
  await probe.run(restore(before));

  report({ geo, content, shots });
});
