// 撕票卷曲近景：静止 vs 卷满，两档并排放大看细节（纸背、逐条暗光、接缝）。
const { launch, guard, wait } = require('./harness.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const OUT = name => path.join(__dirname, name);

guard(async () => {
  const probe = await launch({ width: 1440, height: 900, expand: false, settle: 2600 });
  await probe.run(`(() => { document.querySelector('.ticket').click(); return true; })()`);
  await wait(700);

  const info = await probe.run(`(() => {
    const panel = document.querySelector('.ticket-lift-panel');
    const rect = panel.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    panel.setPointerCapture = () => {};
    const fire = (type, y) => panel.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: 1, clientX: cx, clientY: y,
    }));
    window.__tear = { down: () => fire('pointerdown', cy), move: d => fire('pointermove', cy - d) };
    return { height: Math.round(rect.height) };
  })()`);

  const files = [];
  await probe.shot(OUT('tear-cu-0.png'));
  files.push(OUT('tear-cu-0.png'));

  await probe.run('window.__tear.down()');
  await wait(120);
  await probe.run(`window.__tear.move(${Math.round(info.height * 0.4)})`);
  await wait(200);
  await probe.shot(OUT('tear-cu-1.png'));
  files.push(OUT('tear-cu-1.png'));

  const size = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', files[0]], { encoding: 'utf8' }).trim().split(',');
  const w = Number(size[0]);
  const h = Number(size[1]);
  // 右半在整窗右侧约 42%~72% 宽的位置，取一块竖长条放大。
  const cw = Math.round(w * 0.30 / 2) * 2;
  const ch = Math.round(h * 0.62 / 2) * 2;
  const x = Math.round(w * 0.42);
  const y = Math.round(h * 0.22);

  const inputs = files.flatMap(f => ['-i', f]);
  const chains = files.map((f, i) => `[${i}:v]crop=${cw}:${ch}:${x}:${y},scale=520:-1[v${i}]`).join(';');
  const stack = files.map((f, i) => `[v${i}]`).join('') + `hstack=inputs=${files.length}`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', chains + ';' + stack, OUT('tear-closeup.png')]);

  files.forEach(f => fs.rmSync(f, { force: true }));
  console.log(JSON.stringify({ shot: OUT('tear-closeup.png'), crop: [cw, ch], size: [w, h] }));
  probe.close();
});
