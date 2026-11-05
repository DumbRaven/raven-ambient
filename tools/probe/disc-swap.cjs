/**
 * 量换碟动画：唱片上挂着两条动画（入场 + 自转），入场只播一次，
 * 自转靠 animation-play-state 启停。
 *
 * 为什么这样设计而不是用状态类：状态类还得管「什么时候移除」，
 * 而且入场动画跑完属性要还给普通规则（待机态要 0.72 的透明度）。
 * 挂在 key 上让 React 重建节点，动画自然重播一次，没有残留状态。
 *
 * 跑法：env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe tools/probe/disc-swap.cjs --no-sandbox
 *
 * 判据：
 *   - 待机：animationName 是 `tpl-disc-enter, tpl-disc-spin`，playState 是 `running, paused`
 *   - 重建节点后 80ms：入场在跑（rotate 负角度、opacity < 1）
 *   - 680ms 后：入场结束（getAnimations 里只剩自转），rotate 回到 none、opacity 回到 0.72
 *   - 加 .spinning：自转从 0° 起步累积
 */
const path = require('node:path');
const { guard, launch, wait } = require('./harness.cjs');

const READ = `(() => {
  const el = document.querySelector('.tpl-disc');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    anims: el.getAnimations().map(a => ({ name: a.animationName, state: a.playState, t: Math.round(a.currentTime) })),
    names: cs.animationName,
    play: cs.animationPlayState,
    rotate: cs.rotate,
    opacity: cs.opacity,
    /* 居中用的是 transform，必须是那个矩阵；动画若写 transform 会把它顶掉。 */
    transform: cs.transform,
  };
})()`;

guard(async () => {
  const probe = await launch({ expand: true });
  const { run, shot, close } = probe;

  console.log('IDLE    ', JSON.stringify(await run(READ)));

  // 模拟 React 换 key：替换节点，动画从头播一次。
  await run(`(() => {
    const el = document.querySelector('.tpl-disc');
    const clone = el.cloneNode(true);
    el.replaceWith(clone);
    return 1;
  })()`);
  await wait(80);
  console.log('T=80    ', JSON.stringify(await run(READ)));
  await wait(600);
  console.log('T=680   ', JSON.stringify(await run(READ)));

  await run(`(() => { document.querySelector('.tpl-disc').classList.add('spinning'); return 1; })()`);
  await wait(400);
  console.log('SPIN400 ', JSON.stringify(await run(READ)));
  await wait(600);
  console.log('SPIN1K  ', JSON.stringify(await run(READ)));

  await shot(path.join(__dirname, 'disc-swap.png'));
  close();
});
