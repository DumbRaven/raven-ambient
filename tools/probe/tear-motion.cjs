// 撕票根**过程中**的动画实测（右下角三角狗耳折）。
//
// 要验的是「拖着走的时候纸有没有从右下角翻起来、翻得像不像软纸」，不是「撕完有没有烧」。
// 判据分六层：
//   1. 连续：从按下到拖过 42%，逐帧读 --bend，要有多个中间态，不能从 0 跳终点。
//   2. 翻得开：--fold-deg 从 0 涨到 TEAR_FOLD_DEG，末态接近 176 度（纸几乎贴回去）。
//   3. 折痕往左上走：--fold-x1（下边缘落点）与 --fold-y1（右边缘落点）都从 1 单调
//      收到 0 附近。这是「从右下角掀起」的全部来源：起点时折痕缩在右下角、
//      纸是平的；越撕折痕越长，切下来的三角越大。
//   4. 轴对得上：翻起来那块印在 matrix3d 里的旋转轴，必须与折痕方向平行
//      （把轴向量喂进矩阵，应该映射回自己）。轴不一致就是「纸沿错误的方向拧」，
//      上一版八条横带各自绕斜轴转就是这么裂开的。
//   5. 不裂：折痕线上取几个点，翻起来那块转过之后它们仍落在原来位置
//      （transform-origin 与轴都在这条线上，这条边是旋转的不动点集）。
//   6. 非线性：手拖一半，形变要明显小于一半（tearEase 的 1.6 次幂）。
//
// 为什么读自定义属性而不是反解矩阵里的角度：角度是我们自己算出来喂给 CSS 的，
// 浏览器读回来仍是原值；从 16 个浮点数里反解 asin 在角度接近 0 时精度不够，
// 静止态会读出一堆 1e-17 的抖动。矩阵只用来验「轴对不对」这一件几何事实。
//
// 两个必须知道的坑：
//   - 拖拽只能用真实 PointerEvent（`sendInputEvent` 产生不了 pointerdown）。
//   - 顶层不能直接 await：`launch()` 里要用 webContents，必须在 app ready 之后，
//     所以整段塞进 `guard()`。不包的话报
//     「Session can only be received when app is ready」。
const { launch, guard, report, wait } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ width: 1440, height: 900, expand: false, settle: 2600 });

  // 点第一张票，把浮层叫起来。
  const opened = await probe.run(`(() => {
    const ticket = document.querySelector('.ticket');
    if (!ticket) return false;
    ticket.click();
    return true;
  })()`);
  if (!opened) throw new Error('页面里没有 .ticket');
  await wait(700);

  const out = await probe.run(`(async () => {
    const stage = document.querySelector('.ticket-stage');
    const lift = stage.querySelector('.ticket-lift');
    const panel = stage.querySelector('.ticket-lift-panel');
    if (!lift || !panel) return { error: 'no-stage' };

    const under = panel.querySelector(".ticket-fold[data-side='under']");
    const over = panel.querySelector(".ticket-fold[data-side='over']");
    if (!under || !over) return { error: 'no-fold' };

    const frame = () => new Promise(r => requestAnimationFrame(r));

    // CSS 自定义属性读回来是 "0.40000" / "165.000deg" 这种字符串。
    const num = (el, name) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;

    // 把 matrix3d 拆成 16 个数；matrix(a,b,c,d,e,f) 的二维情形补成同一套。
    // 注意先剥掉函数名再抓数字：matrix3d 里的那个 3 会被数字正则一起吃进去，
    // 整个矩阵就整体错位一格（踩过：轴漂移从 0.00003 变成 2.2）。
    // 这段是模板字符串，注释里也不能出现反引号，否则整段 JS 直接被截断。
    const matrixOf = el => {
      const raw = getComputedStyle(el).transform;
      if (!raw || raw === 'none') return null;
      const body = raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')'));
      const v = body.split(',').map(s => Number(s.trim()));
      if (v.some(n => !Number.isFinite(n))) return null;
      if (raw.startsWith('matrix3d')) return v;
      // matrix(a,b,c,d,e,f) = 二维仿射，展开成 4×4。
      const [a, b, c, d, e, f] = v;
      return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
    };

    // 用 4×4 矩阵变换一个点（矩阵是列主序，与 CSS 一致）。
    const apply = (m, x, y, z) => [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ];

    const read = () => {
      const overRect = over.getBoundingClientRect();
      const underRect = under.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const m = matrixOf(over);
      const ax = num(lift, '--fold-ax');
      const ay = num(lift, '--fold-ay');
      // 轴是方向向量，喂进矩阵原点出发的点，应该映射回自己（方向不变）。
      const axisImage = m ? apply(m, ax, ay, 0) : null;
      // 折痕两端（比值）：下边缘那个落点 (x1, 1)、右边缘那个落点 (1, y1)。
      const x1 = num(lift, '--fold-x1');
      const y1 = num(lift, '--fold-y1');
      // 旋转是绕 transform-origin 的，不是绕元素左上角：局部点先减掉 origin，
      // 乘完矩阵再加回去。漏掉这一步会统一多漂几百像素（踩过：hingeShift 346）。
      const [ox, oy] = getComputedStyle(over).transformOrigin.split(' ').map(parseFloat);
      // 折痕线上取三个点（下边缘端 / 中点 / 右边缘端），转过之后必须还在原处。
      const fixed = [0, 0.5, 1].map(t => {
        const localX = (x1 + (1 - x1) * t) * panelRect.width;
        const localY = (1 + (y1 - 1) * t) * panelRect.height;
        const img = apply(m, localX - ox, localY - oy, 0);
        return {
          t,
          // 转过之后相对原位偏了多少像素（0 表示这条线没动）。
          shift: Number(Math.hypot(img[0] + ox - localX, img[1] + oy - localY).toFixed(2)),
        };
      });
      return {
        bend: num(lift, '--bend'),
        deg: Math.abs(num(lift, '--fold-deg')),
        ax, ay,
        x1, y1,
        axisDrift: axisImage
          ? Number(Math.hypot(axisImage[0] - ax, axisImage[1] - ay).toFixed(4))
          : null,
        fixed,
        overTop: Number(overRect.top.toFixed(2)),
        overHeight: Number(overRect.height.toFixed(2)),
        underHeight: Number(underRect.height.toFixed(2)),
      };
    };

    const rect = panel.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const fire = (type, y) => panel.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: cx, clientY: y,
    }));

    panel.setPointerCapture = () => {};

    // 平铺基准：还没按下时两块纸各自的合围高度，末态要拿它比。
    const flat = read();

    fire('pointerdown', cy);
    await frame();
    const h = rect.height;
    const target = Math.round(h * 0.42) + 8;   // 刚过阈值
    const step = 6;

    const samples = [];
    for (let d = step; d <= target; d += step) {
      fire('pointermove', cy - d);
      await frame();
      samples.push({ d, ...read() });
    }

    fire('pointerup', cy - target);
    await frame();
    const phaseAfter = document.querySelector('.ticket-stage').dataset.phase;
    return { flat, samples, phaseAfter, height: Math.round(h), width: Math.round(rect.width) };
  })()`);

  if (out.error) throw new Error(out.error);

  const s = out.samples || [];
  const bends = s.map(v => Number(v.bend.toFixed(3)));
  const uniqBend = new Set(bends).size;
  const last = s[s.length - 1];
  const first = s[0];

  // 翻得开：折叠角单调涨、末态接近 TEAR_FOLD_DEG（176 度）。
  const degRises = s.every((v, i) => i === 0 || v.deg >= s[i - 1].deg - 0.01);
  const opensUp = last.deg > 160 && first.deg < 5;

  // 折痕从右下角往左上长：两个落点都从 1 单调后退，中途不许回头，
  // 折满时退到 TEAR_FOLD_EDGE（0.42）处——不是退到左边缘，那样掀走半张票。
  const edgeGrows = s.every((v, i) => i === 0
    || (v.x1 <= s[i - 1].x1 + 1e-4 && v.y1 <= s[i - 1].y1 + 1e-4));
  const reachesEdge = last.x1 < 0.62 && last.x1 > 0.54;

  // 轴对得上：把 CSS 里的轴向量喂进 matrix3d，应该映射回自己（误差 < 1e-3）。
  const axisOk = s
    .filter(v => v.bend > 0.05 && v.axisDrift !== null)
    .every(v => v.axisDrift < 1e-3);

  // 不裂：折痕线上三个点在旋转中都是不动的（位移 < 0.5px）。
  const hingeFixed = s.every(v => v.fixed.every(p => p.shift < 0.5));

  // 非线性：把样本按手位移归一到 0~1，看形变进度是否稳定落后于手。
  const handAt = s.map(v => v.d / last.d);
  const lagging = s.filter((v, i) => v.bend < handAt[i] * 0.9).length;

  const result = {
    width: out.width,
    height: out.height,
    frames: s.length,
    uniqBend,
    flatUnderHeight: out.flat.underHeight,
    endOverHeight: last.overHeight,
    firstDeg: Number(first.deg.toFixed(2)),
    endDeg: Number(last.deg.toFixed(2)),
    firstFold: [Number(first.x1.toFixed(3)), Number(first.y1.toFixed(3))],
    endFold: [Number(last.x1.toFixed(3)), Number(last.y1.toFixed(3))],
    endAxis: [Number(last.ax.toFixed(4)), Number(last.ay.toFixed(4))],
    axisDrift: last.axisDrift,
    hingeShift: last.fixed.map(p => p.shift),
    handRatio: 0.42,
    laggingFrames: lagging,
    phaseAfterRelease: out.phaseAfter,
    continuous: uniqBend > 5,
    foldsOver: degRises && opensUp,
    diagonal: edgeGrows && reachesEdge,
    axisAligned: axisOk,
    hingeHolds: hingeFixed,
    eased: lagging > s.length * 0.6,
    sampleHead: s.slice(0, 3).map(v => ({
      d: v.d, bend: Number(v.bend.toFixed(3)), deg: Number(v.deg.toFixed(1)),
    })),
    sampleTail: s.slice(-3).map(v => ({
      d: v.d, bend: Number(v.bend.toFixed(3)), deg: Number(v.deg.toFixed(1)),
      fold: [Number(v.x1.toFixed(3)), Number(v.y1.toFixed(3))],
    })),
  };
  result.PASS = result.continuous && result.foldsOver && result.diagonal
    && result.axisAligned && result.hingeHolds && result.eased
    && result.phaseAfterRelease === 'burning';
  report(result);
});
