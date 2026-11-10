// 非全屏时，画面块到底在哪儿。
//
// 用户 m14515 第 2 条：「如果软件不全屏的话，就按初始打开尺寸，这个视频
// 放到放映机的动画位置是错的，然后这个放到放映机对应位置应该每个模式它
// 位置也不一样啊，你得按每个模式单独做」。
//
// 现在 `burn()` 里用的是 `.theater-screen` 的矩形，但那只是「屏幕那块黑底」，
// 不是「画面实际显示的地方」：
//   拼贴 → 画面在 `.tpl-block-media`（只占左边 63% 宽、65.6% 高）
//   相集 → 画面在 `.tpl-photo-media`（inset:0 铺满，但 cover 会裁）
//   透明 → 压根没有画面块
// 这个探针把三种版式的四个矩形都打出来，用来定「to」该取哪个。
const path = require('node:path');
const { launch, report, guard, wait } = require('./harness.cjs');

const PICK = name => `
  (() => {
    const button = [...document.querySelectorAll('.theater-templates > button')]
      .find(node => node.textContent.trim() === ${JSON.stringify(name)});
    if (!button) return 'missing';
    button.click();
    return 'clicked';
  })()
`;

const READ = `
  (() => {
    const box = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const pick = selector => document.querySelector(selector);
    const media = pick('.theater-screen .tpl-media');
    const screen = pick('.theater-screen');
    return {
      win: { w: innerWidth, h: innerHeight },
      theater: box(pick('.media-theater')),
      screen: box(screen),
      screenRadius: screen ? getComputedStyle(screen).borderRadius : null,
      template: box(pick('.theater-screen > .template')),
      templateClass: pick('.theater-screen > .template')?.className ?? null,
      block: box(pick('.tpl-block-media')),
      photo: box(pick('.tpl-photo-media')),
      media: box(media),
      mediaFit: media ? getComputedStyle(media).objectFit : null,
    };
  })()
`;

guard(async () => {
  const probe = await launch({ width: 1280, height: 900, template: 'collage', expand: false, settle: 1200 });
  const out = {};
  for (const [label, name] of [['collage', '拼贴'], ['photo', '相集'], ['desktop', '透明']]) {
    await probe.run(PICK(name));
    await wait(520);
    out[label] = await probe.run(READ);
  }
  await probe.shot(path.join(__dirname, 'ticket-fly.png'));
  report(out);
});
