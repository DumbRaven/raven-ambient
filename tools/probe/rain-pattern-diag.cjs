const path = require('node:path');
const { guard, launch, wait } = require('./harness.cjs');
guard(async () => {
  const { run, shot, close } = await launch({ width: 1280, height: 800, template: 'collage', expand: true });
  await wait(600);
  await shot(path.join(__dirname, '..', '..', '.qa', 'diag-0-before.png'));
  const r = await run(`(() => {
    const screen = document.querySelector('.theater-screen');
    const box = document.createElement('div');
    box.id = 'probe-pattern';
    // 用最粗暴的实心色，先确认这层到底画不画得出来
    box.style.cssText = 'position:absolute;inset:0;z-index:6;pointer-events:none;background:#ff0000';
    screen.appendChild(box);
    return document.getElementById('probe-pattern') ? 'added' : 'failed';
  })()`);
  await wait(500);
  await shot(path.join(__dirname, '..', '..', '.qa', 'diag-1-red.png'));
  console.log('red box:', r);
  close();
});
