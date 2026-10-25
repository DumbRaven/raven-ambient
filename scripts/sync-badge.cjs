// 把当前测试通过数写进 README 顶部的徽章。
//
// 徽章长这样：![Tests](https://img.shields.io/badge/tests-175%20passing-101010?style=flat-square)
// 数字部分在 CI 里由测试报告提供（环境变量 PASSED），本地手动跑时直接执行 npm test 再调用本脚本。
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'README.md');
const passed = Number(process.env.PASSED);

if (!Number.isInteger(passed) || passed <= 0) {
  console.error(`PASSED 不是正整数：${process.env.PASSED ?? '(未设置)'}`);
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');
const pattern = /tests-\d+%20passing/g;
const found = text.match(pattern);

if (!found) {
  console.error('README 里没找到 tests-NN%20passing 徽章');
  process.exit(1);
}

const next = text.replace(pattern, `tests-${passed}%20passing`);

if (next === text) {
  console.log(`徽章已是最新（${passed}）`);
  process.exit(0);
}

fs.writeFileSync(file, next, 'utf8');
console.log(`徽章更新为 ${passed}`);
