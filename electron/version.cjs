/**
 * 版本号比较。只认 `主.次.修订` 三段，够用了——这个项目的版本号一直是这个形状。
 *
 * 放在 electron/ 而不是 src/：真正需要比较版本的是主进程（它去问 GitHub 最新版本，
 * 也它知道自己是哪个版本），渲染进程只负责把这个结果画出来，从不自己比。
 * 所以只有这一份实现，`tests/version.test.ts` 直接测它。
 *
 * 为什么不直接比较字符串：`'0.10.0' > '0.9.0'` 在字符串比较下是 **false**
 * （`'1' < '9'`），而它恰恰是用户最容易撞上的那一档升级。
 * 也不为这个引 semver 库：需求就这一个函数，三段数字足够。
 */

/**
 * 把 `v0.4.0`、`0.4`、`0.4.0-beta.1` 这类写法都拆成三个数字。
 *
 * 预发布标签与构建元数据不参与比较：这个项目不做预发布版，
 * 真出现了也只按同一个数字看，不额外区分先后。
 */
function parseVersion(text) {
  const cleaned = String(text ?? '').trim().replace(/^v/i, '');
  const head = cleaned.split(/[-+]/)[0];
  const parts = head.split('.');
  const num = (index) => {
    const value = Number.parseInt(parts[index] ?? '0', 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  return [num(0), num(1), num(2)];
}

/**
 * 比较两个版本号。
 *
 * 返回 `1` 表示 `next` 比 `current` 新（该提示更新），`0` 相同，`-1` 更旧。
 *
 * 任何一段解析不出来都当 0，所以 `'abc'` 与 `'0.0.0'` 相等而不是抛错——
 * 这个函数的入参一边是网络拿回来的字符串，不能因为对方格式不对就崩掉整个检查。
 */
function compareVersion(next, current) {
  const a = parseVersion(next);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

module.exports = { parseVersion, compareVersion };
