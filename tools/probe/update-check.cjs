/**
 * 检查更新的端到端探针。
 *
 * 为什么不能只用 curl 验：`electron/update.cjs` 走的是 Electron 的 `net.request`
 * （Chromium 网络栈），跟 curl 是两套 DNS / TLS / 代理实现。curl 能通不代表
 * 主进程能通，反过来也一样——这类「线上环境才炸」的问题只能真跑主进程才看得见。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/update-check.cjs --no-sandbox
 *
 * 环境变量：
 *   PROBE_CURRENT=0.3.3   假装自己是哪个版本（默认取 package.json 的版本）
 */
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const CURRENT = process.env.PROBE_CURRENT || pkg.version;

app.whenReady().then(async () => {
  const mod = require(path.join(ROOT, 'electron/update.cjs'));
  const started = Date.now();
  const result = await mod.checkForUpdate(CURRENT);
  const elapsed = Date.now() - started;

  console.log('=== 检查更新 ===');
  console.log('本机版本 :', CURRENT);
  console.log('镜像     :', mod.MIRROR || '(直连)');
  console.log('超时设定 :', mod.TIMEOUT_MS, 'ms');
  console.log('实际用时 :', elapsed, 'ms');
  console.log('结果     :', JSON.stringify(result, null, 2));

  // attachUpdate 的行为：open() 在没有缓存地址时必须返回 false。
  const attached = mod.attachUpdate();
  console.log('空手 open() :', attached.open(), '（应为 false）');
  const checked = await attached.check(CURRENT);
  console.log('attach 后结果 status:', checked.status);
  console.log('缓存的下载地址 :', checked.status === 'newer' ? checked.url : '(无，因为已是最新)');

  // 断言能自动红的三种情形
  const fail = [];
  if (result.status === 'unknown') fail.push('查询失败：' + result.reason);
  if (elapsed > mod.TIMEOUT_MS * 2 + 1500) fail.push(`耗时 ${elapsed}ms 远超超时设定`);
  if (result.status === 'newer' && !result.url.includes(mod.MIRROR)) fail.push('下载地址没套镜像');
  if (result.status === 'newer' && !/^https?:/.test(result.url)) fail.push('下载地址不是 http(s)');

  console.log('');
  if (fail.length) {
    console.log('PROBE_FAIL');
    fail.forEach(f => console.log('  -', f));
    app.exit(1);
    return;
  }
  console.log('PROBE_OK');
  app.exit(0);
}).catch((error) => {
  console.log('PROBE_FAIL 抛错:', error && error.message);
  app.exit(1);
});
