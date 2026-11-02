#!/usr/bin/env node
/**
 * 放映页几何探针 —— 量每个版式块相对画布的百分比。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/geo.cjs --no-sandbox
 *
 * 前置：`npm.cmd run build`（探针加载 dist/，不是 src/）。
 *
 * 输出：一行 JSON，外加 tools/probe/geo.png（全屏态截图）。
 *
 * 这些数就是和参考图对比的基准。参考图
 * `屏幕截图 2026-10-17 192657.png` 是 1917×1072，本探针全屏后画布是显示器
 * 物理分辨率（本机 2560×1440），但两边输出的都是**百分比**，可以直接比。
 */
const path = require('node:path');
const { launch, report, guard } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ expand: true });
  const geo = await probe.geo();
  console.log(JSON.stringify(geo));
  await probe.shot(path.join(__dirname, 'geo.png'));
  probe.close();
});
