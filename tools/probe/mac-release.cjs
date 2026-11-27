/**
 * 查 GitHub release 的最新产物清单。
 *
 * 为什么要有这个文件：这台 Mac 上 `/usr/bin/python3` 和 `/usr/bin/git` 都是
 * Xcode 命令行工具的占位壳，一跑就弹「要不要安装开发者工具」然后 exit 1。
 * 真正能用的只有自己装的 node，所以用它直接打 GitHub API。
 *
 * 用法（Mac 上）：
 *   node tools/probe/mac-release.cjs ungive/mediaremote-adapter
 */

// 这是 .cjs，不能写顶层 await（会报
// "await is only valid in async functions and the top level bodies of modules"），
// 所以整段包进 async 函数再调用。
async function main() {
  const [repo] = process.argv.slice(2);
  if (!repo) {
    console.error('用法：node tools/probe/mac-release.cjs <owner/repo>');
    process.exit(2);
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': 'raven-ambient-probe' },
  });
  if (!response.ok) {
    console.error(`HTTP ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  const data = await response.json();
  console.log('TAG', data.tag_name);
  for (const asset of data.assets ?? []) {
    console.log(asset.name, asset.size, asset.browser_download_url);
  }
}

main().catch((error) => {
  console.error('查不到：', error && error.message ? error.message : error);
  process.exit(1);
});
