// 撕票根过程四档对照图。给人看的，不是回归探针。
//
// 数字过了不代表看着对：rotate 在阈值处只有 0.67deg、opacity 只掉到 0.965，
// 单看数值「有变化」，肉眼看可能是死的。所以把画面截出来拼成一条。
//
// 拖拽要跨多次 run() 保持状态，所以在页面里挂 window.__tear 句柄。
const { launch, guard, wait } = require('./harness.cjs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OUT = name => path.join(__dirname, name);

guard(async () => {
  const probe = await launch({ width: 1440, height: 900, expand: false, settle: 2600 });

  await probe.run(`(() => { document.querySelector('.ticket').click(); return true; })()`);
  await wait(700);

  const info = await probe.run(`(() => {
    const stage = document.querySelector('.ticket-stage .ticket-lift');
    const panel = document.querySelector('.ticket-lift-panel');
    if (!stage || !panel) return { error: 'no-stage' };
    const rect = panel.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    panel.setPointerCapture = () => {};
    const fire = (type, y) => panel.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: 1, clientX: cx, clientY: y,
    }));
    window.__tear = {
      down: () => fire('pointerdown', cy),
      move: d => fire('pointermove', cy - d),
    };
    return { height: Math.round(rect.height) };
  })()`);
  if (info.error) throw new Error(info.error);

  const files = [];
  const grab = async name => {
    const p = OUT(name);
    await probe.shot(p);
    files.push(p);
  };

  await grab('tear-stage-0.png');

  await probe.run('window.__tear.down()');
  await wait(120);

  // 阈值是 0.42，取 0.2 / 0.36 / 0.45 三档（前两档还没到、最后一档过了）。
  for (const [i, frac] of [0.2, 0.36, 0.45].entries()) {
    await probe.run(`window.__tear.move(${Math.round(info.height * frac)})`);
    await wait(140);
    await grab(`tear-stage-${i + 1}.png`);
  }

  // 四张裁同一块区域再横向拼起来；尺寸一律先问 ffprobe，不写死。
  const probeSize = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', files[0],
  ], { encoding: 'utf8' }).trim().split(',');
  const w = Number(probeSize[0]);
  const h = Number(probeSize[1]);
  // 票根大致在画面中央偏上，取中间 78% 宽、80% 高。
  const cw = Math.round(w * 0.78 / 2) * 2;
  const ch = Math.round(h * 0.8 / 2) * 2;
  const x = Math.round((w - cw) / 2);
  const y = Math.round((h - ch) / 2);

  const inputs = files.flatMap(f => ['-i', f]);
  const chains = files.map((f, i) =>
    `[${i}:v]crop=${cw}:${ch}:${x}:${y},scale=560:-1[v${i}]`).join(';');
  const stack = files.map((f, i) => `[v${i}]`).join('') + `hstack=inputs=${files.length}`;
  const outFile = OUT('tear-stages.png');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', chains + ';' + stack, outFile,
  ]);

  files.forEach(f => require('node:fs').rmSync(f, { force: true }));
  console.log(JSON.stringify({ shot: outFile, crop: [cw, ch], size: [w, h] }));
  probe.close();
});
