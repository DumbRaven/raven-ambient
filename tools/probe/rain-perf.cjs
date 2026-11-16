/**
 * 性能底数：多少颗「带 backdrop-filter: url(#svg)」的水滴还跑得动。
 *
 * 这决定雨的方案能不能用真折射。项目里 AGENTS.md 记着离屏渲染把 rAF 钉在
 * 16.67ms（真实窗口 6.25ms），所以**只做同环境相对比较**：先量空载帧率，
 * 再量 30 / 60 / 120 颗的帧率，掉多少自己比自己。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/rain-perf.cjs --no-sandbox
 */
const { guard, launch, wait } = require('./harness.cjs');

guard(async () => {
  const { run, close } = await launch({
    width: 1280, height: 800, template: 'collage', expand: true,
  });

  // 装滤镜子 + 一个测帧率的函数
  await run(`(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden';
    host.innerHTML = '<svg width="1" height="1">'
      + '<filter id="disp-perf" x="-20%" y="-20%" width="140%" height="140%">'
      + '<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="5" result="n"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="n" scale="40" xChannelSelector="R" yChannelSelector="G"/>'
      + '</filter></svg>';
    document.body.appendChild(host);

    const host2 = document.createElement('div');
    host2.id = 'perf-layer';
    host2.style.cssText = 'position:absolute;inset:0;z-index:300;pointer-events:none;overflow:hidden';
    document.querySelector('.media-room').appendChild(host2);

    window.__perf = async (n, filter) => {
      const layer = document.getElementById('perf-layer');
      layer.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        const x = (i * 137) % 1800;
        const y = (i * 211) % 1040;
        d.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;'
          + 'width:26px;height:29px;border-radius:50%;'
          + (filter ? 'backdrop-filter:' + filter + ';-webkit-backdrop-filter:' + filter + ';' : '')
          + 'background:radial-gradient(circle at 36% 30%,rgba(255,255,255,.5),rgba(255,255,255,0) 70%);'
          // 都动起来，让合成器真的每帧重画
          + 'animation:perf-move 1.6s linear infinite;';
        layer.appendChild(d);
      }
      if (!document.getElementById('perf-kf')) {
        const s = document.createElement('style');
        s.id = 'perf-kf';
        s.textContent = '@keyframes perf-move{from{transform:translateY(0)}to{transform:translateY(60px)}}';
        document.head.appendChild(s);
      }
      await new Promise(r => setTimeout(r, 300));
      // 量 800ms 的帧
      return await new Promise(resolve => {
        const times = [];
        const t0 = performance.now();
        const tick = t => {
          times.push(t);
          if (t - t0 < 800) requestAnimationFrame(tick);
          else {
            const gaps = times.slice(1).map((v, i) => v - times[i]);
            gaps.sort((a, b) => a - b);
            resolve({
              frames: times.length,
              fps: Math.round(times.length / ((times[times.length - 1] - times[0]) / 1000)),
              medianGap: +(gaps[Math.floor(gaps.length / 2)] || 0).toFixed(2),
              p95Gap: +(gaps[Math.floor(gaps.length * 0.95)] || 0).toFixed(2),
              maxGap: +(gaps[gaps.length - 1] || 0).toFixed(2),
            });
          }
        };
        requestAnimationFrame(tick);
      });
    };
    return 1;
  })()`);

  const out = {};
  out.empty = await run(`window.__perf(0, null)`);
  for (const n of [30, 60, 120]) {
    out['svg' + n] = await run(`window.__perf(${n}, 'url(#disp-perf)')`);
    await wait(200);
    out['blur' + n] = await run(`window.__perf(${n}, 'blur(3px)')`);
    await wait(200);
    out['plain' + n] = await run(`window.__perf(${n}, null)`);
    await wait(200);
  }

  console.log(JSON.stringify(out, null, 2));
  close();
});
