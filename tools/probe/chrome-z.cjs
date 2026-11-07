/**
 * 量「全屏后底下那条控制栏为什么在下层」。
 *
 * 用户报的现象：全屏之后，画面底部的控制栏看着「在下面」，不像压在最上层。
 *
 * 怀疑点（先量再改，别猜）：
 *   1. 控制栏 `.theater-bar` 的 z-index 比画面里的东西低；
 *   2. 父级 `.media-theater` / `.theater-screen` 建了层叠上下文，控制栏被困在里面；
 *   3. 控制栏的定位与画面同层但它自己 z-index: auto，后面的兄弟盖住它。
 *
 * 这个探针把「谁在上面」用 elementFromPoint 直接问出来：在控制栏中心点、
 * 以及它几个按钮的中心点上，问浏览器「这里最上层是谁」。如果答案不是控制栏
 * 自己的子树，就是被盖住了——比读 z-index 可靠，因为层叠上下文会骗人。
 *
 * 跑法（改完源码先 build）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/chrome-z.cjs --no-sandbox
 */
const path = require('node:path');
const { launch, report, guard } = require('./harness.cjs');

const PROBE = `(() => {
  const bar = document.querySelector('.theater-bar');
  if (!bar) return { error: 'no .theater-bar（可能还停在网格页）' };

  const room = document.querySelector('.media-room');
  const theater = document.querySelector('.media-theater');
  const screen = document.querySelector('.theater-screen');

  const desc = node => {
    if (!node) return null;
    const cls = typeof node.className === 'string' ? node.className : '';
    const tag = node.tagName.toLowerCase();
    return (tag + (cls ? '.' + cls.trim().split(/\\s+/).join('.') : '')).slice(0, 90);
  };

  const zOf = node => {
    if (!node) return null;
    const s = getComputedStyle(node);
    return {
      zIndex: s.zIndex,
      position: s.position,
      transform: s.transform === 'none' ? 'none' : s.transform.slice(0, 24),
      filter: s.filter === 'none' ? 'none' : 'none?',
      opacity: s.opacity,
      isolation: s.isolation,
      willChange: s.willChange,
      contain: s.contain,
    };
  };

  const r = bar.getBoundingClientRect();
  // 「谁在上面」必须在**整个控制条高度**上问，不能只问中线。
  //
  // 踩过一次：控制条原来是 bottom:0、高 62，中线 y=1049，而版式信息条的底边在
  // y=1042——中线整个落在信息条下方，五个点全部命中控制条自己，于是得出
  // 「不是层级问题」的错误结论。控制条改成离底的胶囊之后重叠 32px，
  // 上半段其实一直被信息条盖着，是采样点选错了地方才没量出来。
  const bands = [0.12, 0.5, 0.88].map(f => Math.round(r.top + r.height * f));
  const hits = [0.06, 0.3, 0.5, 0.7, 0.94].flatMap(f =>
    bands.map(y => {
      const x = Math.round(r.left + r.width * f);
      const el = document.elementFromPoint(x, y);
      return {
        at: [+f.toFixed(2), x, y],
        top: desc(el),
        inBar: !!(el && bar.contains(el)),
      };
    })
  );
  // 只要有一个采样点不是控制条自己的子树，就是被盖住了
  const covered = hits.filter(h => !h.inBar);

  // 面板与信息条是同一条 CSS 里的兄弟，它们的层叠关系一起报出来做对照。
  const stack = ['.media-room', '.media-theater', '.theater-screen', '.theater-bar', '.tpl-block-bar']
    .map(sel => {
      const el = document.querySelector(sel);
      return { sel, z: zOf(el) };
    });

  return {
    barRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    barOpacity: getComputedStyle(bar).opacity,
    hits,
    // 被盖住的采样点：非空就说明控制条有部分没画在最上层
    covered: covered.map(h => ({ at: h.at, top: h.top })),
    stack,
    roomClass: room ? room.className : null,
    theaterKind: theater ? theater.getAttribute('data-kind') : null,
    screenHasVideo: !!(screen && screen.querySelector('video')),
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: true });
  const detail = await probe.run(PROBE);
  await probe.shot(path.join(__dirname, 'chrome-z.png'));
  report(detail);
});
