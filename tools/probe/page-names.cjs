/**
 * 探针：改名之后页面上到底印的是什么字（用户 m12760 第 1 条）。
 *
 * 改名这件事有两个落点：导航栏那颗按钮（「相集」）和页面大标题
 * （`Gallery`）。两处都在 `App.tsx` 里，但一处是 JSX 文本、一处是三元
 * 表达式，改漏任何一处都只有肉眼能看出来——所以用探针把实际渲染出来的
 * 字读回来，而不是去看源码。
 */
const { launch, guard, report } = require('./harness.cjs');

const READ = `(() => {
  const tabs = [...document.querySelectorAll('.view-tabs > button')].map(b => ({
    label: b.getAttribute('aria-label'),
    text: (b.querySelector('.tab-label') || b).textContent.trim(),
  }));
  const title = document.querySelector('.today-title');
  return {
    title: title ? title.textContent.trim() : null,
    tabs,
    hasScreenWord: document.body.innerText.includes('Screening'),
  };
})()`;

guard(async () => {
  const probe = await launch({ width: 1400, height: 900, template: 'photo', expand: false, settle: 2200 });
  const out = await probe.run(READ);
  report(out);
});
