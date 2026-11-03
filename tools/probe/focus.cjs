#!/usr/bin/env node
/**
 * 量信息条的 Focus 区块在「计时中」的渲染。
 *
 * 探针默认没有专注页在跑，readFocus() 读的是 window.__ravenFocusSnapshot，
 * 所以这里手动塞一个快照进去，等一个轮询周期（MediaRoom 每 800ms 读一次），
 * 再看 DOM 有没有把读数、进度线、阶段行画出来。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/focus.cjs --no-sandbox
 *
 * 前置：`npm.cmd run build`。
 */
const path = require('node:path');
const { launch, guard } = require('./harness.cjs');

/** 与 FocusSnapshot 同形：20 分钟的专注阶段，已经过去 3 分钟。 */
const SNAPSHOT = {
  phase: 'focus',
  running: true,
  remaining: 17 * 60 * 1000,
  total: 20 * 60 * 1000,
  rounds: 1,
  roundsBeforeLong: 4,
  visible: true,
  canSkip: true,
  disc: null,
};

guard(async () => {
  const probe = await launch({ expand: true });
  const { run } = probe;

  await run(`(() => { window.__ravenFocusSnapshot = ${JSON.stringify(SNAPSHOT)}; return 1; })()`);
  await new Promise(done => setTimeout(done, 1200));

  const out = await run(`(() => {
    const cqw = (() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;width:10cqw;height:0';
      document.querySelector('.template-collage').appendChild(probe);
      const value = probe.getBoundingClientRect().width / 10;
      probe.remove();
      return value;
    })();
    const box = document.querySelector('.tpl-block-bar').getBoundingClientRect();
    const area = document.querySelector('.tpl-focus');
    if (!area) return { error: '找不到 .tpl-focus' };
    const rel = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        x: +(((r.left - box.left) / box.width) * 100).toFixed(2),
        y: +(((r.top - box.top) / box.height) * 100).toFixed(2),
        w: +((r.width / box.width) * 100).toFixed(2),
        h: +((r.height / box.height) * 100).toFixed(2),
      };
    };
    const clock = area.querySelector('.tpl-focus-clock');
    const bar = area.querySelector('.tpl-focus-bar');
    const fill = bar && bar.firstElementChild;
    const meta = area.querySelector('.tpl-focus-meta');
    const label = area.querySelector('b');
    const style = node => {
      if (!node) return null;
      const s = getComputedStyle(node);
      return {
        fontSize: s.fontSize,
        fontFamily: s.fontFamily.split(',')[0],
        letterSpacing: s.letterSpacing,
        opacity: s.opacity,
        color: s.color,
      };
    };
    return {
      cqw: +cqw.toFixed(3),
      labelText: label && label.textContent,
      labelStyle: style(label),
      labelRect: rel(label),
      clockText: clock && clock.textContent,
      clockStyle: style(clock),
      clockRect: rel(clock),
      barRect: rel(bar),
      barStyle: bar && { height: getComputedStyle(bar).height },
      fillWidth: fill && fill.style.width,
      fillRect: rel(fill),
      metaText: meta && meta.textContent,
      metaStyle: style(meta),
      metaRect: rel(meta),
      areaRect: rel(area),
    };
  })()`);

  if (out && out.error) console.log('FOCUS_FAIL ' + out.error);
  else console.log('FOCUS ' + JSON.stringify(out));

  await probe.shot(path.join(__dirname, 'focus.png'));
  probe.close();
});
